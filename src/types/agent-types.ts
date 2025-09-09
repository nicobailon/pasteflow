// Types shared across agent-related components
// Strictly typed to comply with project TypeScript guidelines (no any)

export type NoticeVariant = 'warning' | 'info' | 'error';

export interface Notice {
  readonly id: string;
  readonly variant: NoticeVariant;
  readonly message: string;
}

export interface ErrorInfoPayload {
  readonly status: number;
  readonly code?: string;
  readonly message?: string;
  // Use unknown for untyped payloads arriving from IPC/server boundaries
  readonly details?: unknown;
}

export interface AgentAttachment {
  readonly path: string;
  readonly content?: string;
  readonly tokenCount?: number;
  readonly lines?: { readonly start: number; readonly end: number } | null;
}

export interface UsageRow {
  readonly id: number;
  readonly session_id: string;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly latency_ms: number | null;
  readonly cost_usd: number | null;
  readonly created_at: number;
}

export interface SessionTotals {
  readonly inSum: number;
  readonly outSum: number;
  readonly totalSum: number;
  readonly approx: boolean;
  readonly costUsd: number | null;
}

// Minimal UI message surface used by renderer components
export interface UiMessagePart {
  readonly type?: string;
  readonly text?: string;
}

export interface UiMessageShape {
  readonly role?: string;
  readonly parts?: readonly UiMessagePart[];
  readonly content?: string;
  // Allow unknown vendor-specific fields without widening the known ones
  readonly [k: string]: unknown;
}

