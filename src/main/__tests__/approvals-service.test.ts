import { ApprovalsService } from "../agent/approvals-service";
import type { ApprovalEventPayload } from "../agent/approvals-service";
import type { AgentSecurityManager } from "../agent/security-manager";
import type { PreviewEnvelope, ToolArgsSnapshot, PreviewId, ChatSessionId } from "../agent/preview-registry";
import { makePreviewId, makeSessionId, nowUnixMs, hashPreview } from "../agent/preview-registry";
import type { DatabaseBridge, InsertApprovalInput } from "../db/database-bridge";
import type { PreviewRow, ApprovalRow, ApprovalStatus } from "../db/database-implementation";
import { getAgentTools } from "../agent/tools";

jest.mock("../agent/tools", () => ({
  getAgentTools: jest.fn(() => ({})),
}));

const mockedGetAgentTools = getAgentTools as jest.MockedFunction<typeof getAgentTools>;

class InMemoryBridge {
  private previews = new Map<string, PreviewRow>();
  private approvals = new Map<string, ApprovalRow>();
  private preferences = new Map<string, unknown>();
  public toolExecutions: unknown[] = [];

  async insertPreview(preview: PreviewEnvelope & { toolExecutionId: number }): Promise<void> {
    const detail = preview.detail ? JSON.stringify(preview.detail) : null;
    const args = JSON.stringify(preview.originalArgs);
    this.previews.set(preview.id, {
      id: preview.id,
      tool_execution_id: preview.toolExecutionId,
      session_id: preview.sessionId,
      tool: preview.tool,
      action: preview.action,
      summary: preview.summary,
      detail,
      args,
      hash: preview.hash,
      created_at: preview.createdAt,
    });
  }

  async getPreviewById(id: PreviewId): Promise<PreviewRow | null> {
    return this.previews.get(id) ?? null;
  }

  async insertApproval(input: InsertApprovalInput): Promise<void> {
    const existing = this.approvals.get(input.id);
    if (existing) {
      throw new Error("Approval already exists");
    }
    this.approvals.set(input.id, {
      id: input.id,
      preview_id: input.previewId,
      session_id: input.sessionId,
      status: input.status,
      created_at: input.createdAt,
      resolved_at: input.resolvedAt ?? null,
      resolved_by: input.resolvedBy ?? null,
      auto_reason: input.autoReason ?? null,
      feedback_text: input.feedbackText ?? null,
      feedback_meta: input.feedbackMeta ? JSON.stringify(input.feedbackMeta) : null,
    });
  }

  async getApprovalById(id: string): Promise<ApprovalRow | null> {
    return this.approvals.get(id) ?? null;
  }

  async updateApprovalStatus(input: { id: string; status: ApprovalStatus; resolvedAt?: number | null; resolvedBy?: string | null; autoReason?: string | null }): Promise<void> {
    const existing = this.approvals.get(input.id);
    if (!existing) throw new Error("Approval not found");
    this.approvals.set(input.id, {
      ...existing,
      status: input.status,
      resolved_at: input.resolvedAt ?? null,
      resolved_by: input.resolvedBy ?? null,
      auto_reason: input.autoReason ?? null,
    });
  }

  async updateApprovalFeedback(input: { id: string; feedbackText?: string | null; feedbackMeta?: unknown | null }): Promise<void> {
    const existing = this.approvals.get(input.id);
    if (!existing) throw new Error("Approval not found");
    this.approvals.set(input.id, {
      ...existing,
      feedback_text: input.feedbackText ?? null,
      feedback_meta: input.feedbackMeta == null ? null : JSON.stringify(input.feedbackMeta),
    });
  }

  async listApprovalsForExport(sessionId: ChatSessionId): Promise<{ previews: readonly PreviewRow[]; approvals: readonly ApprovalRow[] }> {
    const previews = [...this.previews.values()].filter((row) => row.session_id === sessionId);
    const approvals = [...this.approvals.values()].filter((row) => row.session_id === sessionId);
    return { previews, approvals };
  }

  async listPendingApprovals(sessionId: ChatSessionId): Promise<readonly ApprovalRow[]> {
    return [...this.approvals.values()].filter((row) => row.session_id === sessionId && row.status === "pending");
  }

  async insertToolExecution(entry: unknown): Promise<void> {
    this.toolExecutions.push(entry);
  }

  async getPreference(key: string): Promise<unknown> {
    return this.preferences.has(key) ? this.preferences.get(key)! : null;
  }

  async setPreference(key: string, value: unknown): Promise<void> {
    if (value === null) {
      this.preferences.delete(key);
    } else {
      this.preferences.set(key, value);
    }
  }
}

type TestSecurity = {
  getConfig: () => {
    ENABLE_FILE_WRITE: boolean;
    ENABLE_CODE_EXECUTION: boolean;
  } & Record<string, unknown>;
};

function createSecurity(overrides?: Partial<TestSecurity["getConfig"]>): TestSecurity {
  return {
    getConfig: () => ({
      ENABLE_FILE_WRITE: true,
      ENABLE_CODE_EXECUTION: true,
      APPROVAL_MODE: "always",
      ...overrides,
    }),
  };
}

function buildPreview(options?: {
  sessionId?: ChatSessionId;
  tool?: "file" | "edit" | "terminal" | "search" | "context";
  action?: string;
  detail?: Record<string, unknown> | null;
  args?: ToolArgsSnapshot;
}): PreviewEnvelope {
  const sessionId = options?.sessionId ?? makeSessionId();
  const tool = options?.tool ?? "file";
  const detail = options?.detail ?? { path: "/tmp/example.txt", exists: false };
  const originalArgs = options?.args ?? (Object.freeze({ path: "/tmp/example.txt", content: "hello" }) as ToolArgsSnapshot);
  const action = options?.action ?? "write";
  const createdAt = nowUnixMs();
  return {
    id: makePreviewId(),
    sessionId,
    tool,
    action,
    summary: `${tool} ${action}`,
    detail,
    originalArgs,
    createdAt,
    hash: hashPreview({ tool, action, args: originalArgs, detail }),
  };
}

describe("ApprovalsService", () => {
  let db: InMemoryBridge;
  let broadcast: jest.MockedFunction<(payload: ApprovalEventPayload) => void>;

  beforeEach(() => {
    db = new InMemoryBridge();
    broadcast = jest.fn();
    mockedGetAgentTools.mockReset();
  });

  function createService(overrides?: { security?: TestSecurity }) {
    return new ApprovalsService({
      db: db as unknown as DatabaseBridge,
      security: (overrides?.security ?? createSecurity()) as unknown as AgentSecurityManager,
      broadcast,
      logger: console,
    });
  }

  it("records previews and creates approvals", async () => {
    const service = createService();
    const preview = buildPreview();

    const record = await service.recordPreview({ preview, toolExecutionId: 42 });
    expect(record.ok).toBe(true);

    const created = await service.createApproval({ previewId: preview.id, sessionId: preview.sessionId });
    expect(created.ok).toBe(true);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].type).toBe("agent:approval:new");

    const list = await service.listApprovals(preview.sessionId);
    expect(list.ok).toBe(true);
    if (!list.ok) throw new Error("list should succeed");
    expect(list.data.previews).toHaveLength(1);
    expect(list.data.approvals).toHaveLength(1);
    expect(list.data.approvals[0].status).toBe("pending");
  });

  it("blocks apply when file writes disabled", async () => {
    const security = createSecurity({ ENABLE_FILE_WRITE: false });
    const service = createService({ security });
    const preview = buildPreview();
    await service.recordPreview({ preview, toolExecutionId: 1 });
    await service.createApproval({ previewId: preview.id, sessionId: preview.sessionId });

    const result = await service.applyApproval({ approvalId: preview.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("apply should succeed");
    expect(result.data.status).toBe("blocked");
    if (result.data.status !== "blocked") throw new Error("expected blocked result");
    expect(result.data.reason).toBe("FILE_WRITE_DISABLED");
  });

  it("applies approval when tool executes successfully", async () => {
    const service = createService();
    const preview = buildPreview({ detail: { path: "/tmp/example.txt", exists: false } });
    await service.recordPreview({ preview, toolExecutionId: 7 });
    await service.createApproval({ previewId: preview.id, sessionId: preview.sessionId });

    const executedArgs: unknown[] = [];
    mockedGetAgentTools.mockImplementation(({ onToolExecute }: { onToolExecute?: (name: string, args: unknown, result: unknown, meta?: Record<string, unknown>) => Promise<void> | void }) => ({
      file: {
        execute: async (args: unknown) => {
          executedArgs.push(args);
          if (onToolExecute) {
            await onToolExecute("file", args, { type: "applied" }, {});
          }
          return { type: "applied" };
        },
      },
    }));

    const result = await service.applyApproval({ approvalId: preview.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("apply should succeed");
    expect(result.data.status).toBe("applied");
    expect(executedArgs).toHaveLength(1);
    expect(executedArgs[0]).toMatchObject({ apply: true });

    const stored = await service.listApprovals(preview.sessionId);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error("list should succeed");
    expect(stored.data.approvals[0].status).toBe("applied");
    expect(db.toolExecutions).toHaveLength(1);
    expect(broadcast).toHaveBeenCalled();
  });

  it("evaluates skip-all preference for auto rules", async () => {
    const service = createService();
    await db.setPreference("agent.approvals.skipAll", true);
    const preview = buildPreview();
    const match = await service.evaluateAutoRules(preview);
    expect(match).not.toBeNull();
    expect(match?.reason).toBe("skipAll");
  });
});
