import { makePreviewId, hashPreview, nowUnixMs, type PreviewEnvelope, type ToolArgsSnapshot, type ToolName, type ChatSessionId } from "./preview-registry";
import type { ApprovalsService } from "./approvals-service";
import type { DatabaseBridge } from "../db/database-bridge";

const TOOL_NAMES: readonly ToolName[] = ["file", "edit", "terminal", "search", "context"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreviewResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === "preview";
}

function cloneArgs(value: unknown): ToolArgsSnapshot {
  if (!isRecord(value)) {
    return Object.freeze({}) as ToolArgsSnapshot;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    clone[key] = val;
  }
  return Object.freeze(clone) as ToolArgsSnapshot;
}

function normalizeDetail(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const detail: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === "type") continue;
    detail[key] = val;
  }
  return Object.freeze(detail);
}

function coerceToolName(value: string): ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value) ? (value as ToolName) : "file";
}

function deriveAction(tool: ToolName, args: ToolArgsSnapshot, detail: Record<string, unknown> | null): string {
  const rawAction = args["action"];
  const raw = typeof rawAction === "string" && rawAction.trim().length > 0 ? rawAction.trim() : null;
  if (raw) return raw;
  if (tool === "edit") {
    if (typeof args["diff"] === "string" && (args["diff"] as string).length > 0) return "diff";
    if (Array.isArray(args["paths"])) return "multi";
    if (typeof args["search"] === "string") return "block";
  }
  if (tool === "file") {
    if (typeof args["content"] === "string") return "write";
    if (typeof args["directory"] === "string") return "list";
    if (typeof args["path"] === "string") {
      const existsFlag = detail && typeof detail["exists"] === "boolean" ? (detail["exists"] as boolean) : undefined;
      return existsFlag ? "read" : "info";
    }
  }
  if (tool === "terminal" && detail && typeof detail["command"] === "string") {
    return "run";
  }
  return "preview";
}

function deriveSummary(tool: ToolName, action: string, args: ToolArgsSnapshot, detail: Record<string, unknown> | null): string {
  const path = (() => {
    if (detail && typeof detail["path"] === "string") return detail["path"] as string;
    if (typeof args["path"] === "string") return args["path"] as string;
    if (typeof args["directory"] === "string") return args["directory"] as string;
    return null;
  })();
  if (path) {
    return `${tool} ${action} preview for ${path}`;
  }
  return `${tool} ${action} preview`;
}

export type CapturePreviewOptions = {
  service: ApprovalsService;
  toolExecutionId: number;
  sessionId: ChatSessionId;
  toolName: string;
  args: unknown;
  result: unknown;
  approvalsEnabled: boolean;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
};

export async function capturePreviewIfAny(options: CapturePreviewOptions): Promise<void> {
  const { approvalsEnabled, result, service, logger } = options;
  if (!approvalsEnabled) return;
  if (!isPreviewResult(result)) return;

  try {
    const tool = coerceToolName(options.toolName);
    const originalArgs = cloneArgs(options.args);
    const detail = normalizeDetail(result);
    const action = deriveAction(tool, originalArgs, detail);
    const summary = deriveSummary(tool, action, originalArgs, detail);

    const preview: PreviewEnvelope = Object.freeze({
      id: makePreviewId(),
      sessionId: options.sessionId,
      tool,
      action,
      summary,
      detail,
      originalArgs,
      createdAt: nowUnixMs(),
      hash: hashPreview({ tool, action, args: originalArgs, detail }),
    });

    const persisted = await service.recordPreview({ preview, toolExecutionId: options.toolExecutionId });
    if (!persisted.ok) {
      logger?.warn?.("[Approvals] preview persistence failed", persisted.error);
      return;
    }

    const approval = await service.createApproval({ previewId: preview.id, sessionId: preview.sessionId });
    if (!approval.ok) {
      logger?.warn?.("[Approvals] approval creation failed", approval.error);
      return;
    }

    const match = await service.evaluateAutoRules(preview);
    if (!match) return;

    if (!service.trackAutoApply(preview.sessionId)) {
      logger?.log?.("[Approvals] auto-apply cap reached", { sessionId: preview.sessionId });
      return;
    }

    const marked = await service.markAutoApproved({ approvalId: preview.id, reason: match.reason });
    if (!marked.ok) {
      logger?.warn?.("[Approvals] auto-approve status update failed", marked.error);
      return;
    }

    await service.applyApproval({ approvalId: preview.id });
  } catch (error) {
    logger?.warn?.("[Approvals] capturePreviewIfAny error", error);
  }
}

export async function isApprovalsFeatureEnabled(db: DatabaseBridge): Promise<boolean> {
  const envFlag = typeof process.env.AGENT_APPROVAL_V2 === "string" ? process.env.AGENT_APPROVAL_V2.trim().toLowerCase() : undefined;
  if (envFlag === "true" || envFlag === "1" || envFlag === "yes") {
    return true;
  }
  if (envFlag === "false" || envFlag === "0" || envFlag === "no") {
    return false;
  }
  try {
    const pref = await db.getPreference("agent.approvals.v2Enabled");
    if (typeof pref === "boolean") return pref;
    if (typeof pref === "string") {
      const normalized = pref.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    }
  } catch {
    // ignore preference errors
  }
  return false;
}
