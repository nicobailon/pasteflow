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
export function getAgentTools() {
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

      const count = await tokenService.countTokens(content);
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
      return runRipgrepJson({ query, directory, maxResults });
    },
  });

  const edit = tool({
    description: "Preview or apply a unified diff to a file",
    parameters: z.object({ path: z.string(), diff: z.string(), apply: z.boolean().default(false) }),
    execute: async ({ path, diff, apply }) => {
      if (!apply) {
        const val = validateAndResolvePath(path);
        if (!val.ok) throw new Error(val.message);
        return { type: "preview", path: val.absolutePath, diff, modifiedPreview: "(omitted)" };
      }
      return { type: "error", message: "Apply requires approval (Phase 4)" } as const;
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

