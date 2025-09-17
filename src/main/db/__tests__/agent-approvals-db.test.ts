jest.mock('better-sqlite3');

const mockApp = {
  getPath: jest.fn().mockReturnValue('/tmp/pasteflow-test')
};

jest.mock('electron', () => ({
  app: mockApp
}));

import { DatabaseBridge } from '../database-bridge';
import { makePreviewId, makeSessionId, hashPreview, nowUnixMs } from '../../agent/preview-registry';
import type { PreviewEnvelope } from '../../agent/preview-registry';
import type { InsertApprovalInput, UpdateApprovalStatusInput, UpdateApprovalFeedbackInput } from '../database-bridge';

const originalVersions = process.versions;

describe('Agent approvals DB integration', () => {
  let bridge: DatabaseBridge;

  beforeAll(async () => {
    Object.defineProperty(process, 'versions', {
      value: { ...originalVersions, electron: '34.3.0' },
      configurable: true,
      writable: true,
    });

    bridge = new DatabaseBridge();
    await bridge.initialize();
  });

  afterAll(async () => {
    await bridge.close();
    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      configurable: true,
      writable: true,
    });
  });

  it('inserts tool execution and returns id', async () => {
    const id = await bridge.insertToolExecutionReturningId({
      sessionId: makeSessionId(),
      toolName: 'file',
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('persists preview and approval lifecycle', async () => {
    const sessionId = makeSessionId();
    const previewId = makePreviewId();
    const createdAt = nowUnixMs();

    const toolExecutionId = await bridge.insertToolExecutionReturningId({
      sessionId,
      toolName: 'terminal',
      args: { command: 'echo "hello"' },
    });

    const detail: Record<string, unknown> = { command: 'echo "hello"' };
    const originalArgs = Object.freeze({ command: 'echo "hello"' }) as Readonly<Record<string, unknown>>;

    const preview: PreviewEnvelope & { toolExecutionId: number } = {
      id: previewId,
      toolExecutionId,
      sessionId,
      tool: 'terminal',
      action: 'run',
      summary: 'Run command',
      detail,
      originalArgs,
      createdAt,
      hash: hashPreview({ tool: 'terminal', action: 'run', args: originalArgs, detail }),
    };

    await bridge.insertPreview(preview);

    const fetched = await bridge.getPreviewById(previewId);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(previewId);
    expect(fetched?.tool_execution_id).toBe(toolExecutionId);
    expect(fetched?.detail).toContain('"command"');

    const approvalsBefore = await bridge.listPreviews(sessionId);
    expect(approvalsBefore.length).toBe(1);

    const approvalInput: InsertApprovalInput = {
      id: makePreviewId(),
      previewId,
      sessionId,
      status: 'pending',
      createdAt,
    };
    await bridge.insertApproval(approvalInput);

    const pending = await bridge.listPendingApprovals(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');

    const feedbackInput: UpdateApprovalFeedbackInput = {
      id: approvalInput.id,
      feedbackText: 'Looks good',
      feedbackMeta: { reviewer: 'tester' },
    };
    await bridge.updateApprovalFeedback(feedbackInput);

    const statusUpdate: UpdateApprovalStatusInput = {
      id: approvalInput.id,
      status: 'approved',
      resolvedAt: createdAt + 1,
      resolvedBy: 'tester',
    };
    await bridge.updateApprovalStatus(statusUpdate);

    const pendingAfter = await bridge.listPendingApprovals(sessionId);
    expect(pendingAfter).toHaveLength(0);

    const exportData = await bridge.listApprovalsForExport(sessionId);
    expect(exportData.previews).toHaveLength(1);
    expect(exportData.approvals).toHaveLength(1);
    expect(exportData.approvals[0].status).toBe('approved');
    expect(exportData.approvals[0].feedback_text).toBe('Looks good');
    expect(exportData.approvals[0].feedback_meta).toContain('reviewer');
  });
});
