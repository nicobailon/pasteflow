import { tool, jsonSchema } from "ai";

import { validateAndResolvePath, readTextFile } from "../../file-service";
import { runRipgrepJson } from "../../tools/ripgrep";

import type {
  ContextAction,
  ContextExpandParams,
  ContextExpandResult,
  ContextResult,
  ContextSearchParams,
  ContextSearchResult,
  ContextSummaryParams,
  ContextToolParams,
  ExpandFileError,
  ExpandFileSuccess,
} from "./tool-types";
import { BINARY_FILE_MSG } from "./shared/constants";
import type { BaseToolFactoryDeps } from "./shared/tool-factory-types";

function contextSummary(envelope: unknown): { initialFiles: number; dynamicFiles: number } {
  const initFiles =
    envelope && (envelope as any).initial && Array.isArray((envelope as any).initial.files)
      ? (envelope as any).initial.files.length
      : 0;
  const dynFiles =
    envelope && (envelope as any).dynamic && Array.isArray((envelope as any).dynamic.files)
      ? (envelope as any).dynamic.files.length
      : 0;
  return { initialFiles: initFiles, dynamicFiles: dynFiles };
}

async function contextExpand(
  params: ContextExpandParams,
  deps: BaseToolFactoryDeps
): Promise<ContextExpandResult> {
  const filesParam = Array.isArray((params as any)?.files) ? params.files : null;
  if (!filesParam || filesParam.length === 0) {
    return {
      files: [{ path: "", error: { code: "VALIDATION_ERROR", message: "'files' array is required for action=expand" } }],
      truncated: true,
    };
  }
  const maxFiles = Math.min(deps.config?.MAX_RESULTS_PER_TOOL ?? 200, 20);
  const capFiles = filesParam.slice(0, maxFiles);
  const truncatedList = filesParam.length > capFiles.length;
  const perFileMaxBytes = Math.min(
    Math.max(Number((params as any)?.maxBytes || 0) || 50_000, 1),
    200_000
  );

  const out: (ExpandFileSuccess | ExpandFileError)[] = [];

  for (const f of capFiles) {
    const pth = typeof f?.path === "string" ? f.path : "";
    if (!pth) {
      out.push({ path: "", error: { code: "VALIDATION_ERROR", message: "Invalid file path" } });
      continue;
    }
    const v = validateAndResolvePath(pth);
    if (!v.ok) {
      out.push({ path: pth, error: { code: v.code || "PATH_DENIED", message: v.message } });
      continue;
    }

    const r = await readTextFile(v.absolutePath);
    if (!r.ok) {
      out.push({ path: v.absolutePath, error: { code: r.code || "FILE_ERROR", message: r.message } });
      continue;
    }
    if (r.isLikelyBinary) {
      out.push({ path: v.absolutePath, error: { code: "BINARY_FILE", message: BINARY_FILE_MSG } });
      continue;
    }

    let content = r.content;
    const lines = f?.lines;
    if (lines && Number.isFinite(lines.start) && Number.isFinite(lines.end)) {
      try {
        const arr = content.split(/\r?\n/);
        const start = Math.max(1, Math.floor(lines.start));
        const end = Math.max(start, Math.min(arr.length, Math.floor(lines.end)));
        content = arr.slice(start - 1, end).join("\n");
      } catch {
        // keep full content
      }
    }

    let truncated = false;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > perFileMaxBytes) {
      const encoder = new TextEncoder();
      const buf = encoder.encode(content);
      const sliced = buf.slice(0, perFileMaxBytes);
      const decoder = new TextDecoder("utf8", { fatal: false });
      content = decoder.decode(sliced);
      truncated = true;
    }

    const tokenRes = await deps.tokenService.countTokens(content);
    out.push({ path: v.absolutePath, content, bytes: Buffer.byteLength(content, "utf8"), tokenCount: tokenRes.count, truncated });
  }
  return { files: out, truncated: truncatedList };
}

async function contextSearch(
  params: ContextSearchParams,
  deps: BaseToolFactoryDeps
): Promise<ContextSearchResult | { type: "error"; code: string; message: string }> {
  if (typeof (params as any)?.query !== "string" || params.query.trim() === "") {
    return { type: "error" as const, code: "VALIDATION_ERROR", message: "'query' is required for action=search" };
  }
  const max = (() => {
    const requested = Number((params as any)?.maxResults || 0);
    const upper = deps.config?.MAX_SEARCH_MATCHES ?? 500;
    if (Number.isFinite(requested) && requested > 0) return Math.min(requested, upper);
    return upper;
  })();
  const rr = await runRipgrepJson({ query: params.query, directory: params?.directory, maxResults: max, signal: deps.signal });
  const compact: ContextSearchResult = {
    files: rr.files.map((f) => ({ path: f.path, matches: f.matches.map((m) => ({ line: m.line, text: m.text })) })),
    totalMatches: rr.totalMatches,
    truncated: rr.truncated,
  };
  return compact;
}

export function createContextTool(deps: BaseToolFactoryDeps) {
  const inputSchema = {
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
                start: { type: "integer" },
                end: { type: "integer" },
              },
              required: ["start", "end"],
            },
          },
          required: ["path"],
        },
      },
      maxBytes: { type: "integer", minimum: 1, maximum: 200_000 },
      query: { type: "string" },
      directory: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 50_000 },
    },
    required: [],
    additionalProperties: true,
  } as const;

  return (tool as any)({
    description: "Context utilities: summary | expand | search",
    inputSchema: jsonSchema(inputSchema),
    execute: async (params: ContextToolParams): Promise<ContextResult> => {
      const t0 = Date.now();
      const record = async (result: ContextResult): Promise<ContextResult> => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try {
          await deps.onToolExecute?.("context", params, result, meta as any);
        } catch {
          // noop
        }
        return result;
      };

      if (deps.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: "RATE_LIMITED", message: "Tool execution rate limited" });
      }

      const action: ContextAction = (params as any)?.action || "summary";
      if (action === "summary") return record(contextSummary((params as ContextSummaryParams)?.envelope as unknown));
      if (action === "expand") return record(await contextExpand(params as ContextExpandParams, deps));
      if (action === "search") return record((await contextSearch(params as ContextSearchParams, deps)) as ContextResult);
      return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown context.action: ${String((params as any)?.action)}` });
    },
  });
}
