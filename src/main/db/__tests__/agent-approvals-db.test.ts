jest.mock('better-sqlite3');

const mockApp = {
  getPath: jest.fn().mockReturnValue('/tmp/pasteflow-test')
};

jest.mock('electron', () => ({
  app: mockApp
}));

import { DatabaseBridge } from '../database-bridge';
import { makePreviewId, makeSessionId, hashPreview, nowUnixMs } from '../../agent/preview-registry';
import type { PreviewEnvelope, UnixMs } from '../../agent/preview-registry';
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

  it('updates preview detail via patch merging', async () => {
    const sessionId = makeSessionId();
    const previewId = makePreviewId();
    const createdAt = nowUnixMs();
    const toolExecutionId = await bridge.insertToolExecutionReturningId({ sessionId, toolName: 'terminal' });

    const originalArgs = Object.freeze({ command: 'sleep 1' }) as Readonly<Record<string, unknown>>;
    const preview: PreviewEnvelope & { toolExecutionId: number } = {
      id: previewId,
      toolExecutionId,
      sessionId,
      tool: 'terminal',
      action: 'run',
      summary: 'Run command',
      detail: { command: 'sleep 1', sessionId: 'tm-test' },
      originalArgs,
      createdAt,
      hash: hashPreview({ tool: 'terminal', action: 'run', args: originalArgs, detail: { command: 'sleep 1', sessionId: 'tm-test' } }),
    };

    await bridge.insertPreview(preview);

    await bridge.updatePreviewDetail({ id: previewId, patch: { streaming: 'running', lastOutputAt: createdAt + 5 } });
    await bridge.updatePreviewDetail({ id: previewId, patch: { streaming: 'ready', completedAt: createdAt + 10 } });

    const updated = await bridge.getPreviewById(previewId);
    expect(updated).not.toBeNull();
    const detail = updated && updated.detail ? JSON.parse(updated.detail) : {};
    expect(detail.command).toBe('sleep 1');
    expect(detail.sessionId).toBe('tm-test');
    expect(detail.streaming).toBe('ready');
    expect(detail.completedAt).toBe(createdAt + 10);
    expect(detail.lastOutputAt).toBe(createdAt + 5);
  });

  it('prunes resolved approvals and stale previews', async () => {
    const sessionId = makeSessionId();
    const now = nowUnixMs();
    const cutoff = Number(now) + 1;

    // Old resolved approval
    const oldPreviewId = makePreviewId();
    const oldExecId = await bridge.insertToolExecutionReturningId({ sessionId, toolName: 'terminal' });
    const oldArgs = Object.freeze({ command: 'echo old' }) as Readonly<Record<string, unknown>>;
    const oldCreatedAt = (Number(now) - 1000) as UnixMs;
    await bridge.insertPreview({
      id: oldPreviewId,
      toolExecutionId: oldExecId,
      sessionId,
      tool: 'terminal',
      action: 'run',
      summary: 'Old run',
      detail: { command: 'echo old' },
      originalArgs: oldArgs,
      createdAt: oldCreatedAt,
      hash: hashPreview({ tool: 'terminal', action: 'run', args: oldArgs, detail: { command: 'echo old' } }),
    } as PreviewEnvelope & { toolExecutionId: number });
    const oldApproval: InsertApprovalInput = {
      id: oldPreviewId,
      previewId: oldPreviewId,
      sessionId,
      status: 'failed',
      createdAt: oldCreatedAt,
      resolvedAt: (Number(now) - 900) as UnixMs,
      autoReason: 'timeout',
    };
    await bridge.insertApproval(oldApproval);

    // Pending approval should remain
    const pendingPreviewId = makePreviewId();
    const pendingExecId = await bridge.insertToolExecutionReturningId({ sessionId, toolName: 'file' });
    const pendingArgs = Object.freeze({ path: '/tmp/a.txt' }) as Readonly<Record<string, unknown>>;
    await bridge.insertPreview({
      id: pendingPreviewId,
      toolExecutionId: pendingExecId,
      sessionId,
      tool: 'file',
      action: 'write',
      summary: 'Write file',
      detail: { path: '/tmp/a.txt' },
      originalArgs: pendingArgs,
      createdAt: now,
      hash: hashPreview({ tool: 'file', action: 'write', args: pendingArgs, detail: { path: '/tmp/a.txt' } }),
    } as PreviewEnvelope & { toolExecutionId: number });
    const pendingApproval: InsertApprovalInput = {
      id: pendingPreviewId,
      previewId: pendingPreviewId,
      sessionId,
      status: 'pending',
      createdAt: now,
    };
    await bridge.insertApproval(pendingApproval);

    // Orphan preview without approval should be pruned if old
    const orphanPreviewId = makePreviewId();
    const orphanExecId = await bridge.insertToolExecutionReturningId({ sessionId, toolName: 'search' });
    const orphanArgs = Object.freeze({ query: 'TODO' }) as Readonly<Record<string, unknown>>;
    const orphanCreatedAt = (Number(now) - 2000) as UnixMs;
    await bridge.insertPreview({
      id: orphanPreviewId,
      toolExecutionId: orphanExecId,
      sessionId,
      tool: 'search',
      action: 'query',
      summary: 'Search repo',
      detail: { query: 'TODO' },
      originalArgs: orphanArgs,
      createdAt: orphanCreatedAt,
      hash: hashPreview({ tool: 'search', action: 'query', args: orphanArgs, detail: { query: 'TODO' } }),
    } as PreviewEnvelope & { toolExecutionId: number });

    await bridge.pruneApprovals(cutoff);

    const oldApprovalRow = await bridge.getApprovalById(oldPreviewId);
    expect(oldApprovalRow).toBeNull();
    const oldPreviewRow = await bridge.getPreviewById(oldPreviewId);
    expect(oldPreviewRow).toBeNull();
    const orphanPreviewRow = await bridge.getPreviewById(orphanPreviewId);
    expect(orphanPreviewRow).toBeNull();

    const pendingRow = await bridge.getApprovalById(pendingPreviewId);
    expect(pendingRow).not.toBeNull();
    const pendingPreviews = await bridge.listPendingApprovals(sessionId);
    expect(pendingPreviews.some((row) => row.id === pendingPreviewId)).toBe(true);
  });
});
