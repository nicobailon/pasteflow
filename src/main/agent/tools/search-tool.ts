import { tool, jsonSchema } from "ai";

import { validateAndResolvePath } from "../../file-service";
import { runRipgrepJson } from "../../tools/ripgrep";

import type { BaseToolFactoryDeps } from "./shared/tool-factory-types";

function shouldDescribeSearchTool(params: unknown): boolean {
  if (!params || typeof params !== "object") return true;
  const obj = params as Record<string, unknown>;
  const hasKeys = Object.keys(obj).length > 0;
  const hasTaskFields = "query" in obj || "pattern" in obj;
  return !hasKeys || (!("action" in obj) && !hasTaskFields);
}

function describeSearchTool() {
  return {
    type: "about" as const,
    name: "search",
    actions: [
      { name: "code", required: ["query"], optional: ["directory", "maxResults"] },
      { name: "files", required: ["pattern"], optional: ["directory", "recursive", "maxResults"] },
    ],
  } as const;
}

async function handleSearchCode(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  if (typeof params.query !== "string" || params.query.trim() === "") {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'query' is required for action=code" });
  }
  const max = Math.min(
    Number(params?.maxResults || 0) || (deps.config?.MAX_SEARCH_MATCHES ?? 500),
    deps.config?.MAX_SEARCH_MATCHES ?? 500
  );
  const r = await runRipgrepJson({ query: params.query, directory: params.directory, maxResults: max, signal: deps.signal });
  return record({ ...r, clipped: Boolean((r as any).truncated) });
}

async function handleSearchFiles(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  if (typeof params.pattern !== "string" || params.pattern.trim() === "") {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'pattern' is required for action=files" });
  }
  const p = await import("node:path");
  const dirVal = validateAndResolvePath(String(params.directory || "."));
  if (!dirVal.ok) throw new Error(dirVal.message);
  const cap = Math.min(Number(params.maxResults || 0) || (deps.config?.MAX_RESULTS_PER_TOOL ?? 200), 10_000);
  const recursive = params.recursive === true;
  const needle = String(params.pattern).toLowerCase();
  const out: string[] = [];
  const queue: string[] = [dirVal.absolutePath];
  while (queue.length > 0 && out.length < cap) {
    const d = queue.shift()!;
    let dirents: import("node:fs").Dirent[] = [];
    try {
      const fsMod = await import("node:fs");
      const fsp = fsMod.promises;
      dirents = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of dirents) {
      const full = p.join(d, ent.name);
      if (out.length >= cap) break;
      if (ent.isDirectory()) {
        if (recursive) queue.push(full);
        continue;
      }
      if (ent.isFile() && ent.name.toLowerCase().includes(needle)) out.push(full);
    }
  }
  const truncated = out.length >= cap;
  return record({ directory: dirVal.absolutePath, matches: out, truncated });
}

export function createSearchTool(deps: BaseToolFactoryDeps) {
  const searchSchema = {
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
  } as const;

  return (tool as any)({
    description: "Search operations (code search via ripgrep; file glob)",
    inputSchema: jsonSchema(searchSchema),
    execute: async (params: any) => {
      const t0 = Date.now();
      const record = async (result: unknown) => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try {
          await deps.onToolExecute?.("search", params, result, meta as any);
        } catch {
          // noop
        }
        return result;
      };

      if (deps.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: "RATE_LIMITED", message: "Tool execution rate limited" });
      }

      if (shouldDescribeSearchTool(params)) return record(describeSearchTool());
      if (params.action === "code") return handleSearchCode(params, deps, record);
      if (params.action === "files") return handleSearchFiles(params, deps, record);
      return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown search.action: ${String(params?.action)}` });
    },
  });
}
