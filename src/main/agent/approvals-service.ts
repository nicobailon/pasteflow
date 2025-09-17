import { EventEmitter } from "node:events";

import type { AgentSecurityManager } from "./security-manager";
import { getAgentTools } from "./tools";
import type { PreviewEnvelope, PreviewId, ChatSessionId, ToolName, ToolArgsSnapshot, UnixMs } from "./preview-registry";
import { assertPreviewEnvelope, nowUnixMs } from "./preview-registry";
import type { DatabaseBridge, InsertApprovalInput, UpdateApprovalFeedbackInput, UpdateApprovalStatusInput } from "../db/database-bridge";
import type { PreviewRow, ApprovalRow, ApprovalStatus } from "../db/database-implementation";

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export type ApplyResult =
  | { status: "applied"; approvalId: string; previewId: PreviewId; result: unknown }
  | { status: "blocked"; approvalId: string; previewId: PreviewId; reason: string }
  | { status: "failed"; approvalId: string; previewId: PreviewId; message: string };

export type AutoRuleMatch = {
  rule: AutoRule;
  reason: string;
};

export type AutoRule =
  | { kind: "tool"; tool: ToolName; action?: string | readonly string[] }
  | { kind: "path"; pattern: string; tool?: ToolName }
  | { kind: "terminal"; commandIncludes?: string };

export interface StoredPreview {
  readonly id: PreviewId;
  readonly sessionId: ChatSessionId;
  readonly toolExecutionId: number;
  readonly tool: ToolName;
  readonly action: string;
  readonly summary: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
  readonly originalArgs: ToolArgsSnapshot;
  readonly createdAt: UnixMs;
  readonly hash: string;
}

export interface StoredApproval {
  readonly id: string;
  readonly previewId: PreviewId;
  readonly sessionId: ChatSessionId;
  readonly status: ApprovalStatus;
  readonly createdAt: UnixMs;
  readonly resolvedAt: UnixMs | null;
  readonly resolvedBy: string | null;
  readonly autoReason: string | null;
  readonly feedbackText: string | null;
  readonly feedbackMeta: Readonly<Record<string, unknown>> | null;
}

export type ApprovalEventPayload =
  | { type: "agent:approval:new"; preview: StoredPreview; approval: StoredApproval }
  | { type: "agent:approval:update"; approval: StoredApproval };

export interface ApprovalsServiceDeps {
  readonly db: DatabaseBridge;
  readonly security: AgentSecurityManager;
  readonly broadcast?: (event: ApprovalEventPayload) => void;
  readonly logger?: Pick<typeof console, "log" | "warn" | "error">;
  readonly autoApplyCap?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TOOL_NAME_SET: ReadonlySet<ToolName> = new Set(["file", "edit", "terminal", "search", "context"]);

function isToolNameValue(value: unknown): value is ToolName {
  return typeof value === "string" && TOOL_NAME_SET.has(value as ToolName);
}

function parseJsonRecord(value: string | null, context: string): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      throw new TypeError(`${context} must be a record object`);
    }
    return Object.freeze({ ...parsed });
  } catch (error) {
    throw new TypeError(`Failed to parse ${context}: ${(error as Error).message}`);
  }
}

function parseToolArgs(value: string | null, context: string): ToolArgsSnapshot {
  if (value === null) return Object.freeze({}) as ToolArgsSnapshot;
  const record = parseJsonRecord(value, context);
  return (record ?? Object.freeze({})) as ToolArgsSnapshot;
}

function parseFeedbackMeta(value: string | null, context: string): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed === null) return null;
    if (!isRecord(parsed)) {
      throw new TypeError(`${context} must be a record object or null`);
    }
    return Object.freeze({ ...parsed });
  } catch (error) {
    throw new TypeError(`Failed to parse ${context}: ${(error as Error).message}`);
  }
}

function toStoredPreview(row: PreviewRow): StoredPreview {
  return {
    id: row.id as PreviewId,
    sessionId: row.session_id as ChatSessionId,
    toolExecutionId: row.tool_execution_id,
    tool: row.tool as ToolName,
    action: row.action,
    summary: row.summary,
    detail: parseJsonRecord(row.detail, "preview.detail"),
    originalArgs: parseToolArgs(row.args, "preview.args"),
    createdAt: row.created_at as UnixMs,
    hash: row.hash,
  } as const;
}

function toStoredApproval(row: ApprovalRow): StoredApproval {
  return {
    id: row.id,
    previewId: row.preview_id as PreviewId,
    sessionId: row.session_id as ChatSessionId,
    status: row.status,
    createdAt: row.created_at as UnixMs,
    resolvedAt: row.resolved_at as UnixMs | null,
    resolvedBy: row.resolved_by,
    autoReason: row.auto_reason,
    feedbackText: row.feedback_text,
    feedbackMeta: parseFeedbackMeta(row.feedback_meta, "approval.feedback_meta"),
  } as const;
}

function mergeArgs(base: ToolArgsSnapshot, override: unknown): ToolArgsSnapshot {
  const clone = { ...base } as Record<string, unknown>;
  if (!isRecord(override)) {
    const mergedBase = { ...clone, apply: true };
    return Object.freeze(mergedBase) as ToolArgsSnapshot;
  }
  const merged = { ...clone, ...override, apply: true };
  return Object.freeze(merged) as ToolArgsSnapshot;
}

function markApplyArgs(base: ToolArgsSnapshot): ToolArgsSnapshot {
  const merged = { ...base, apply: true };
  return Object.freeze(merged) as ToolArgsSnapshot;
}

export class ApprovalsService extends EventEmitter {
  private readonly db: DatabaseBridge;
  private readonly security: AgentSecurityManager;
  private readonly broadcast?: (event: ApprovalEventPayload) => void;
  private readonly logger: Pick<typeof console, "log" | "warn" | "error">;
  private readonly autoApplyCap: number;
  private readonly autoApplyCounts = new Map<ChatSessionId, number>();

  constructor(deps: ApprovalsServiceDeps) {
    super();
    this.db = deps.db;
    this.security = deps.security;
    this.broadcast = deps.broadcast;
    this.logger = deps.logger ?? console;
    const cap = typeof deps.autoApplyCap === "number" && Number.isFinite(deps.autoApplyCap) ? deps.autoApplyCap : 5;
    this.autoApplyCap = cap > 0 ? Math.floor(cap) : 5;
  }

  async recordPreview(params: { preview: PreviewEnvelope; toolExecutionId: number }): Promise<ServiceResult<StoredPreview>> {
    try {
      assertPreviewEnvelope(params.preview);
      await this.db.insertPreview({
        ...params.preview,
        toolExecutionId: params.toolExecutionId,
      });
      const storedRow = await this.db.getPreviewById(params.preview.id);
      if (!storedRow) {
        throw new Error("Preview not found after insert");
      }
      const stored = toStoredPreview(storedRow);
      return { ok: true, data: stored } as const;
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] Failed to record preview", error);
      return { ok: false, error: { code: "PREVIEW_PERSIST_FAILED", message: (error as Error)?.message ?? "Failed to record preview" } } as const;
    }
  }

  async createApproval(params: { previewId: PreviewId; sessionId: ChatSessionId }): Promise<ServiceResult<StoredApproval>> {
    try {
      const existing = await this.db.getApprovalById(params.previewId);
      if (existing) {
        return { ok: true, data: toStoredApproval(existing) } as const;
      }
      const createdAt = nowUnixMs();
      const approvalInput: InsertApprovalInput = {
        id: params.previewId,
        previewId: params.previewId,
        sessionId: params.sessionId,
        status: "pending",
        createdAt,
      };
      await this.db.insertApproval(approvalInput);
      const approvalRow = await this.db.getApprovalById(approvalInput.id);
      if (!approvalRow) {
        throw new Error("Approval not found after insert");
      }
      const approval = toStoredApproval(approvalRow);
      this.emitEvent({ type: "agent:approval:new", preview: await this.requirePreview(params.previewId), approval });
      return { ok: true, data: approval } as const;
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] Failed to create approval", error);
      return { ok: false, error: { code: "APPROVAL_CREATE_FAILED", message: (error as Error)?.message ?? "Failed to create approval" } } as const;
    }
  }

  async listApprovals(sessionId: ChatSessionId): Promise<ServiceResult<{ previews: readonly StoredPreview[]; approvals: readonly StoredApproval[] }>> {
    try {
      const exportRows = await this.db.listApprovalsForExport(sessionId);
      const previews = exportRows.previews.map(toStoredPreview);
      const approvals = exportRows.approvals.map(toStoredApproval);
      return { ok: true, data: { previews, approvals } } as const;
    } catch (error) {
      this.logger.error?.("[ApprovalsService] Failed to list approvals", error);
      return { ok: false, error: { code: "APPROVAL_LIST_FAILED", message: (error as Error)?.message ?? "Failed to list approvals" } } as const;
    }
  }

  async applyApproval(params: { approvalId: string; editedPayload?: unknown }): Promise<ServiceResult<ApplyResult>> {
    try {
      const approvalRow = await this.db.getApprovalById(params.approvalId);
      if (!approvalRow) {
        return { ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } } as const;
      }
      const approval = toStoredApproval(approvalRow);
      if (approval.status === "applied") {
        return { ok: true, data: { status: "applied", approvalId: approval.id, previewId: approval.previewId, result: { alreadyApplied: true } } };
      }
      const allowedStatuses: readonly ApprovalStatus[] = ["pending", "approved", "auto_approved"] as const;
      if (!allowedStatuses.includes(approval.status)) {
        return { ok: false, error: { code: "INVALID_STATE", message: `Cannot apply approval in status ${approval.status}` } } as const;
      }

      const previewRow = await this.db.getPreviewById(approval.previewId);
      if (!previewRow) {
        return { ok: false, error: { code: "PREVIEW_MISSING", message: "Preview not found for approval" } } as const;
      }
      const preview = toStoredPreview(previewRow);

      const config = this.security.getConfig();
      if (!config.ENABLE_FILE_WRITE && preview.tool === "file") {
        return { ok: true, data: { status: "blocked", approvalId: approval.id, previewId: approval.previewId, reason: "FILE_WRITE_DISABLED" } };
      }
      if (!config.ENABLE_CODE_EXECUTION && preview.tool === "terminal") {
        return { ok: true, data: { status: "blocked", approvalId: approval.id, previewId: approval.previewId, reason: "CODE_EXECUTION_DISABLED" } };
      }

      const applyArgs = params.editedPayload ? mergeArgs(preview.originalArgs, params.editedPayload) : markApplyArgs(preview.originalArgs);

      const tools = getAgentTools({
        security: this.security,
        config,
        sessionId: preview.sessionId,
        onToolExecute: async (name, args, result, meta) => {
          try {
            await this.db.insertToolExecution({
              sessionId: preview.sessionId,
              toolName: name,
              args,
              result,
              status: "ok",
              error: null,
              startedAt: (meta as { startedAt?: number } | undefined)?.startedAt ?? null,
              durationMs: (meta as { durationMs?: number } | undefined)?.durationMs ?? null,
            });
          } catch (error) {
            this.logger.warn?.("[ApprovalsService] Failed to log tool execution", error);
          }
        },
      });

      const toolEntry = (tools as Record<string, { execute?: (args: unknown) => Promise<unknown> }>)[preview.tool];
      if (!toolEntry || typeof toolEntry.execute !== "function") {
        return { ok: false, error: { code: "TOOL_NOT_FOUND", message: `Tool ${preview.tool} unavailable` } } as const;
      }

      let result: unknown;
      try {
        result = await toolEntry.execute(applyArgs);
      } catch (error) {
        await this.markApprovalFailure(approval.id, (error as Error)?.message || "Tool execution failed");
        return { ok: false, error: { code: "APPLY_FAILED", message: (error as Error)?.message || "Tool execution failed" } } as const;
      }

      await this.db.updateApprovalStatus({
        id: approval.id,
        status: "applied",
        resolvedAt: nowUnixMs(),
        resolvedBy: "system",
      } satisfies UpdateApprovalStatusInput);

      const updatedRow = await this.db.getApprovalById(approval.id);
      if (updatedRow) {
        const updated = toStoredApproval(updatedRow);
        this.emitEvent({ type: "agent:approval:update", approval: updated });
      }

      return { ok: true, data: { status: "applied", approvalId: approval.id, previewId: approval.previewId, result } } as const;
    } catch (error) {
      this.logger.error?.("[ApprovalsService] applyApproval failed", error);
      return { ok: false, error: { code: "APPLY_ERROR", message: (error as Error)?.message ?? "Failed to apply approval" } } as const;
    }
  }

  async rejectApproval(params: { approvalId: string; feedbackText?: string | null; feedbackMeta?: unknown }): Promise<ServiceResult<StoredApproval>> {
    try {
      const approvalRow = await this.db.getApprovalById(params.approvalId);
      if (!approvalRow) {
        return { ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } } as const;
      }

      await this.db.updateApprovalStatus({
        id: params.approvalId,
        status: "rejected",
        resolvedAt: nowUnixMs(),
        resolvedBy: "user",
      } satisfies UpdateApprovalStatusInput);

      if (params.feedbackText || params.feedbackMeta) {
        const updateFeedback: UpdateApprovalFeedbackInput = {
          id: params.approvalId,
          feedbackText: params.feedbackText ?? null,
          feedbackMeta: params.feedbackMeta ?? null,
        };
        await this.db.updateApprovalFeedback(updateFeedback);
      }

      const row = await this.db.getApprovalById(params.approvalId);
      if (!row) {
        throw new Error("Approval missing after rejection");
      }
      const stored = toStoredApproval(row);
      this.emitEvent({ type: "agent:approval:update", approval: stored });
      return { ok: true, data: stored } as const;
    } catch (error) {
      this.logger.error?.("[ApprovalsService] rejectApproval failed", error);
      return { ok: false, error: { code: "REJECT_FAILED", message: (error as Error)?.message ?? "Failed to reject approval" } } as const;
    }
  }

  async cancelPreview(params: { previewId: PreviewId }): Promise<ServiceResult<null>> {
    try {
      const approvalRow = await this.db.getApprovalById(params.previewId);
      if (!approvalRow) {
        return { ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } } as const;
      }
      await this.db.updateApprovalStatus({
        id: approvalRow.id,
        status: "failed",
        resolvedAt: nowUnixMs(),
        autoReason: "cancelled",
      });
      const row = await this.db.getApprovalById(params.previewId);
      if (row) {
        this.emitEvent({ type: "agent:approval:update", approval: toStoredApproval(row) });
      }
      return { ok: true, data: null } as const;
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] cancelPreview failed", error);
      return { ok: false, error: { code: "CANCEL_FAILED", message: (error as Error)?.message ?? "Failed to cancel preview" } } as const;
    }
  }

  async markAutoApproved(params: { approvalId: string; reason: string; resolvedBy?: string | null }): Promise<ServiceResult<StoredApproval>> {
    try {
      const approvalRow = await this.db.getApprovalById(params.approvalId);
      if (!approvalRow) {
        return { ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } } as const;
      }

      await this.db.updateApprovalStatus({
        id: params.approvalId,
        status: "auto_approved",
        resolvedAt: nowUnixMs(),
        resolvedBy: params.resolvedBy ?? "system",
        autoReason: params.reason,
      });

      const updatedRow = await this.db.getApprovalById(params.approvalId);
      if (!updatedRow) {
        throw new Error("Approval missing after auto-approve");
      }
      const stored = toStoredApproval(updatedRow);
      this.emitEvent({ type: "agent:approval:update", approval: stored });
      return { ok: true, data: stored } as const;
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] markAutoApproved failed", error);
      return { ok: false, error: { code: "AUTO_APPROVE_FAILED", message: (error as Error)?.message ?? "Failed to mark auto-approved" } } as const;
    }
  }

  async evaluateAutoRules(preview: PreviewEnvelope): Promise<AutoRuleMatch | null> {
    const skipAllPref = await this.safeGetPreference("agent.approvals.skipAll");
    if (skipAllPref === true || skipAllPref === "true") {
      return { rule: { kind: "tool", tool: preview.tool }, reason: "skipAll" };
    }

    const rulesPref = await this.safeGetPreference("agent.approvals.rules");
    if (!Array.isArray(rulesPref)) {
      return null;
    }

    for (const candidate of rulesPref) {
      if (!isRecord(candidate) || typeof candidate.kind !== "string") continue;
      if (candidate.kind === "tool") {
        const toolRule = candidate as { kind: "tool"; tool?: string; action?: unknown };
        if (toolRule.tool && toolRule.tool === preview.tool) {
          if (toolRule.action === undefined) {
            return { rule: { kind: "tool", tool: preview.tool }, reason: "tool" };
          }
          if (typeof toolRule.action === "string" && toolRule.action === preview.action) {
            return { rule: { kind: "tool", tool: preview.tool, action: toolRule.action }, reason: "tool-action" };
          }
          if (Array.isArray(toolRule.action) && toolRule.action.includes(preview.action)) {
            return { rule: { kind: "tool", tool: preview.tool, action: toolRule.action as readonly string[] }, reason: "tool-action" };
          }
        }
      }
      const detailPath = preview.detail && typeof preview.detail["path"] === "string" ? String(preview.detail["path"]) : null;
      if (candidate.kind === "path" && detailPath) {
        const pathRule = candidate as { kind: "path"; pattern?: unknown; tool?: unknown };
        if (pathRule.tool !== undefined && (!isToolNameValue(pathRule.tool) || pathRule.tool !== preview.tool)) {
          continue;
        }
        if (typeof pathRule.pattern === "string" && detailPath.includes(pathRule.pattern)) {
          const maybeTool = isToolNameValue(pathRule.tool) ? pathRule.tool : undefined;
          return { rule: { kind: "path", pattern: pathRule.pattern, tool: maybeTool }, reason: "path" };
        }
      }
      if (candidate.kind === "terminal" && preview.tool === "terminal") {
        const terminalRule = candidate as { kind: "terminal"; commandIncludes?: unknown };
        if (typeof terminalRule.commandIncludes === "string") {
          const commandValue = preview.detail?.["command"] ?? preview.detail?.["cmd"] ?? "";
          const command = typeof commandValue === "string" ? commandValue : String(commandValue ?? "");
          if (command.includes(terminalRule.commandIncludes)) {
            return { rule: { kind: "terminal", commandIncludes: terminalRule.commandIncludes }, reason: "terminal" };
          }
        }
      }
    }

    return null;
  }

  private async requirePreview(id: PreviewId): Promise<StoredPreview> {
    const row = await this.db.getPreviewById(id);
    if (!row) {
      throw new Error("Preview not found");
    }
    return toStoredPreview(row);
  }

  private emitEvent(event: ApprovalEventPayload): void {
    this.broadcast?.(event);
    this.emit(event.type, event);
  }

  private async markApprovalFailure(approvalId: string, reason: string): Promise<void> {
    await this.db.updateApprovalStatus({
      id: approvalId,
      status: "failed",
      resolvedAt: nowUnixMs(),
      autoReason: reason,
    });
    const row = await this.db.getApprovalById(approvalId);
    if (row) {
      this.emitEvent({ type: "agent:approval:update", approval: toStoredApproval(row) });
    }
  }

  private async safeGetPreference(key: string): Promise<unknown> {
    try {
      return await this.db.getPreference(key);
    } catch (error) {
      this.logger.warn?.(`[ApprovalsService] Failed to read preference ${key}`, error);
      return undefined;
    }
  }

  trackAutoApply(sessionId: ChatSessionId): boolean {
    const current = this.autoApplyCounts.get(sessionId) ?? 0;
    if (current >= this.autoApplyCap) {
      return false;
    }
    this.autoApplyCounts.set(sessionId, current + 1);
    return true;
  }

  resetAutoApply(sessionId: ChatSessionId): void {
    this.autoApplyCounts.delete(sessionId);
  }
}
