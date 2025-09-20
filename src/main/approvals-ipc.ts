import * as zSchemas from "./ipc/schemas";
import type { ApprovalsService, ServiceResult, ApplyResult, StoredPreview, StoredApproval } from "./agent/approvals-service";
import type { DatabaseBridge } from "./db/database-bridge";
import type { ChatSessionId, PreviewId } from "./agent/preview-registry";
import type { PreferenceValue } from "./db/database-implementation";

interface ApprovalsDeps {
  approvalsService: ApprovalsService | null;
  database: DatabaseBridge | null;
}

const SERVICE_UNAVAILABLE = { ok: false as const, error: { code: "SERVICE_UNAVAILABLE", message: "Approvals service unavailable" } };
const INVALID_PARAMS = { ok: false as const, error: { code: "INVALID_PARAMS", message: "Invalid parameters" } };

export async function handleApprovalList(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<{ previews: readonly StoredPreview[]; approvals: readonly StoredApproval[] }>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalListSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  return deps.approvalsService.listApprovals(parsed.data.sessionId as ChatSessionId);
}

export async function handleApprovalApply(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<ApplyResult>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalApplySchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  return deps.approvalsService.applyApproval({
    approvalId: parsed.data.approvalId,
    feedbackText: parsed.data.feedbackText,
    feedbackMeta: parsed.data.feedbackMeta,
    resolvedBy: parsed.data.resolvedBy ?? null,
  });
}

export async function handleApprovalApplyWithContent(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<ApplyResult>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalApplyWithContentSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  return deps.approvalsService.applyApproval({
    approvalId: parsed.data.approvalId,
    editedPayload: parsed.data.content,
    feedbackText: parsed.data.feedbackText,
    feedbackMeta: parsed.data.feedbackMeta,
    resolvedBy: parsed.data.resolvedBy ?? null,
  });
}

export async function handleApprovalReject(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<StoredApproval>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalRejectSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  return deps.approvalsService.rejectApproval({
    approvalId: parsed.data.approvalId,
    feedbackText: parsed.data.feedbackText,
    feedbackMeta: parsed.data.feedbackMeta,
    resolvedBy: parsed.data.resolvedBy ?? null,
  });
}

export async function handleApprovalCancel(params: unknown, deps: ApprovalsDeps): Promise<ServiceResult<null>> {
  if (!deps.approvalsService || !deps.database) return SERVICE_UNAVAILABLE;
  const parsed = zSchemas.AgentApprovalCancelSchema.safeParse(params || {});
  if (!parsed.success) return INVALID_PARAMS;
  return deps.approvalsService.cancelPreview({ previewId: parsed.data.previewId as PreviewId });
}


