import { tool, jsonSchema } from "ai";

import { getMainTokenService } from "../../services/token-service-main";
import { validateAndResolvePath, readTextFile, statFile as statFileFs, writeTextFile } from "../file-service";
import { runRipgrepJson } from "../tools/ripgrep";

import type { AgentSecurityManager } from "./security-manager";
import type { AgentConfig } from "./config";
import { generateFromTemplate as genFromTemplate } from "./template-engine";
import { getToolCatalog } from "./tool-catalog";
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
    required: [],
    additionalProperties: false,
  };

  const file = (tool as any)({
    description: "File operations within the workspace (read/info/list; write/move/delete gated)",
    inputSchema: jsonSchema(fileParamsSchema),
    execute: async (params: any) => {
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

      // Introspection: if action is missing and no meaningful fields are provided, describe the tool
      const hasKeys = params && typeof params === 'object' && Object.keys(params).length > 0;
      const hasTaskFields = !!(params && typeof params === 'object' && (
        'path' in params || 'directory' in params || 'content' in params || 'from' in params || 'to' in params || 'lines' in params || 'recursive' in params || 'maxResults' in params || 'apply' in params
      ));
      const actionRaw = params?.action;
      if (!hasKeys || (!actionRaw && !hasTaskFields)) {
        return record({
          type: 'about',
          name: 'file',
          actions: [
            { name: 'read', required: ['path'], optional: ['lines'] },
            { name: 'info', required: ['path'], optional: [] },
            { name: 'list', required: ['directory'], optional: ['recursive', 'maxResults'] },
            { name: 'write', required: ['path', 'content'], optional: [], gatedBy: 'ENABLE_FILE_WRITE/APPROVAL_MODE' },
            { name: 'move', required: ['from', 'to'], optional: [], gatedBy: 'ENABLE_FILE_WRITE/APPROVAL_MODE' },
            { name: 'delete', required: ['path'], optional: [], gatedBy: 'ENABLE_FILE_WRITE/APPROVAL_MODE' },
          ]
        });
      }

      // Default to 'read' for backward compatibility when action is omitted
      const action = String(actionRaw || "read");
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

      // Destructive ops -> deny unless enabled; if approval mode is 'always', require approval
      if (action === "write" || action === "move" || action === "delete") {
        const enabled = cfg?.ENABLE_FILE_WRITE === true;
        if (!enabled) return record({ type: "error" as const, code: "WRITE_DISABLED", message: "File writes are disabled" });
        if (cfg?.APPROVAL_MODE === 'always') return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Operation requires approval" });
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
      required: [],
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

      // Introspection: describe tool when action missing and no meaningful fields
      const hasKeys = params && typeof params === 'object' && Object.keys(params).length > 0;
      const hasTaskFields = !!(params && typeof params === 'object' && ('query' in params || 'pattern' in params));
      if (!hasKeys || (!params?.action && !hasTaskFields)) {
        return record({
          type: 'about',
          name: 'search',
          actions: [
            { name: 'code', required: ['query'], optional: ['directory', 'maxResults'] },
            { name: 'files', required: ['pattern'], optional: ['directory', 'recursive', 'maxResults'] },
          ]
        });
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
    description: "Edit operations: diff (unified), block (targeted), multi (batch)",
    // IMPORTANT: OpenAI function/tool schemas must be a top-level JSON Schema of type: "object".
    // Older models tolerated top-level oneOf; GPT-5 requires explicit { type: "object" }.
    // We accept a superset of fields and validate combinations at runtime.
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        // Variant selector: default is "diff" when omitted (back-compat)
        action: { type: "string", enum: ["diff", "block", "multi"], description: "Edit variant; defaults to 'diff' if omitted" },

        // diff
        path: { type: "string" },
        diff: { type: "string" },
        apply: { type: "boolean", default: false },

        // block
        search: { type: "string" },
        replacement: { type: "string" },
        occurrence: { type: "integer", minimum: 1 },
        isRegex: { type: "boolean" },
        preview: { type: "boolean" },

        // multi
        paths: { type: "array", items: { type: "string" } },
        occurrencePolicy: { type: "string", enum: ["first", "all", "index"] },
        index: { type: "integer", minimum: 1 },
        maxFiles: { type: "integer", minimum: 1, maximum: 10000 },
      },
      required: [],
      additionalProperties: false,
    } as any),
    execute: async (rawParams: any) => {
      const onExec = deps?.onToolExecute;
      const t0 = Date.now();

      const record = async (args: unknown, result: unknown) => {
        try { await onExec?.("edit", args, result, { startedAt: t0, durationMs: Date.now() - t0 }); } catch { /* noop */ }
        return result;
      };

      // Introspection: if no action and no meaningful fields, describe tool
      const hasAnyField = rawParams && typeof rawParams === 'object' && (
        'path' in rawParams || 'diff' in rawParams || 'apply' in rawParams || 'search' in rawParams || 'replacement' in rawParams || 'paths' in rawParams
      );
      if (!rawParams || typeof rawParams !== 'object' || (!('action' in rawParams) && !hasAnyField)) {
        return record(rawParams, {
          type: 'about',
          name: 'edit',
          actions: [
            { name: 'diff', required: ['path', 'diff'], optional: ['apply'] },
            { name: 'block', required: ['path', 'search'], optional: ['replacement', 'occurrence', 'isRegex', 'preview', 'apply'] },
            { name: 'multi', required: ['paths', 'search'], optional: ['replacement', 'occurrencePolicy', 'index', 'maxFiles', 'apply'] },
          ]
        });
      }

      // Default branch: unified diff (back-compat when no action provided)
      if (!rawParams || typeof rawParams !== 'object' || !('action' in rawParams)) {
        const { path, diff, apply } = { path: String(rawParams?.path || ''), diff: String(rawParams?.diff || ''), apply: Boolean(rawParams?.apply) } as { path: string; diff: string; apply: boolean };
        const val = validateAndResolvePath(path);
        if (!val.ok) throw new Error(val.message);

        if (!apply) {
          const r = await readTextFile(val.absolutePath);
          if (!r.ok) throw new Error(r.message);
          if (r.isLikelyBinary) throw new Error("File contains binary data");
          const original = r.content;
          const { result: modified, applied, error: applyError } = applyUnifiedDiffSafe(original, diff);
          const [{ count: originalTokens }, { count: modifiedTokens }] = await Promise.all([
            tokenService.countTokens(original),
            tokenService.countTokens(modified)
          ]);
          const clip = (s: string, max = 20_000) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);
          return record({ path, diff, apply }, {
            type: "preview" as const,
            path: val.absolutePath,
            applied,
            error: applyError || undefined,
            diff,
            original: clip(original),
            modified: clip(modified),
            tokenCounts: { original: originalTokens, modified: modifiedTokens },
          });
        }
        const cfg = deps?.config || null;
        if (!cfg?.ENABLE_FILE_WRITE) {
          return record({ path, diff, apply }, { type: "error" as const, code: 'WRITE_DISABLED', message: "File writes disabled" });
        }
        if (cfg?.APPROVAL_MODE === 'always') {
          return record({ path, diff, apply }, { type: "error" as const, code: 'APPROVAL_NEEDED', message: "Apply requires approval" });
        }
        const r0 = await readTextFile(val.absolutePath);
        if (!r0.ok) throw new Error(r0.message);
        if (r0.isLikelyBinary) throw new Error("File contains binary data");
        const appliedRes = applyUnifiedDiffSafe(r0.content, diff);
        if (!appliedRes.applied) {
          return record({ path, diff, apply }, { type: "error" as const, code: 'APPLY_FAILED', message: appliedRes.error || "Failed to apply diff" });
        }
        const w = await writeTextFile(val.absolutePath, appliedRes.result);
        if (!w.ok) throw new Error(w.message);
        return record({ path, diff, apply }, { type: "applied" as const, path: val.absolutePath, bytes: w.bytes });
      }

      // Actioned branches: block | multi
      const action = String(rawParams.action);
      if (action === 'block') {
        const path = String(rawParams.path || '');
        const search = String(rawParams.search || '');
        const replacement = typeof rawParams.replacement === 'string' ? rawParams.replacement : '';
        const occurrence = Number.isFinite(rawParams.occurrence) ? Math.max(1, Math.floor(rawParams.occurrence)) : 1;
        const isRegex = rawParams.isRegex === true;
        const preview = rawParams.preview !== false; // default true
        const apply = rawParams.apply === true;

        const val = validateAndResolvePath(path);
        if (!val.ok) throw new Error(val.message);
        const r = await readTextFile(val.absolutePath);
        if (!r.ok) throw new Error(r.message);
        if (r.isLikelyBinary) return record(rawParams, { type: 'error' as const, code: 'BINARY_FILE', message: 'File contains binary data' });

        const original = r.content;
        const occs = findAllOccurrences(original, search, { isRegex });
        const idx = Math.min(Math.max(1, occurrence), Math.max(1, occs.length)) - 1; // clamp 1-based to available
        const target = occs[idx];
        if (!target) return record(rawParams, { type: 'preview' as const, path: val.absolutePath, occurrencesCount: 0, replacedOccurrenceIndex: -1, characterDiffs: [], contextLines: { before: [], after: [] }, modified: original, tokenCounts: { original: (await tokenService.countTokens(original)).count, modified: (await tokenService.countTokens(original)).count } });

        // Build modified content
        const before = original.slice(0, target.start);
        const after = original.slice(target.end);
        const modified = before + replacement + after;

        // Small character-level diff preview (prefix/suffix based)
        const characterDiffs = charDiff(original, modified);
        const ctx = contextLines(original, { start: target.start, end: target.end }, 3);
        const clip = (s: string, max = 40_000) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);
        const [origTok, modTok] = await Promise.all([
          tokenService.countTokens(original).then((r) => r.count),
          tokenService.countTokens(modified).then((r) => r.count),
        ]);

        const previewObj = {
          type: 'preview' as const,
          path: val.absolutePath,
          occurrencesCount: occs.length,
          replacedOccurrenceIndex: idx + 1, // 1-based in response for clarity
          characterDiffs,
          contextLines: ctx,
          modified: clip(modified),
          tokenCounts: { original: origTok, modified: modTok },
        };

        if (preview || !apply) return record(rawParams, previewObj);

        const cfg = deps?.config || null;
        if (!cfg?.ENABLE_FILE_WRITE) return record(rawParams, { type: 'error' as const, code: 'WRITE_DISABLED', message: 'File writes are disabled' });
        if (cfg?.APPROVAL_MODE === 'always') return record(rawParams, { type: 'error' as const, code: 'APPROVAL_NEEDED', message: 'Apply requires approval' });

        const w = await writeTextFile(val.absolutePath, modified);
        if (!w.ok) throw new Error(w.message);
        return record(rawParams, { type: 'applied' as const, path: val.absolutePath, bytes: w.bytes });
      }

      if (action === 'multi') {
        const paths = Array.isArray(rawParams.paths) ? rawParams.paths.map(String) : [];
        const search = String(rawParams.search || '');
        const replacement = typeof rawParams.replacement === 'string' ? rawParams.replacement : '';
        const isRegex = rawParams.isRegex === true;
        const policy = ((): 'first' | 'all' | 'index' => (rawParams.occurrencePolicy === 'all' || rawParams.occurrencePolicy === 'index') ? rawParams.occurrencePolicy : 'first')();
        const index = Number.isFinite(rawParams.index) ? Math.max(1, Math.floor(rawParams.index)) : 1;
        const preview = rawParams.preview !== false; // default true
        const maxFiles = Number.isFinite(rawParams.maxFiles) ? Math.min(200, Math.max(1, Math.floor(rawParams.maxFiles))) : 200;

        const cfg = deps?.config || null;
        const canApply = cfg?.ENABLE_FILE_WRITE && cfg?.APPROVAL_MODE !== 'always' && rawParams.apply === true;

        const out: Array<any> = [];
        let totalReplacements = 0;
        let truncated = false;
        for (let i = 0; i < paths.length; i++) {
          if (out.length >= maxFiles) { truncated = true; break; }
          const pth = paths[i];
          const val = validateAndResolvePath(pth);
          if (!val.ok) { out.push({ path: pth, error: { code: 'PATH_DENIED', message: val.message } }); continue; }
          const r = await readTextFile(val.absolutePath);
          if (!r.ok) { out.push({ path: val.absolutePath, error: { code: r.code || 'FILE_ERROR', message: r.message } }); continue; }
          if (r.isLikelyBinary) { out.push({ path: val.absolutePath, error: { code: 'BINARY_FILE', message: 'File contains binary data' } }); continue; }

          const original = r.content;
          const occs = findAllOccurrences(original, search, { isRegex });
          if (occs.length === 0) {
            out.push({ path: val.absolutePath, occurrencesCount: 0, replacedOccurrenceIndex: -1, modified: original, characterDiffs: [], contextLines: { before: [], after: [] }, tokenCounts: { original: (await tokenService.countTokens(original)).count, modified: (await tokenService.countTokens(original)).count } });
            continue;
          }

          let modified = original;
          let replacedIndex = -1;
          if (policy === 'first') {
            const t = occs[0];
            replacedIndex = 1;
            modified = original.slice(0, t.start) + replacement + original.slice(t.end);
            totalReplacements += 1;
          } else if (policy === 'index') {
            const clamped = Math.min(Math.max(1, index), occs.length) - 1;
            const t = occs[clamped];
            replacedIndex = clamped + 1;
            modified = original.slice(0, t.start) + replacement + original.slice(t.end);
            totalReplacements += 1;
          } else {
            // all
            // Apply from end to start to preserve indices
            const ordered = [...occs].sort((a, b) => b.start - a.start);
            for (const t of ordered) {
              modified = modified.slice(0, t.start) + replacement + modified.slice(t.end);
            }
            totalReplacements += occs.length;
            replacedIndex = occs.length > 0 ? 1 : -1;
          }

          const [origTok, modTok] = await Promise.all([
            tokenService.countTokens(original).then((r) => r.count),
            tokenService.countTokens(modified).then((r) => r.count),
          ]);
          const clip = (s: string, max = 40_000) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);
          const diffs = charDiff(original, modified);
          const ctx = occs[0] ? contextLines(original, occs[0], 3) : { before: [], after: [] };
          out.push({ path: val.absolutePath, occurrencesCount: occs.length, replacedOccurrenceIndex: replacedIndex, characterDiffs: diffs, contextLines: ctx, modified: clip(modified), tokenCounts: { original: origTok, modified: modTok } });

          if (canApply) {
            const w = await writeTextFile(val.absolutePath, modified);
            if (!w.ok) { out[out.length - 1].error = { code: 'WRITE_FAILED', message: w.message }; }
          }
        }

        const result = { files: out, totalReplacements, truncated, partial: out.length < paths.length };
        return record(rawParams, result);
      }

      return record(rawParams, { type: 'error' as const, code: 'INVALID_ACTION', message: `Unknown edit.action: ${String(action)}` });
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

      // tools: return tool catalog (structured)
      if (action === "tools") {
        const catalog = getToolCatalog();
        return record({ tools: catalog as any } as unknown as ContextResult);
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
    description: "Terminal operations: start | interact | output | list | kill",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "interact", "output", "list", "kill"] },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        waitForReady: { type: "boolean" },
        readyPattern: { type: "string" },
        sessionId: { type: "string" },
        input: { type: "string" },
        cursor: { type: "integer" },
        maxBytes: { type: "integer" },
        skipPermissions: { type: "boolean" },
      },
      required: [],
      additionalProperties: false,
    } as any),
    execute: async (params: any) => {
      const cfg = deps?.config || null;
      const t0 = Date.now();
      const record = async (result: unknown) => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try { await deps?.onToolExecute?.("terminal", params, result, meta as any); } catch { /* noop */ }
        return result;
      };

      // Introspection: describe tool when action missing and no meaningful fields
      const hasKeys = params && typeof params === 'object' && Object.keys(params).length > 0;
      const hasTaskFields = !!(params && typeof params === 'object' && ('command' in params || 'sessionId' in params));
      if (!hasKeys || (!params?.action && !hasTaskFields)) {
        return record({
          type: 'about',
          name: 'terminal',
          actions: [
            { name: 'start', required: ['command'], optional: ['args', 'cwd'] },
            { name: 'interact', required: ['sessionId', 'input'], optional: [] },
            { name: 'output', required: ['sessionId'], optional: ['cursor', 'maxBytes'] },
            { name: 'list', required: [], optional: [] },
            { name: 'kill', required: ['sessionId'], optional: [] },
          ],
          gatedBy: 'ENABLE_CODE_EXECUTION/APPROVAL_MODE'
        });
      }
      if (cfg?.ENABLE_CODE_EXECUTION !== true) {
        return record({ type: 'error' as const, code: 'EXECUTION_DISABLED', message: 'Code execution is disabled' });
      }
      if (deps?.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: 'RATE_LIMITED', message: 'Tool execution rate limited' });
      }

      const action = String(params?.action || '');
      const isRisky = (txt: string): boolean => {
        const s = (txt || '').trim().toLowerCase();
        return /rm\s+-rf\s+\/.*/.test(s) || s.includes(":(){ :|:& };:") || /mkfs|fdisk|diskpart|format\s+c:/.test(s);
      };
      // Lazy-require TerminalManager to avoid hard dependency during packaging/tests
      const { TerminalManager } = await import('../terminal/terminal-manager');
      const TM_KEY = '__pf_terminal_manager_singleton__';
      const g = globalThis as unknown as Record<string, unknown>;
      let tm = (g[TM_KEY] as InstanceType<typeof TerminalManager> | undefined) || null;
      if (!tm) { tm = new TerminalManager(); g[TM_KEY] = tm as unknown as unknown; }

      if (action === 'start') {
        const cwd = typeof params?.cwd === 'string' && params.cwd.trim().length > 0 ? params.cwd : '.';
        const v = validateAndResolvePath(cwd);
        if (!v.ok) return record({ type: 'error' as const, code: 'PATH_DENIED', message: v.message });
        const cmdStr = params?.command ? String(params.command) : '';
        if ((cfg?.APPROVAL_MODE === 'always') && params?.skipPermissions !== true) {
          return record({ type: 'error' as const, code: 'APPROVAL_NEEDED', message: 'Command requires approval' });
        }
        if (cfg?.APPROVAL_MODE === 'risky' && cmdStr && isRisky(cmdStr) && params?.skipPermissions !== true) {
          return record({ type: 'error' as const, code: 'APPROVAL_NEEDED', message: 'Risky command requires approval' });
        }
        const { id, pid } = tm.create({ command: params?.command, args: Array.isArray(params?.args) ? params.args : undefined, cwd: v.absolutePath });
        return record({ sessionId: id, pid });
      }
      if (action === 'interact') {
        const id = String(params?.sessionId || '');
        const input = String(params?.input || '');
        if ((cfg?.APPROVAL_MODE === 'always') && params?.skipPermissions !== true) {
          return record({ type: 'error' as const, code: 'APPROVAL_NEEDED', message: 'Command requires approval' });
        }
        if (cfg?.APPROVAL_MODE === 'risky' && isRisky(input) && params?.skipPermissions !== true) {
          return record({ type: 'error' as const, code: 'APPROVAL_NEEDED', message: 'Risky input requires approval' });
        }
        try { tm.write(id, input); } catch (err) { return record({ type: 'error' as const, code: 'NOT_FOUND', message: (err as Error)?.message || 'NOT_FOUND' }); }
        return record({ ok: true });
      }
      if (action === 'output') {
        const id = String(params?.sessionId || '');
        const cursor = Number.isFinite(params?.cursor) ? Math.floor(params.cursor) : undefined;
        const maxBytes = Number.isFinite(params?.maxBytes) ? Math.floor(params.maxBytes) : undefined;
        try {
          const out = tm.getOutput(id, { fromCursor: cursor, maxBytes });
          return record(out);
        } catch (err) { return record({ type: 'error' as const, code: 'NOT_FOUND', message: (err as Error)?.message || 'NOT_FOUND' }); }
      }
      if (action === 'list') {
        return record({ sessions: tm.list() });
      }
      if (action === 'kill') {
        const id = String(params?.sessionId || '');
        try { tm.kill(id); return record({ ok: true }); } catch { return record({ type: 'error' as const, code: 'NOT_FOUND', message: 'NOT_FOUND' }); }
      }
      return record({ type: 'error' as const, code: 'INVALID_ACTION', message: `Unknown terminal.action: ${action}` });
    },
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
 * Helpers for edit.block/multi
 */
function findAllOccurrences(content: string, pattern: string, opts: { isRegex: boolean }): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  if (!pattern) return out;
  if (opts.isRegex) {
    try {
      const re = new RegExp(pattern, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) != null) {
        const s = m.index;
        const e = s + (m[0]?.length ?? 0);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { re.lastIndex = re.lastIndex + 1; continue; }
        out.push({ start: s, end: e });
        if (m[0]?.length === 0) re.lastIndex += 1; // avoid zero-length loops
        if (out.length >= 10000) break; // cap
      }
      return out;
    } catch {
      // Fall through to literal if regex invalid
    }
  }
  let from = 0;
  while (from <= content.length) {
    const idx = content.indexOf(pattern, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + pattern.length });
    from = idx + Math.max(1, pattern.length);
    if (out.length >= 10000) break;
  }
  return out;
}

function charDiff(a: string, b: string): Array<{ op: 'keep'|'add'|'del'; text: string }> {
  try {
    if (a === b) return [{ op: 'keep', text: a.slice(0, Math.min(1000, a.length)) }];
    // Common prefix
    let i = 0;
    const maxScan = Math.min(a.length, b.length);
    while (i < maxScan && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    // Common suffix
    let j = 0;
    const aRem = a.length - i;
    const bRem = b.length - i;
    while (j < aRem && j < bRem && a.charCodeAt(a.length - 1 - j) === b.charCodeAt(b.length - 1 - j)) j++;
    const keepPrefix = a.slice(0, i);
    const delMid = a.slice(i, a.length - j);
    const addMid = b.slice(i, b.length - j);
    const keepSuffix = a.slice(a.length - j);
    const out: Array<{ op: 'keep'|'add'|'del'; text: string }> = [];
    if (keepPrefix) out.push({ op: 'keep', text: keepPrefix.slice(0, 1000) });
    if (delMid) out.push({ op: 'del', text: delMid.slice(0, 2000) });
    if (addMid) out.push({ op: 'add', text: addMid.slice(0, 2000) });
    if (keepSuffix) out.push({ op: 'keep', text: keepSuffix.slice(-1000) });
    return out;
  } catch {
    return [{ op: 'keep', text: a.slice(0, 1000) }];
  }
}

function contextLines(content: string, occ: { start: number; end: number }, n: number): { before: string[]; after: string[] } {
  try {
    const lines = content.split(/\r?\n/);
    // Map char index to line number
    let acc = 0;
    let lineAtStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const next = acc + lines[i].length + 1; // +1 for newline
      if (occ.start < next) { lineAtStart = i; break; }
      acc = next;
    }
    const startIdx = Math.max(0, lineAtStart - n);
    const endIdx = Math.min(lines.length, lineAtStart + n + 1);
    const before = lines.slice(startIdx, lineAtStart);
    const after = lines.slice(lineAtStart + 1, endIdx);
    return { before, after };
  } catch {
    return { before: [], after: [] };
  }
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
