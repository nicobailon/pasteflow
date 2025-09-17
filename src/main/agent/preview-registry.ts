import { createHash } from "node:crypto";

import { v4 as uuidv4, validate as validateUuid, version as uuidVersion } from "uuid";

export type PreviewId = string & { readonly __brand: "PreviewId" };
export type ChatSessionId = string & { readonly __brand: "ChatSessionId" };
export type UnixMs = number & { readonly __brand: "UnixMs" };
export type ToolName = "file" | "edit" | "terminal" | "search" | "context";
export type ToolAction = string;
export type ToolArgsSnapshot = Readonly<Record<string, unknown>>;

const TOOL_NAMES: readonly ToolName[] = ["file", "edit", "terminal", "search", "context"];

type MutablePreviewEnvelope = {
  id: PreviewId;
  sessionId: ChatSessionId;
  tool: ToolName;
  action: ToolAction;
  summary: string;
  detail: Record<string, unknown> | null;
  originalArgs: ToolArgsSnapshot;
  createdAt: UnixMs;
  hash: string;
};

export type PreviewEnvelope = Readonly<MutablePreviewEnvelope>;

function assertUuidV4(value: string, label: string): void {
  if (!validateUuid(value) || uuidVersion(value) !== 4) {
    throw new TypeError(`${label} must be a valid UUIDv4`);
  }
}

export function makePreviewId(value?: string): PreviewId {
  if (value) {
    assertUuidV4(value, "PreviewId");
    return value as PreviewId;
  }
  return uuidv4() as PreviewId;
}

export function makeSessionId(value?: string): ChatSessionId {
  if (value) {
    assertUuidV4(value, "ChatSessionId");
    return value as ChatSessionId;
  }
  return uuidv4() as ChatSessionId;
}

export function nowUnixMs(): UnixMs {
  return Date.now() as UnixMs;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value as ToolName);
}

function isToolArgsSnapshot(value: unknown): value is ToolArgsSnapshot {
  return isPlainRecord(value);
}

function isValidUnixMs(value: unknown): value is UnixMs {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

export function isPreviewEnvelope(value: unknown): value is PreviewEnvelope {
  if (!isPlainRecord(value)) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.id !== "string") return false;
  if (!safeValidatePreviewId(candidate.id)) return false;

  if (typeof candidate.sessionId !== "string") return false;
  if (!safeValidateSessionId(candidate.sessionId)) return false;

  if (!isToolName(candidate.tool)) return false;

  if (typeof candidate.action !== "string" || candidate.action.trim().length === 0) return false;
  if (typeof candidate.summary !== "string" || candidate.summary.trim().length === 0) return false;

  if (!("detail" in candidate)) return false;
  const detail = candidate.detail as unknown;
  if (detail !== null && !isPlainRecord(detail)) return false;

  if (!("originalArgs" in candidate)) return false;
  if (!isToolArgsSnapshot(candidate.originalArgs)) return false;

  if (!isValidUnixMs(candidate.createdAt)) return false;

  return typeof candidate.hash === "string" && candidate.hash.length >= 16;
}

export function assertPreviewEnvelope(value: unknown): asserts value is PreviewEnvelope {
  if (!isPreviewEnvelope(value)) {
    throw new TypeError("Value is not a valid PreviewEnvelope");
  }
}

function safeValidatePreviewId(value: string): boolean {
  try {
    makePreviewId(value);
    return true;
  } catch {
    return false;
  }
}

function safeValidateSessionId(value: string): boolean {
  try {
    makeSessionId(value);
    return true;
  } catch {
    return false;
  }
}

export function hashPreview(input: {
  tool: ToolName;
  action: string;
  args: ToolArgsSnapshot;
  detail: Record<string, unknown> | null;
}): string {
  const hash = createHash("sha256");
  hash.update(input.tool);
  hash.update("\u0000");
  hash.update(input.action);
  hash.update("\u0000");
  hash.update(JSON.stringify(input.args ?? {}));
  hash.update("\u0000");
  hash.update(JSON.stringify(input.detail ?? {}));
  return hash.digest("hex");
}
