// Shared type contracts for agent tools

export type ContextAction = "summary" | "expand" | "search";

export type ContextSummaryParams = { action?: "summary"; envelope?: unknown };
export type ContextExpandFileRequest = { path: string; lines?: { start: number; end: number } };
export type ContextExpandParams = { action: "expand"; files: readonly ContextExpandFileRequest[]; maxBytes?: number };
export type ContextSearchParams = { action: "search"; query: string; directory?: string; maxResults?: number };
export type ContextToolParams = ContextSummaryParams | ContextExpandParams | ContextSearchParams | Record<string, unknown>;

export type ContextError = { type: "error"; code: string; message: string };
export type ContextSummaryResult = { initialFiles: number; dynamicFiles: number };
export type ExpandFileSuccess = { path: string; content: string; bytes: number; tokenCount: number; truncated?: boolean };
export type ExpandFileError = { path: string; error: { code: string; message: string } };
export type ContextExpandResult = { files: readonly (ExpandFileSuccess | ExpandFileError)[]; truncated: boolean };
export type ContextSearchMatch = { line: number; text: string };
export type ContextSearchFile = { path: string; matches: readonly ContextSearchMatch[] };
export type ContextSearchResult = { files: readonly ContextSearchFile[]; totalMatches: number; truncated: boolean };
export type ContextResult = ContextSummaryResult | ContextExpandResult | ContextSearchResult | ContextError;

