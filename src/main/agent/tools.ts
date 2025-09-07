import { tool, jsonSchema } from "ai";

import { getMainTokenService } from "../../services/token-service-main";
import { validateAndResolvePath, readTextFile, statFile as statFileFs, writeTextFile } from "../file-service";
import { runRipgrepJson } from "../tools/ripgrep";

import type { AgentSecurityManager } from "./security-manager";
import type { AgentConfig } from "./config";
import { generateFromTemplate as genFromTemplate } from "./template-engine";
import type {
  ContextAction,
  ContextToolParams,
  ContextResult,
  ContextSummaryParams,
  ContextExpandParams,
  ContextSearchParams,
  ExpandFileSuccess,
  ExpandFileError,
  ContextSearchResult,
} from "./tool-types";

/**
 * Returns the tools registry available to the agent in Phase 3.
 * - file: read file content (optionally by lines) and count tokens
 * - search: ripgrep JSON code search
 * - edit: preview-only diff (apply is gated for Phase 4)
 * - context: summarize the dual-context envelope sizes
 * - terminal: stubbed (Phase 4)
 */
export function getAgentTools(deps?: {
  signal?: AbortSignal;
  security?: AgentSecurityManager | null;
  config?: AgentConfig | null;
  onToolExecute?: (name: string, args: unknown, result: unknown, meta?: Record<string, unknown>) => void | Promise<void>;
  sessionId?: string | null;
}) {
  const tokenService = getMainTokenService();

  // Context tool typings moved to ./tool-types to share across modules

  // Define JSON Schemas explicitly (avoid zod-to-JSON-schema pitfalls)
  const lineRangeSchema: any = {
    type: "object",
    properties: {
      start: { type: "integer", minimum: 1 },
      end: { type: "integer", minimum: 1 },
    },
    required: ["start", "end"],
    additionalProperties: false,
  };

  const fileParamsSchema: any = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "info", "list", "write", "move", "delete"] },
      path: { type: "string" },
      lines: lineRangeSchema,
      directory: { type: "string" },
      recursive: { type: "boolean" },
      maxResults: { type: "integer", minimum: 1, maximum: 10_000 },
      content: { type: "string" },
      apply: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  const file = (tool as any)({
    description: "File operations within the workspace (read/info/list; write/move/delete gated)",
    inputSchema: jsonSchema(fileParamsSchema),
    execute: async (params: any) => {
      // Default to 'read' for backward compatibility when action is omitted
      const action = String(params?.action || "read");
      const cfg = deps?.config || null;

      const t0 = Date.now();
      const record = async (result: unknown) => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try { await deps?.onToolExecute?.("file", params, result, meta as any); } catch { /* noop */ }
        return result;
      };

      if (deps?.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: 'RATE_LIMITED', message: 'Tool execution rate limited' });
      }
      if (action === "read") {
        if (typeof params.path !== "string" || params.path.trim() === "") {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'path' is required for action=read" });
        }
        const path = params.path as string;
        const lines = (params.lines ?? null) as { start: number; end: number } | null;
        const val = validateAndResolvePath(path);
        if (!val.ok) throw new Error(val.message);

        const r = await readTextFile(val.absolutePath);
        if (!r.ok) throw new Error(r.message);
        if (r.isLikelyBinary) throw new Error("File contains binary data");

        let content = r.content;
        if (lines) {
          try {
            const arr = content.split(/\r?\n/);
            const start = Math.max(1, lines.start);
            const end = Math.max(start, Math.min(arr.length, lines.end));
            content = arr.slice(start - 1, end).join("\n");
          } catch {
            // fall back to full content
          }
        }

        const { count } = await tokenService.countTokens(content);
        return record({ path: val.absolutePath, content, tokenCount: count });
      }

      if (action === "info") {
        if (typeof params.path !== "string" || params.path.trim() === "") {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'path' is required for action=info" });
        }
        const v = validateAndResolvePath(params.path);
        if (!v.ok) throw new Error(v.message);
        const s = await statFileFs(v.absolutePath);
        if (!s.ok) throw new Error(s.message);
        return record(s.data);
      }

      if (action === "list") {
        if (typeof params.directory !== "string" || params.directory.trim() === "") {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'directory' is required for action=list" });
        }
        const dirVal = validateAndResolvePath(params.directory);
        if (!dirVal.ok) throw new Error(dirVal.message);
        const fs = await import("node:fs");
        const p = await import("node:path");
        const recursive = params.recursive === true;
        const cap = Math.min(Number(params.maxResults || 0) || (cfg?.MAX_RESULTS_PER_TOOL ?? 200), 10_000);
        const out: { path: string; name: string; isDirectory: boolean; size?: number; mtimeMs?: number }[] = [];
        const queue: string[] = [dirVal.absolutePath];
        while (queue.length > 0 && out.length < cap) {
          const d = queue.shift()!;
          let dirents: import("node:fs").Dirent[] = [];
          try { dirents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
          for (const ent of dirents) {
            const full = p.join(d, ent.name);
            if (out.length >= cap) break;
            try {
              const st = await fs.promises.stat(full);
              if (ent.isDirectory()) {
                out.push({ path: full, name: ent.name, isDirectory: true, mtimeMs: st.mtimeMs });
                if (recursive) queue.push(full);
              } else if (ent.isFile()) {
                out.push({ path: full, name: ent.name, isDirectory: false, size: st.size, mtimeMs: st.mtimeMs });
              }
            } catch { /* skip */ }
          }
        }
        const truncated = out.length >= cap;
        return record({ directory: dirVal.absolutePath, items: out, truncated });
      }

      // Phase 4 gated destructive ops -> return structured denial unless explicitly enabled and approved
      if (action === "write" || action === "move" || action === "delete") {
        const enabled = cfg?.ENABLE_FILE_WRITE === true;
        const requireApproval = cfg?.REQUIRE_APPROVAL !== false;
        if (!enabled) return record({ type: "error" as const, code: "WRITE_DISABLED", message: "File writes are disabled" });
        if (requireApproval) return record({ type: "error" as const, code: "APPROVAL_REQUIRED", message: "Apply requires approval (Phase 4)" });
        return record({ type: "error" as const, code: "NOT_IMPLEMENTED", message: "Write path not implemented" });
      }

      return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown file.action: ${action}` });
    },
  });

  const search = (tool as any)({
    description: "Search operations (code search via ripgrep; file glob)",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        action: { type: "string", enum: ["code", "files"] },
        query: { type: "string" },
        directory: { type: "string" },
        maxResults: { type: "integer", minimum: 1, maximum: 50_000 },
        pattern: { type: "string" },
        recursive: { type: "boolean" },
      },
      required: ["action"],
      additionalProperties: false,
    } as any),
    execute: async (params: any) => {
      const cfg = deps?.config || null;
      const t0 = Date.now();
      const record = async (result: unknown) => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try { await deps?.onToolExecute?.("search", params, result, meta as any); } catch { /* noop */ }
        return result;
      };
      if (deps?.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: 'RATE_LIMITED', message: 'Tool execution rate limited' });
      }
      const isCode = params.action === "code";
      if (isCode) {
        if (typeof params.query !== "string" || params.query.trim() === "") {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'query' is required for action=code" });
        }
        const max = Math.min(Number(params?.maxResults || 0) || (cfg?.MAX_SEARCH_MATCHES ?? 500), cfg?.MAX_SEARCH_MATCHES ?? 500);
        const r = await runRipgrepJson({ query: params.query, directory: params.directory, maxResults: max, signal: deps?.signal });
        return record({ ...r, clipped: !!(r as any).truncated });
      }
      if (params.action === "files") {
        if (typeof params.pattern !== "string" || params.pattern.trim() === "") {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'pattern' is required for action=files" });
        }
        // Simple file name contains filter within a directory (non-recursive by default)
        const fs = await import("node:fs");
        const p = await import("node:path");
        const dirVal = validateAndResolvePath(String(params.directory || "."));
        if (!dirVal.ok) throw new Error(dirVal.message);
        const cap = Math.min(Number(params.maxResults || 0) || (cfg?.MAX_RESULTS_PER_TOOL ?? 200), 10_000);
        const recursive = params.recursive === true;
        const needle = String(params.pattern).toLowerCase();
        const out: string[] = [];
        const queue: string[] = [dirVal.absolutePath];
        while (queue.length > 0 && out.length < cap) {
          const d = queue.shift()!;
          let dirents: import("node:fs").Dirent[] = [];
          try { dirents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
          for (const ent of dirents) {
            const full = p.join(d, ent.name);
            if (out.length >= cap) break;
            if (ent.isDirectory()) { if (recursive) queue.push(full); continue; }
            if (ent.isFile() && ent.name.toLowerCase().includes(needle)) out.push(full);
          }
        }
        const truncated = out.length >= cap;
        return record({ directory: dirVal.absolutePath, matches: out, truncated });
      }
      return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown search.action: ${String(params?.action)}` });
    },
  });

  const edit = (tool as any)({
    description: "Preview or apply a unified diff to a file",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        diff: { type: "string" },
        apply: { type: "boolean", default: false },
      },
      required: ["path", "diff"],
      additionalProperties: false,
    } as any),
    execute: async ({ path, diff, apply }: { path: string; diff: string; apply: boolean }) => {
      const onExec = deps?.onToolExecute;
      const t0 = Date.now();
      const val = validateAndResolvePath(path);
      if (!val.ok) throw new Error(val.message);

      if (!apply) {
        // Read original content for preview
        const r = await readTextFile(val.absolutePath);
        if (!r.ok) throw new Error(r.message);
        if (r.isLikelyBinary) throw new Error("File contains binary data");

        const original = r.content;
        const { result: modified, applied, error: applyError } = applyUnifiedDiffSafe(original, diff);

        // Count tokens for both sides (best-effort)
        const [{ count: originalTokens }, { count: modifiedTokens }] = await Promise.all([
          tokenService.countTokens(original),
          tokenService.countTokens(modified)
        ]);

        const clip = (s: string, max = 20_000) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);

        const result = {
          type: "preview" as const,
          path: val.absolutePath,
          applied,
          error: applyError || undefined,
          diff,
          original: clip(original),
          modified: clip(modified),
          tokenCounts: { original: originalTokens, modified: modifiedTokens },
        };
        try { await onExec?.("edit", { path, diff, apply }, result, { startedAt: t0, durationMs: Date.now() - t0 }); } catch { /* noop */ }
        return result;
      }
      const cfg = deps?.config || null;
      if (!cfg?.ENABLE_FILE_WRITE) {
        const errRes = { type: "error" as const, message: "File writes disabled" } as const;
        try { await onExec?.("edit", { path, diff, apply }, errRes, { startedAt: t0, durationMs: Date.now() - t0 }); } catch { /* noop */ }
        return errRes;
      }
      if (cfg?.REQUIRE_APPROVAL !== false) {
        const errRes = { type: "error" as const, message: "Apply requires approval (Phase 4)" } as const;
        try { await onExec?.("edit", { path, diff, apply }, errRes, { startedAt: t0, durationMs: Date.now() - t0 }); } catch { /* noop */ }
        return errRes;
      }
      // Apply diff and write file
      const r0 = await readTextFile(val.absolutePath);
      if (!r0.ok) throw new Error(r0.message);
      if (r0.isLikelyBinary) throw new Error("File contains binary data");
      const appliedRes = applyUnifiedDiffSafe(r0.content, diff);
      if (!appliedRes.applied) {
        const errRes = { type: "error" as const, message: appliedRes.error || "Failed to apply diff" } as const;
        try { await onExec?.("edit", { path, diff, apply }, errRes, { startedAt: t0, durationMs: Date.now() - t0 }); } catch { /* noop */ }
        return errRes;
      }
      const w = await writeTextFile(val.absolutePath, appliedRes.result);
      if (!w.ok) throw new Error(w.message);
      const okRes = { type: "applied" as const, path: val.absolutePath, bytes: w.bytes };
      try { await onExec?.("edit", { path, diff, apply }, okRes, { startedAt: t0, durationMs: Date.now() - t0 }); } catch { /* noop */ }
      return okRes;
    },
  });

  // Consolidated Context tool: summary | expand | search
  const context = (tool as any)({
    description: "Context utilities: summary | expand | search",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        action: { type: "string", enum: ["summary", "expand", "search"] },
        envelope: {},
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              lines: {
                type: "object",
                properties: {
                  start: { type: "integer", minimum: 1 },
                  end: { type: "integer", minimum: 1 },
                },
                required: ["start", "end"],
                additionalProperties: false,
              },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
        maxBytes: { type: "integer", minimum: 1, maximum: 1_000_000 },
        query: { type: "string" },
        directory: { type: "string" },
        maxResults: { type: "integer", minimum: 1, maximum: 50_000 },
      },
      required: [],
      additionalProperties: true,
    } as any),
    execute: async (params: ContextToolParams): Promise<ContextResult> => {
      const t0 = Date.now();
      const record = async (result: ContextResult): Promise<ContextResult> => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try { await deps?.onToolExecute?.("context", params, result, meta as any); } catch { /* noop */ }
        return result;
      };

      if (deps?.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: 'RATE_LIMITED', message: 'Tool execution rate limited' });
      }

      const action: ContextAction = (params as any)?.action || "summary";
      const cfg = deps?.config || null;

      // summary: counts initial/dynamic files in envelope
      if (action === "summary") {
        const envelope = (params as ContextSummaryParams)?.envelope as unknown;
        const initFiles = (envelope && (envelope as any).initial && Array.isArray((envelope as any).initial.files))
          ? (envelope as any).initial.files.length
          : 0;
        const dynFiles = (envelope && (envelope as any).dynamic && Array.isArray((envelope as any).dynamic.files))
          ? (envelope as any).dynamic.files.length
          : 0;
        return record({ initialFiles: initFiles, dynamicFiles: dynFiles });
      }

      // expand: load file contents or line ranges with token counts and size caps
      if (action === "expand") {
        const filesParam = Array.isArray((params as any)?.files)
          ? (params as ContextExpandParams).files
          : null;
        if (!filesParam || filesParam.length === 0) {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'files' array is required for action=expand" });
        }
        const MAX_FILES = Math.min(cfg?.MAX_RESULTS_PER_TOOL ?? 200, 20);
        const capFiles = filesParam.slice(0, MAX_FILES);
        const truncatedList = filesParam.length > capFiles.length;
        const perFileMaxBytes = Math.min(Math.max(Number((params as any)?.maxBytes || 0) || 50_000, 1), 200_000);

        const out: (ExpandFileSuccess | ExpandFileError)[] = [];

        for (const f of capFiles) {
          const pth = typeof f?.path === "string" ? f.path : "";
          if (!pth) { out.push({ path: "", error: { code: "VALIDATION_ERROR", message: "Invalid file path" } }); continue; }
          const v = validateAndResolvePath(pth);
          if (!v.ok) { out.push({ path: pth, error: { code: v.code || "PATH_DENIED", message: v.message } }); continue; }

          const r = await readTextFile(v.absolutePath);
          if (!r.ok) {
            // Treat binary/not-found/etc as per-item error
            out.push({ path: v.absolutePath, error: { code: r.code || "FILE_ERROR", message: r.message } });
            continue;
          }
          if (r.isLikelyBinary) {
            out.push({ path: v.absolutePath, error: { code: "BINARY_FILE", message: "File contains binary data" } });
            continue;
          }

          let content = r.content;
          // Optional slicing by 1-based inclusive lines
          const lines = f?.lines;
          if (lines && Number.isFinite(lines.start) && Number.isFinite(lines.end)) {
            try {
              const arr = content.split(/\r?\n/);
              const start = Math.max(1, Math.floor(lines.start));
              const end = Math.max(start, Math.min(arr.length, Math.floor(lines.end)));
              content = arr.slice(start - 1, end).join("\n");
            } catch { /* keep full content */ }
          }

          let truncated = false;
          const bytes = Buffer.byteLength(content, "utf8");
          if (bytes > perFileMaxBytes) {
            const encoder = new TextEncoder();
            // Clip by UTF-8 bytes, not code units
            const buf = encoder.encode(content);
            const sliced = buf.slice(0, perFileMaxBytes);
            const decoder = new TextDecoder("utf8", { fatal: false });
            content = decoder.decode(sliced);
            truncated = true;
          }

          const { count } = await tokenService.countTokens(content);
          out.push({ path: v.absolutePath, content, bytes: Buffer.byteLength(content, "utf8"), tokenCount: count, truncated });
        }

        return record({ files: out, truncated: truncatedList });
      }

      // search: delegate to ripgrep and compact the result
      if (action === "search") {
        const searchParams = params as ContextSearchParams;
        if (typeof (searchParams as any)?.query !== "string" || searchParams.query.trim() === "") {
          return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'query' is required for action=search" });
        }
        const max = (() => {
          const requested = Number((searchParams as any)?.maxResults || 0);
          const upper = cfg?.MAX_SEARCH_MATCHES ?? 500;
          if (Number.isFinite(requested) && requested > 0) return Math.min(requested, upper);
          return upper;
        })();
        const rr = await runRipgrepJson({ query: searchParams.query, directory: searchParams?.directory, maxResults: max, signal: deps?.signal });
        const compact: ContextSearchResult = {
          files: rr.files.map((f) => ({ path: f.path, matches: f.matches.map((m) => ({ line: m.line, text: m.text })) })),
          totalMatches: rr.totalMatches,
          truncated: rr.truncated,
        };
        return record(compact);
      }

      return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown context.action: ${String(params?.action)}` });
    },
  });

  const terminal = (tool as any)({
    description: "Terminal execution (stubbed in Phase 3)",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    } as any),
    execute: async () => ({ notImplemented: true }),
  });

  const generateFromTemplate = (tool as any)({
    description: "Generate file previews from a template (no writes)",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        type: { type: "string", enum: ["component", "hook", "api-route", "test"] },
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["type", "name"],
      additionalProperties: false,
    } as any),
    execute: async ({ type, name }: { type: 'component'|'hook'|'api-route'|'test'; name: string }) => {
      const result = await genFromTemplate(name, type as any);
      // Clip overly large content blobs for safety
      const MAX = 40_000;
      const clippedFiles = result.files.map((f) => ({
        path: f.path,
        content: f.content.length > MAX ? f.content.slice(0, MAX) + "\n…(truncated)" : f.content,
      }));
      return { ...result, files: clippedFiles };
    },
  });

  return { file, search, edit, context, terminal, generateFromTemplate } as const;
}

/**
 * Minimal unified-diff applier for preview only. Supports basic @@ hunks with
 * ' ', '+', '-' lines. Ignores '\\ No newline at end of file' markers.
 * Best-effort: validates context lines; bails out gracefully on mismatch.
 */
function applyUnifiedDiffSafe(original: string, diffText: string): { result: string; applied: boolean; error?: string } {
  try {
    const origLines = original.split(/\r?\n/);
    const lines = diffText.split(/\r?\n/);

    type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; body: string[] };
    const hunks: Hunk[] = [];
    let i = 0;

    // Skip headers (---/+++), collect hunks
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith("@@")) {
        const m = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(l);
        if (!m) return { result: original, applied: false, error: "Invalid hunk header" };
        const oldStart = Number(m[1]);
        const oldCount = Number(m[2] || "1");
        const newStart = Number(m[3]);
        const newCount = Number(m[4] || "1");
        i++;
        const body: string[] = [];
        while (i < lines.length && !lines[i].startsWith("@@")) {
          const hl = lines[i];
          if (/^([ +\\-])/.test(hl)) body.push(hl);
          else break; // end of hunk body if unexpected
          i++;
        }
        hunks.push({ oldStart, oldCount, newStart, newCount, body });
      } else {
        i++;
      }
    }

    if (hunks.length === 0) {
      // Not a unified diff; treat provided text as the full new content (fallback)
      return { result: diffText, applied: false, error: "No hunks found; treated diff as full content" };
    }

    const out: string[] = [];
    let cursor = 0; // index in origLines

    for (const h of hunks) {
      const hStart = Math.max(0, h.oldStart - 1);
      if (hStart < cursor) return { result: original, applied: false, error: "Overlapping hunks not supported" };
      // Append unchanged region up to hunk start
      for (let k = cursor; k < hStart; k++) out.push(origLines[k] ?? "");
      cursor = hStart;

      // Apply hunk body
      for (const hl of h.body) {
        const tag = hl[0];
        const text = hl.slice(1);
        switch (tag) {
          case ' ': {
            // Validate context matches original
            if ((origLines[cursor] ?? "") !== text) {
              return { result: original, applied: false, error: "Context mismatch while applying hunk" };
            }
            out.push(text);
            cursor++;
            break;
          }
          case '-': {
            // Optional validation: ensure original matches
            if ((origLines[cursor] ?? "") !== text) {
              return { result: original, applied: false, error: "Removal mismatch while applying hunk" };
            }
            cursor++;
            break;
          }
          case '+': {
            out.push(text);
            break;
          }
          case '\\': {
            // "\\ No newline at end of file" — ignore
            break;
          }
          default: {
            // Unexpected marker — treat as error to avoid silent corruption
            return { result: original, applied: false, error: "Invalid hunk line marker" };
          }
        }
      }
    }

    // Append remaining original lines after last hunk
    for (let k = cursor; k < origLines.length; k++) out.push(origLines[k] ?? "");

    return { result: out.join("\n"), applied: true };
  } catch (error: any) {
    return { result: original, applied: false, error: String(error?.message || error) };
  }
}
