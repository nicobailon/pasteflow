import * as zSchemas from "./ipc/schemas";
import { isApprovalsFeatureEnabled } from "./agent/preview-capture";
import type { ApprovalsService, ServiceResult, ApplyResult, StoredPreview, StoredApproval } from "./agent/approvals-service";
import type { DatabaseBridge } from "./db/database-bridge";
import type { ChatSessionId, PreviewId } from "./agent/preview-registry";
import type { PreferenceValue } from "./db/database-implementation";

interface ApprovalsDeps {
  approvalsService: ApprovalsService | null;
  database: DatabaseBridge | null;
}

const SERVICE_UNAVAILABLE = { ok: false as const, error: { code: "SERVICE_UNAVAILABLE", message: "Approvals service unavailable" } };
const FEATURE_DISABLED = { ok: false as const, error: { code: "FEATURE_DISABLED", message: "Approvals disabled" } };
const INVALID_PARAMS = { ok: false as const, error: { code: "INVALID_PARAMS", message: "Invalid parameters" } };

export async function handleApprovalList(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<{ previews: readonly StoredPreview[]; approvals: readonly StoredApproval[] }>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalListSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  const enabled = await isApprovalsFeatureEnabled(deps.database);
  if (!enabled) return FEATURE_DISABLED;
  return deps.approvalsService.listApprovals(parsed.data.sessionId as ChatSessionId);
}

export async function handleApprovalApply(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<ApplyResult>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalApplySchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  const enabled = await isApprovalsFeatureEnabled(deps.database);
  if (!enabled) return FEATURE_DISABLED;
  return deps.approvalsService.applyApproval({ approvalId: parsed.data.approvalId });
}

export async function handleApprovalApplyWithContent(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<ApplyResult>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalApplyWithContentSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  const enabled = await isApprovalsFeatureEnabled(deps.database);
  if (!enabled) return FEATURE_DISABLED;
  return deps.approvalsService.applyApproval({ approvalId: parsed.data.approvalId, editedPayload: parsed.data.content });
}

export async function handleApprovalReject(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<StoredApproval>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalRejectSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  const enabled = await isApprovalsFeatureEnabled(deps.database);
  if (!enabled) return FEATURE_DISABLED;
  return deps.approvalsService.rejectApproval({
    approvalId: parsed.data.approvalId,
    feedbackText: parsed.data.feedbackText,
    feedbackMeta: parsed.data.feedbackMeta,
  });
}

export async function handleApprovalCancel(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<null>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalCancelSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  const enabled = await isApprovalsFeatureEnabled(deps.database);
  if (!enabled) return FEATURE_DISABLED;
  return deps.approvalsService.cancelPreview({ previewId: parsed.data.previewId as PreviewId });
}

export async function handleApprovalRulesGet(deps: ApprovalsDeps): Promise<ServiceResult<unknown>> {
  if (!deps.database) return SERVICE_UNAVAILABLE;
  try {
    const rules = await deps.database.getPreference("agent.approvals.rules");
    return { ok: true, data: Array.isArray(rules) ? rules : [] };
  } catch (error) {
    return { ok: false, error: { code: "RULES_READ_FAILED", message: (error as Error)?.message ?? "Failed to read approvals rules" } };
  }
}

export async function handleApprovalRulesSet(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<null>> {
  if (!deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalRulesSetSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  try {
    await deps.database.setPreference("agent.approvals.rules", parsed.data.rules as unknown as PreferenceValue);
    if (typeof parsed.data.autoCap === 'number' && Number.isFinite(parsed.data.autoCap)) {
      await deps.database.setPreference("agent.approvals.autoCap", parsed.data.autoCap as unknown as PreferenceValue);
      deps.approvalsService?.updateAutoApplyCap(parsed.data.autoCap);
    }
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: { code: "RULES_WRITE_FAILED", message: (error as Error)?.message ?? "Failed to persist approvals rules" } };
  }
}
