import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

import type { DatabaseBridge, InsertApprovalInput, UpdateApprovalFeedbackInput, UpdateApprovalStatusInput } from "../db/database-bridge";
import type { PreviewRow, ApprovalRow, ApprovalStatus } from "../db/database-implementation";

import type { AgentSecurityManager } from "./security-manager";
import { getAgentTools } from "./tools";
import type { PreviewEnvelope, PreviewId, ChatSessionId, ToolName, ToolArgsSnapshot, UnixMs } from "./preview-registry";
import { assertPreviewEnvelope, nowUnixMs } from "./preview-registry";
import { isRiskyCommand } from "./tools/shared/safety-utils";
import { logApprovalEvent } from "./approvals-telemetry";
import { appendApprovalFeedbackMessage } from "./chat-storage";


export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export type ApplyResult =
  | { status: "applied"; approvalId: string; previewId: PreviewId; result: unknown }
  | { status: "blocked"; approvalId: string; previewId: PreviewId; reason: string }
  | { status: "failed"; approvalId: string; previewId: PreviewId; message: string };


export interface ToolCancellationAdapters {
  readonly terminal?: {
    kill(sessionId: string): Promise<void> | void;
    onSessionCompleted?(handler: (sessionId: string) => void): () => void;
    onSessionOutput?(handler: (sessionId: string, chunk: string) => void): () => void;
  };
}

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
  | { type: "agent:approval:update"; approval: StoredApproval }
  | { type: "agent:auto_approval_cap_reached"; sessionId: ChatSessionId; cap: number; count: number };

export interface ApprovalsServiceDeps {
  readonly db: DatabaseBridge;
  readonly security: AgentSecurityManager;
  readonly broadcast?: (event: ApprovalEventPayload) => void;
  readonly logger?: Pick<typeof console, "log" | "warn" | "error">;
  readonly autoApplyCap?: number;
  readonly cancellationAdapters?: ToolCancellationAdapters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TOOL_NAME_SET: ReadonlySet<ToolName> = new Set(["file", "edit", "terminal", "search", "context"]);

function isToolNameValue(value: unknown): value is ToolName {
  return typeof value === "string" && TOOL_NAME_SET.has(value as ToolName);
}

const FILE_PATH_KEYS = Object.freeze(["path", "file", "targetPath", "destination", "filePath", "absolutePath"]) as readonly string[];

async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const data = await fs.readFile(filePath);
    return createHash("sha1").update(data).digest("hex");
  } catch {
    return null;
  }
}

function computeTextHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function extractDiffHash(detail: Readonly<Record<string, unknown>> | null): string | null {
  if (!detail) return null;
  const candidate = detail.diff ?? detail.patch ?? detail.delta;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return computeTextHash(candidate);
  }
  return null;
}

function resolvePreviewFilePath(preview: StoredPreview): string | null {
  const detail = preview.detail ?? null;
  if (detail && isRecord(detail)) {
    for (const key of FILE_PATH_KEYS) {
      const value = (detail as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
  }
  const original = preview.originalArgs;
  if (isRecord(original)) {
    for (const key of FILE_PATH_KEYS) {
      const value = original[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
  }
  return null;
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
  private autoApplyCap: number;
  private readonly autoApplyCounts = new Map<ChatSessionId, number>();
  private readonly cancellationAdapters: ToolCancellationAdapters;
  private readonly terminalSessionIndex = new Map<string, PreviewId>();

  constructor(deps: ApprovalsServiceDeps) {
    super();
    this.db = deps.db;
    this.security = deps.security;
    this.broadcast = deps.broadcast;
    this.logger = deps.logger ?? console;
    const cap = typeof deps.autoApplyCap === "number" && Number.isFinite(deps.autoApplyCap) ? deps.autoApplyCap : 5;
    this.autoApplyCap = cap > 0 ? Math.floor(cap) : 5;
    this.cancellationAdapters = deps.cancellationAdapters ?? {};
    this.setupTerminalAdapters();
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
      this.indexPreview(stored);
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

  async applyApproval(params: { approvalId: string; editedPayload?: unknown; feedbackText?: string | null; feedbackMeta?: unknown; resolvedBy?: string | null }): Promise<ServiceResult<ApplyResult>> {
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

      const feedbackText = typeof params.feedbackText === "string" ? params.feedbackText.trim() : "";
      const feedbackMeta = params.feedbackMeta ?? null;
      const resolvedBy = typeof params.resolvedBy === "string" && params.resolvedBy.trim().length > 0
        ? params.resolvedBy.trim()
        : "user";

      const isFileLikeTool = preview.tool === "file" || preview.tool === "edit";
      const targetPath = isFileLikeTool ? resolvePreviewFilePath(preview) : null;
      let beforeHash: string | null = null;
      let afterHash: string | null = null;
      let diffHash: string | null = null;

      if (isFileLikeTool && targetPath) {
        beforeHash = await computeFileHash(targetPath);
        diffHash = extractDiffHash(preview.detail ?? null);
      }

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
        resolvedBy,
      } satisfies UpdateApprovalStatusInput);

      if (feedbackText.length > 0 || feedbackMeta != null) {
        const updateFeedback: UpdateApprovalFeedbackInput = {
          id: approval.id,
          feedbackText: feedbackText.length > 0 ? feedbackText : null,
          feedbackMeta: feedbackMeta ?? null,
        };
        try {
          await this.db.updateApprovalFeedback(updateFeedback);
        } catch (error) {
          this.logger.warn?.("[ApprovalsService] Failed to persist approval feedback during apply", error);
        }
      }

      const updatedRow = await this.db.getApprovalById(approval.id);
      if (updatedRow) {
        const updated = toStoredApproval(updatedRow);
        this.emitEvent({ type: "agent:approval:update", approval: updated });
      }

      this.unindexPreview(preview);
      logApprovalEvent({ type: "apply", previewId: preview.id, sessionId: preview.sessionId, status: "applied" });

      if (feedbackText.length > 0) {
        try {
          await appendApprovalFeedbackMessage(preview.sessionId, approval.id, feedbackText, {
            resolvedBy,
            meta: feedbackMeta ?? null,
          });
        } catch (error) {
          this.logger.warn?.("[ApprovalsService] Failed to append approval feedback to chat", error);
          try {
            await this.updatePreviewDetail(preview.id, { feedbackPersisted: false });
          } catch (patchError) {
            this.logger.warn?.("[ApprovalsService] Failed to mark feedbackPersisted flag", patchError);
          }
        }
      }

      if (isFileLikeTool && targetPath) {
        afterHash = await computeFileHash(targetPath);
        const detailPatch: Record<string, unknown> = {};
        if (beforeHash) detailPatch.beforeHash = beforeHash;
        if (afterHash) detailPatch.afterHash = afterHash;
        if (diffHash) detailPatch.diffHash = diffHash;
        if (Object.keys(detailPatch).length > 0) {
          try {
            await this.updatePreviewDetail(preview.id, detailPatch);
          } catch (error) {
            this.logger.warn?.("[ApprovalsService] Failed to record file hashes", error);
          }
        }
      }

      return { ok: true, data: { status: "applied", approvalId: approval.id, previewId: approval.previewId, result } } as const;
    } catch (error) {
      this.logger.error?.("[ApprovalsService] applyApproval failed", error);
      return { ok: false, error: { code: "APPLY_ERROR", message: (error as Error)?.message ?? "Failed to apply approval" } } as const;
    }
  }

  async rejectApproval(params: { approvalId: string; feedbackText?: string | null; feedbackMeta?: unknown; resolvedBy?: string | null }): Promise<ServiceResult<StoredApproval>> {
    try {
      const approvalRow = await this.db.getApprovalById(params.approvalId);
      if (!approvalRow) {
        return { ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } } as const;
      }
      const previewForRejection = await this.safeGetPreview(params.approvalId as PreviewId);

      const feedbackText = typeof params.feedbackText === "string" ? params.feedbackText.trim() : "";
      const feedbackMeta = params.feedbackMeta ?? null;
      const resolvedBy = typeof params.resolvedBy === "string" && params.resolvedBy.trim().length > 0
        ? params.resolvedBy.trim()
        : "user";

      await this.db.updateApprovalStatus({
        id: params.approvalId,
        status: "rejected",
        resolvedAt: nowUnixMs(),
        resolvedBy,
      } satisfies UpdateApprovalStatusInput);

      if (feedbackText.length > 0 || feedbackMeta != null) {
        const updateFeedback: UpdateApprovalFeedbackInput = {
          id: params.approvalId,
          feedbackText: feedbackText.length > 0 ? feedbackText : null,
          feedbackMeta: feedbackMeta ?? null,
        };
        await this.db.updateApprovalFeedback(updateFeedback);
      }

      const row = await this.db.getApprovalById(params.approvalId);
      if (!row) {
        throw new Error("Approval missing after rejection");
      }
      const stored = toStoredApproval(row);
      this.emitEvent({ type: "agent:approval:update", approval: stored });
      this.unindexPreview(previewForRejection ?? undefined);
      if (previewForRejection) {
        logApprovalEvent({ type: "reject", previewId: previewForRejection.id, sessionId: previewForRejection.sessionId, status: stored.status });
        if (feedbackText.length > 0) {
          try {
            await appendApprovalFeedbackMessage(previewForRejection.sessionId, stored.id, feedbackText, {
              resolvedBy,
              meta: feedbackMeta ?? null,
            });
          } catch (error) {
            this.logger.warn?.("[ApprovalsService] Failed to append rejection feedback to chat", error);
            try {
              await this.updatePreviewDetail(previewForRejection.id, { feedbackPersisted: false });
            } catch (patchError) {
              this.logger.warn?.("[ApprovalsService] Failed to mark feedbackPersisted flag after rejection", patchError);
            }
          }
        }
      }
      return { ok: true, data: stored } as const;
    } catch (error) {
      this.logger.error?.("[ApprovalsService] rejectApproval failed", error);
      return { ok: false, error: { code: "REJECT_FAILED", message: (error as Error)?.message ?? "Failed to reject approval" } } as const;
    }
  }

  async cancelPreview(params: { previewId: PreviewId }): Promise<ServiceResult<null>> {
    try {
      const preview = await this.requirePreview(params.previewId);
      const approvalRow = await this.db.getApprovalById(params.previewId);
      if (!approvalRow) {
        return { ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } } as const;
      }
      const sessionIdValue = preview.detail?.["sessionId"];
      if (preview.tool === "terminal" && (typeof sessionIdValue === "string" || typeof sessionIdValue === "number")) {
        try {
          await this.cancellationAdapters.terminal?.kill?.(String(sessionIdValue));
        } catch (error) {
          this.logger.warn?.("[ApprovalsService] terminal cancellation failed", error);
        }
      }

      const resolvedAt = nowUnixMs();
      await this.db.updateApprovalStatus({
        id: approvalRow.id,
        status: "failed",
        resolvedAt,
        resolvedBy: "user",
        autoReason: "cancelled",
      });

      try {
        await this.updatePreviewDetail(preview.id, { streaming: "failed", cancelledAt: resolvedAt });
      } catch (error) {
        this.logger.warn?.("[ApprovalsService] Failed to persist cancellation detail", error);
      }
      this.unindexPreview(preview);
      logApprovalEvent({ type: "cancel", previewId: preview.id, sessionId: preview.sessionId, status: "failed" });
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
      const preview = await this.safeGetPreview(params.approvalId as PreviewId);
      if (preview) {
        logApprovalEvent({ type: "auto_approve", previewId: preview.id, sessionId: preview.sessionId, status: stored.status });
      }
      return { ok: true, data: stored } as const;
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] markAutoApproved failed", error);
      return { ok: false, error: { code: "AUTO_APPROVE_FAILED", message: (error as Error)?.message ?? "Failed to mark auto-approved" } } as const;
    }
  }

  async evaluateAutoPolicy(preview: PreviewEnvelope): Promise<"skipAll" | "tool" | "terminal-safe" | "none"> {
    try {
      // Global bypass
      const skipAllPref = await this.safeGetPreference("agent.approvals.skipAll");
      if (skipAllPref === true || skipAllPref === "true" || skipAllPref === 1 || skipAllPref === "1") {
        return "skipAll";
      }

      const tool = preview.tool;

      // Per-tool toggle
      const toolPref = await this.safeGetPreference(`agent.approvals.auto.${String(tool)}`);
      const toolEnabled = toolPref === true || toolPref === "true" || toolPref === 1 || toolPref === "1";
      if (!toolEnabled) {
        return "none";
      }

      // Terminal special handling
      if (tool === "terminal") {
        const modePref = await this.safeGetPreference("agent.approvals.terminal.autoMode");
        const mode = typeof modePref === "string" ? modePref.trim().toLowerCase() : (modePref === true ? "all" : "off");

        if (mode !== "safe" && mode !== "all") {
          return "none";
        }

        if (mode === "safe") {
          const cmdValue = preview.detail?.["command"] ?? preview.detail?.["cmd"] ?? "";
          const command = typeof cmdValue === "string" ? cmdValue : String(cmdValue ?? "");
          if (isRiskyCommand(command)) {
            return "none";
          }
          return "terminal-safe";
        }

        // mode === "all"
        return "tool";
      }

      // Non-terminal: per-tool toggle is sufficient
      return "tool";
    } catch {
      return "none";
    }
  }

  private async requirePreview(id: PreviewId): Promise<StoredPreview> {
    const row = await this.db.getPreviewById(id);
    if (!row) {
      throw new Error("Preview not found");
    }
    return toStoredPreview(row);
  }

  private async updatePreviewDetail(id: PreviewId, patch: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.updatePreviewDetail({ id, patch });
  }

  private async updateStreamingState(previewId: PreviewId, state: "running" | "ready" | "failed", patch: Readonly<Record<string, unknown>> = Object.freeze({})): Promise<void> {
    const detailPatch = Object.freeze({ streaming: state, ...patch });
    await this.updatePreviewDetail(previewId, detailPatch);
  }

  private setupTerminalAdapters(): void {
    const terminalAdapter = this.cancellationAdapters.terminal;
    if (!terminalAdapter) return;

    if (typeof terminalAdapter.onSessionCompleted === "function") {
      terminalAdapter.onSessionCompleted(async (sessionId) => {
        try {
          await this.handleTerminalSessionCompleted(sessionId);
        } catch (error) {
          this.logger.warn?.("[ApprovalsService] terminal session completion handling failed", error);
        }
      });
    }

    if (typeof terminalAdapter.onSessionOutput === "function") {
      terminalAdapter.onSessionOutput(async (sessionId, chunk) => {
        try {
          await this.handleTerminalSessionOutput(sessionId, chunk);
        } catch (error) {
          this.logger.warn?.("[ApprovalsService] terminal output handling failed", error);
        }
      });
    }
  }

  private indexPreview(preview: StoredPreview): void {
    const sessionValue = preview.detail?.["sessionId"];
    if (typeof sessionValue === "string" && sessionValue.trim().length > 0) {
      this.terminalSessionIndex.set(sessionValue, preview.id);
      return;
    }
    if (typeof sessionValue === "number" && Number.isFinite(sessionValue)) {
      this.terminalSessionIndex.set(String(sessionValue), preview.id);
    }
  }

  private unindexPreview(preview: StoredPreview | null | undefined): void {
    if (!preview?.detail) return;
    const sessionValue = preview.detail["sessionId"];
    if (typeof sessionValue === "string" && sessionValue.trim().length > 0) {
      this.terminalSessionIndex.delete(sessionValue);
      return;
    }
    if (typeof sessionValue === "number" && Number.isFinite(sessionValue)) {
      this.terminalSessionIndex.delete(String(sessionValue));
    }
  }

  private async handleTerminalSessionCompleted(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const previewId = this.terminalSessionIndex.get(sessionId);
    if (!previewId) return;
    this.terminalSessionIndex.delete(sessionId);
    try {
      await this.updateStreamingState(previewId, "ready", Object.freeze({ completedAt: nowUnixMs() }));
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] Failed to persist terminal completion state", error);
    }
  }

  private async handleTerminalSessionOutput(sessionId: string, _chunk: string | undefined): Promise<void> {
    if (!sessionId) return;
    const previewId = this.terminalSessionIndex.get(sessionId);
    if (!previewId) return;
    try {
      await this.updateStreamingState(previewId, "running", Object.freeze({ lastOutputAt: nowUnixMs() }));
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] Failed to persist terminal output state", error);
    }
  }

  private async safeGetPreview(id: PreviewId): Promise<StoredPreview | null> {
    try {
      const row = await this.db.getPreviewById(id);
      return row ? toStoredPreview(row) : null;
    } catch (error) {
      this.logger.warn?.("[ApprovalsService] Failed to fetch preview during terminal event", error);
      return null;
    }
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
    const preview = await this.safeGetPreview(approvalId as PreviewId);
    this.unindexPreview(preview);
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

  notifyAutoCapReached(sessionId: ChatSessionId): void {
    const cap = this.autoApplyCap;
    const count = this.autoApplyCounts.get(sessionId) ?? cap;
    const event: ApprovalEventPayload = {
      type: "agent:auto_approval_cap_reached",
      sessionId,
      cap,
      count,
    };
    this.logger.log?.("[ApprovalsService] auto-approve cap reached", { sessionId, cap, count });
    this.emitEvent(event);
  }

  async shouldNotifyPendingApprovals(): Promise<boolean> {
    const value = await this.safeGetPreference("agent.approvals.notifications");
    if (value === true || value === "true") {
      return true;
    }
    if (typeof value === "number") {
      return value > 0;
    }
    if (typeof value === "string") {
      return value === "1" || value.toLowerCase() === "yes";
    }
    return false;
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

  updateAutoApplyCap(value: number | null | undefined): void {
    const cap = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : this.autoApplyCap;
    this.autoApplyCap = cap > 0 ? cap : 0;
    if (this.autoApplyCap === 0) {
      this.autoApplyCounts.clear();
      return;
    }
    for (const [sessionId, count] of this.autoApplyCounts.entries()) {
      if (count > this.autoApplyCap) {
        this.autoApplyCounts.set(sessionId, this.autoApplyCap);
      }
    }
  }
}
