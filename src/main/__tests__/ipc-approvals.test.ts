import type { ApprovalsService } from "../agent/approvals-service";
import type { DatabaseBridge } from "../db/database-bridge";
import { makePreviewId } from "../agent/preview-registry";
import { handleApprovalList, handleApprovalApply, handleApprovalRulesGet, handleApprovalRulesSet } from "../approvals-ipc";

const mockIsApprovalsEnabled = jest.fn();
jest.mock("../agent/preview-capture", () => ({
  isApprovalsFeatureEnabled: (async (db: unknown) => mockIsApprovalsEnabled(db))
}));

function createDeps(overrides?: {
  service?: Partial<ApprovalsService> | null;
  database?: Partial<DatabaseBridge> | null;
}) {
  const defaultService: Partial<ApprovalsService> = {
    listApprovals: jest.fn(async () => ({ ok: true as const, data: { previews: [], approvals: [] } })),
    applyApproval: jest.fn(async () => ({ ok: true as const, data: { status: "applied" as const, approvalId: "a", previewId: makePreviewId(), result: {} } })),
  };
  const service = overrides?.service === undefined ? defaultService : overrides.service;
  const defaultDb: Partial<DatabaseBridge> = {
    getPreference: jest.fn(async () => null),
    setPreference: jest.fn(async () => void 0),
  };
  const database = overrides?.database === undefined ? defaultDb : overrides.database;
  return {
    approvalsService: service as ApprovalsService | null,
    database: database as DatabaseBridge | null,
  };
}

describe("approval IPC handlers", () => {
  beforeEach(() => {
    mockIsApprovalsEnabled.mockReset();
  });

  it("returns service unavailable when approvals service missing", async () => {
    mockIsApprovalsEnabled.mockResolvedValue(true);
    const result = await handleApprovalList({ sessionId: "00000000-0000-4000-8000-000000000010" }, createDeps({ service: null }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected service unavailable");
    expect(result.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("validates request payloads", async () => {
    mockIsApprovalsEnabled.mockResolvedValue(true);
    const deps = createDeps();
    const result = await handleApprovalList({ sessionId: "not-a-uuid" }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid params");
    expect(result.error.code).toBe("INVALID_PARAMS");
  });

  it("blocks when feature disabled", async () => {
    mockIsApprovalsEnabled.mockResolvedValue(false);
    const deps = createDeps();
    const result = await handleApprovalList({ sessionId: "00000000-0000-4000-8000-000000000000" }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected feature disabled");
    expect(result.error.code).toBe("FEATURE_DISABLED");
  });

  it("delegates to approvals service on success", async () => {
    mockIsApprovalsEnabled.mockResolvedValue(true);
    const listApprovals = jest.fn(async () => ({ ok: true, data: { previews: [1], approvals: [2] } } as any));
    const deps = createDeps({ service: { listApprovals } as Partial<ApprovalsService> });
    const response = await handleApprovalList({ sessionId: "00000000-0000-4000-8000-000000000001" }, deps);
    expect(response.ok).toBe(true);
    expect(listApprovals).toHaveBeenCalledTimes(1);
  });

  it("applies approval via service", async () => {
    mockIsApprovalsEnabled.mockResolvedValue(true);
    const applyApproval = jest.fn(async ({ approvalId }: { approvalId: string }) => ({ ok: true as const, data: { status: "applied" as const, approvalId, previewId: makePreviewId(), result: {} } })) as ApprovalsService["applyApproval"];
    const deps = createDeps({ service: { applyApproval } });
    const res = await handleApprovalApply({ approvalId: "00000000-0000-4000-8000-000000000002" }, deps);
    expect(res.ok).toBe(true);
    expect(applyApproval).toHaveBeenCalledWith({ approvalId: "00000000-0000-4000-8000-000000000002" });
  });

  it("reads approval rules when available", async () => {
    const getPreference = jest.fn(async () => [{ kind: "tool" }]);
    const result = await handleApprovalRulesGet(createDeps({ database: { getPreference } as Partial<DatabaseBridge> }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.data).toEqual([{ kind: "tool" }]);
  });

  it("writes approval rules and returns success", async () => {
    const setPreference = jest.fn(async () => void 0);
    const result = await handleApprovalRulesSet({ rules: [] }, createDeps({ database: { setPreference } as Partial<DatabaseBridge> }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(setPreference).toHaveBeenCalledWith("agent.approvals.rules", []);
  });
});
