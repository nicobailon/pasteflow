import type { ServiceResult, StoredApproval, StoredPreview, AutoRule } from "../main/agent/approvals-service";
import type { ToolArgsSnapshot, ToolName } from "../main/agent/preview-registry";
import type { ApprovalStatus } from "../main/db/database-implementation";

export type ServiceError = { readonly code: string; readonly message: string };
export type PlainRecord = Record<string, unknown>;

export type StreamingState = "pending" | "running" | "ready" | "failed";

const TOOL_NAME_SET: ReadonlySet<ToolName> = new Set(["file", "edit", "terminal", "search", "context"]);
const STREAMING_VALUES: ReadonlySet<StreamingState> = new Set(["pending", "running", "ready", "failed"]);

export function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) return Object.freeze({});
  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    copy[key] = val;
  }
  return Object.freeze(copy);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidToolName(value: unknown): value is ToolName {
  return typeof value === "string" && TOOL_NAME_SET.has(value as ToolName);
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return value === "pending" || value === "approved" || value === "applied" || value === "rejected" || value === "auto_approved" || value === "failed";
}

export function parseServiceError(value: unknown): ServiceError {
  if (isPlainRecord(value)) {
    const code = isString(value.code) ? value.code : "UNKNOWN";
    const message = isString(value.message) ? value.message : "Unknown error";
    return { code, message } as const;
  }
  return { code: "UNKNOWN", message: "Unknown error" } as const;
}

export function normalizeServiceResult<T>(value: unknown): ServiceResult<T> {
  if (!isPlainRecord(value)) {
    return { ok: false, error: { code: "INVALID_RESPONSE", message: "Service response malformed" } };
  }
  if (value.ok === true) {
    return { ok: true, data: value.data as T };
  }
  return { ok: false, error: parseServiceError(value.error) };
}

export function parseStoredPreview(value: unknown): StoredPreview | null {
  if (!isPlainRecord(value)) return null;
  const id = value.id;
  const sessionId = value.sessionId;
  const toolExecutionId = value.toolExecutionId;
  const tool = value.tool;
  const action = value.action;
  const summary = value.summary;
  const detail = value.detail ?? null;
  const originalArgs = value.originalArgs ?? {};
  const createdAt = value.createdAt;
  const hash = value.hash;
  if (!isString(id) || !isString(sessionId) || !isNumber(toolExecutionId) || !isValidToolName(tool) || !isString(action) || !isString(summary) || !isString(hash) || !isNumber(createdAt)) {
    return null;
  }
  if (!(detail === null || isPlainRecord(detail))) return null;
  if (!isPlainRecord(originalArgs)) return null;
  return {
    id: id as StoredPreview["id"],
    sessionId: sessionId as StoredPreview["sessionId"],
    toolExecutionId,
    tool: tool as ToolName,
    action,
    summary,
    detail: detail === null ? null : Object.freeze({ ...detail }),
    originalArgs: Object.freeze({ ...originalArgs }) as ToolArgsSnapshot,
    createdAt,
    hash,
  } as StoredPreview;
}

export function parseStoredApproval(value: unknown): StoredApproval | null {
  if (!isPlainRecord(value)) return null;
  const id = value.id;
  const previewId = value.previewId;
  const sessionId = value.sessionId;
  const status = value.status;
  const createdAt = value.createdAt;
  const resolvedAt = value.resolvedAt ?? null;
  const resolvedBy = value.resolvedBy ?? null;
  const autoReason = value.autoReason ?? null;
  const feedbackText = value.feedbackText ?? null;
  const feedbackMeta = value.feedbackMeta ?? null;
  if (!isString(id) || !isString(previewId) || !isString(sessionId) || !isApprovalStatus(status) || !isNumber(createdAt)) {
    return null;
  }
  if (!(resolvedAt === null || isNumber(resolvedAt))) return null;
  if (!(resolvedBy === null || isString(resolvedBy))) return null;
  if (!(autoReason === null || isString(autoReason))) return null;
  if (!(feedbackText === null || isString(feedbackText))) return null;
  if (!(feedbackMeta === null || isPlainRecord(feedbackMeta))) return null;
  return {
    id,
    previewId: previewId as StoredApproval["previewId"],
    sessionId: sessionId as StoredApproval["sessionId"],
    status,
    createdAt,
    resolvedAt,
    resolvedBy,
    autoReason,
    feedbackText,
    feedbackMeta: feedbackMeta === null ? null : Object.freeze({ ...feedbackMeta }),
  } as StoredApproval;
}

export function deriveStreamingState(detail: Readonly<Record<string, unknown>> | null): StreamingState {
  if (!detail) return "ready";
  const candidate = detail.streamingState ?? detail.streaming ?? detail.streamState ?? detail.state;
  if (typeof candidate === "string") {
    const normalized = candidate.toLowerCase();
    if (STREAMING_VALUES.has(normalized as StreamingState)) {
      return normalized as StreamingState;
    }
    if (normalized === "completed" || normalized === "done" || normalized === "ready") {
      return "ready";
    }
    if (normalized === "error" || normalized === "failed") {
      return "failed";
    }
    if (normalized === "running" || normalized === "in_progress") {
      return "running";
    }
    if (normalized === "queued" || normalized === "pending") {
      return "pending";
    }
  }
  if (detail.streaming === true || detail.inProgress === true) return "running";
  if (detail.cancelled === true) return "failed";
  if (typeof detail.sessionId === "string" && detail.completed !== true) return "running";
  return "ready";
}

export function serializeAutoRule(rule: AutoRule): Readonly<Record<string, unknown>> {
  return toRecord(rule);
}
