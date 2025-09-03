import { tool } from "ai";
import { z } from "zod";

import { getMainTokenService } from "../../services/token-service-main";
import { validateAndResolvePath, readTextFile } from "../file-service";
import { runRipgrepJson } from "../tools/ripgrep";

/**
 * Returns the tools registry available to the agent in Phase 3.
 * - file: read file content (optionally by lines) and count tokens
 * - search: ripgrep JSON code search
 * - edit: preview-only diff (apply is gated for Phase 4)
 * - context: summarize the dual-context envelope sizes
 * - terminal: stubbed (Phase 4)
 */
export function getAgentTools(deps?: { signal?: AbortSignal }) {
  const tokenService = getMainTokenService();

  const file = tool({
    description: "Read file content within the current workspace",
    parameters: z.object({
      path: z.string(),
      lines: z
        .object({ start: z.number().int().min(1), end: z.number().int().min(1) })
        .refine((v) => v.end >= v.start, { message: "end must be >= start" })
        .optional(),
    }),
    execute: async ({ path, lines }) => {
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
      return { path: val.absolutePath, content, tokenCount: count };
    },
  });

  const search = tool({
    description: "Ripgrep code search with JSON results",
    parameters: z.object({
      query: z.string().min(1).max(256),
      directory: z.string().optional(),
      maxResults: z.number().int().min(1).max(5000).optional(),
    }),
    execute: async ({ query, directory, maxResults }) => {
      return runRipgrepJson({ query, directory, maxResults, signal: deps?.signal });
    },
  });

  const edit = tool({
    description: "Preview or apply a unified diff to a file",
    parameters: z.object({ path: z.string(), diff: z.string(), apply: z.boolean().default(false) }),
    execute: async ({ path, diff, apply }) => {
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

        return {
          type: "preview" as const,
          path: val.absolutePath,
          applied,
          error: applyError || undefined,
          diff,
          original: clip(original),
          modified: clip(modified),
          tokenCounts: { original: originalTokens, modified: modifiedTokens },
        };
      }
      return { type: "error" as const, message: "Apply requires approval (Phase 4)" };
    },
  });

  const context = tool({
    description: "Summarize provided dual-context (initial + dynamic) envelope",
    parameters: z.object({ envelope: z.any() }),
    execute: async ({ envelope }) => {
      const initFiles = envelope?.initial?.files?.length || 0;
      const dynFiles = envelope?.dynamic?.files?.length || 0;
      return { initialFiles: initFiles, dynamicFiles: dynFiles };
    },
  });

  const terminal = tool({
    description: "Terminal execution (stubbed in Phase 3)",
    parameters: z.object({ command: z.string(), cwd: z.string().optional() }),
    execute: async () => ({ notImplemented: true }),
  });

  return { file, search, edit, context, terminal } as const;
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
        const m = /^@@\s+-([0-9]+)(?:,([0-9]+))?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/.exec(l);
        if (!m) return { result: original, applied: false, error: "Invalid hunk header" };
        const oldStart = Number(m[1]);
        const oldCount = Number(m[2] || "1");
        const newStart = Number(m[3]);
        const newCount = Number(m[4] || "1");
        i++;
        const body: string[] = [];
        while (i < lines.length && !lines[i].startsWith("@@")) {
          const hl = lines[i];
          if (/^( |\+|\-|\\)/.test(hl)) body.push(hl);
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
        if (tag === ' ') { // context
          // Validate context matches original
          if ((origLines[cursor] ?? "") !== text) {
            return { result: original, applied: false, error: "Context mismatch while applying hunk" };
          }
          out.push(text);
          cursor++;
        } else if (tag === '-') { // removal from original
          // Optional validation: ensure original matches
          if ((origLines[cursor] ?? "") !== text) {
            return { result: original, applied: false, error: "Removal mismatch while applying hunk" };
          }
          cursor++;
        } else if (tag === '+') { // addition to output
          out.push(text);
        } else if (tag === '\\') {
          // "\\ No newline at end of file" — ignore
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
