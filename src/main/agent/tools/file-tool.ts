import { tool, jsonSchema } from "ai";

import { validateAndResolvePath, readTextFile, statFile as statFileFs, writeTextFile, deletePath, movePath } from "../../file-service";

import { BINARY_FILE_MSG } from "./shared/constants";
import type { BaseToolFactoryDeps } from "./shared/tool-factory-types";

function shouldDescribeFileTool(params: unknown): boolean {
  if (!params || typeof params !== "object") return true;
  const obj = params as Record<string, unknown>;
  const hasKeys = Object.keys(obj).length > 0;
  const hasTaskFields = "path" in obj || "directory" in obj || "content" in obj || "from" in obj || "to" in obj || "lines" in obj || "recursive" in obj || "maxResults" in obj || "apply" in obj;
  return !hasKeys || (!("action" in obj) && !hasTaskFields);
}

function describeFileTool() {
  return {
    type: "about" as const,
    name: "file",
    actions: [
      { name: "read", required: ["path"], optional: ["lines"] },
      { name: "info", required: ["path"], optional: [] },
      { name: "list", required: ["directory"], optional: ["recursive", "maxResults"] },
      { name: "write", required: ["path", "content"], optional: ["apply"], gatedBy: "ENABLE_FILE_WRITE/APPROVAL_MODE" },
      { name: "move", required: ["from", "to"], optional: ["apply"], gatedBy: "ENABLE_FILE_WRITE/APPROVAL_MODE" },
      { name: "delete", required: ["path"], optional: ["apply"], gatedBy: "ENABLE_FILE_WRITE/APPROVAL_MODE" },
    ],
  } as const;
}

async function handleFileRead(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  if (typeof params.path !== "string" || params.path.trim() === "") {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'path' is required for action=read" });
  }
  const path = params.path as string;
  const lines = (params.lines ?? null) as { start: number; end: number } | null;
  const val = validateAndResolvePath(path);
  if (!val.ok) throw new Error(val.message);

  const r = await readTextFile(val.absolutePath);
  if (!r.ok) throw new Error(r.message);
  if (r.isLikelyBinary) throw new Error(BINARY_FILE_MSG);

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

  const { count } = await deps.tokenService.countTokens(content);
  return record({ path: val.absolutePath, content, tokenCount: count });
}

async function handleFileInfo(params: any, record: (result: unknown) => Promise<unknown>) {
  if (typeof params.path !== "string" || params.path.trim() === "") {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'path' is required for action=info" });
  }
  const v = validateAndResolvePath(params.path);
  if (!v.ok) throw new Error(v.message);
  const s = await statFileFs(v.absolutePath);
  if (!s.ok) throw new Error(s.message);
  return record(s.data);
}

async function handleFileList(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  if (typeof params.directory !== "string" || params.directory.trim() === "") {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'directory' is required for action=list" });
  }
  const dirVal = validateAndResolvePath(params.directory);
  if (!dirVal.ok) throw new Error(dirVal.message);
  const fs = await import("node:fs");
  const p = await import("node:path");
  const recursive = params.recursive === true;
  const cap = Math.min(Number(params.maxResults || 0) || (deps.config?.MAX_RESULTS_PER_TOOL ?? 200), 10_000);
  const out: { path: string; name: string; isDirectory: boolean; size?: number; mtimeMs?: number }[] = [];
  const queue: string[] = [dirVal.absolutePath];
  while (queue.length > 0 && out.length < cap) {
    const d = queue.shift()!;
    let dirents: import("node:fs").Dirent[] = [];
    try {
      const fsp = fs.promises;
      dirents = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of dirents) {
      const full = p.join(d, ent.name);
      if (out.length >= cap) break;
      try {
        const fsp = fs.promises;
        const st = await fsp.stat(full);
        if (ent.isDirectory()) {
          out.push({ path: full, name: ent.name, isDirectory: true, mtimeMs: st.mtimeMs });
          if (recursive) queue.push(full);
        } else if (ent.isFile()) {
          out.push({ path: full, name: ent.name, isDirectory: false, size: st.size, mtimeMs: st.mtimeMs });
        }
      } catch {
        // skip
      }
    }
  }
  const truncated = out.length >= cap;
  return record({ directory: dirVal.absolutePath, items: out, truncated });
}

async function handleFileWrite(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  const pathParam = typeof params.path === "string" ? params.path.trim() : "";
  const content = typeof params.content === "string" ? params.content : null;
  const apply = params.apply === true;
  if (!pathParam) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'path' is required for action=write" });
  }
  if (content === null) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'content' must be a string for action=write" });
  }

  const val = validateAndResolvePath(pathParam);
  if (!val.ok) throw new Error(val.message);

  const stat = await statFileFs(val.absolutePath);
  if (stat.ok && stat.data.isDirectory) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "Cannot write to a directory" });
  }

  const { count } = await deps.tokenService.countTokens(content);
  const bytes = Buffer.byteLength(content, "utf8");

  if (!apply) {
    const exists = stat.ok;
    return record({
      type: "preview" as const,
      path: val.absolutePath,
      exists,
      bytes,
      tokenCount: count,
    });
  }

  if (!deps.config?.ENABLE_FILE_WRITE) {
    return record({ type: "error" as const, code: "WRITE_DISABLED", message: "File writes are disabled" });
  }
  if (deps.config?.APPROVAL_MODE === "always") {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Write requires approval" });
  }

  const res = await writeTextFile(val.absolutePath, content);
  if (!res.ok) throw new Error(res.message);
  return record({
    type: "applied" as const,
    path: val.absolutePath,
    bytes: res.bytes,
    tokenCount: count,
    existed: stat.ok,
  });
}

async function handleFileMove(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  const from = typeof params.from === "string" ? params.from.trim() : "";
  const to = typeof params.to === "string" ? params.to.trim() : "";
  const apply = params.apply === true;
  if (!from || !to) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'from' and 'to' are required for action=move" });
  }

  const fromVal = validateAndResolvePath(from);
  if (!fromVal.ok) throw new Error(fromVal.message);
  const toVal = validateAndResolvePath(to);
  if (!toVal.ok) throw new Error(toVal.message);

  const sourceStat = await statFileFs(fromVal.absolutePath);
  if (!sourceStat.ok) throw new Error(sourceStat.message);
  if (sourceStat.data.isDirectory) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "Moving directories is not supported" });
  }

  const destStat = await statFileFs(toVal.absolutePath);
  const destExists = destStat.ok;
  if (destExists && destStat.data.isDirectory) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "Destination is an existing directory" });
  }
  if (destExists && toVal.absolutePath !== fromVal.absolutePath) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "Destination already exists" });
  }

  if (!apply) {
    return record({
      type: "preview" as const,
      from: fromVal.absolutePath,
      to: toVal.absolutePath,
      bytes: sourceStat.data.size,
      destinationExists: destExists,
    });
  }

  if (!deps.config?.ENABLE_FILE_WRITE) {
    return record({ type: "error" as const, code: "WRITE_DISABLED", message: "File writes are disabled" });
  }
  if (deps.config?.APPROVAL_MODE === "always") {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Move requires approval" });
  }

  const moveRes = await movePath(fromVal.absolutePath, toVal.absolutePath);
  if (!moveRes.ok) throw new Error(moveRes.message);
  return record({
    type: "applied" as const,
    from: fromVal.absolutePath,
    to: toVal.absolutePath,
    bytes: moveRes.bytes ?? sourceStat.data.size,
  });
}

async function handleFileDelete(
  params: any,
  deps: BaseToolFactoryDeps,
  record: (result: unknown) => Promise<unknown>
) {
  const pathParam = typeof params.path === "string" ? params.path.trim() : "";
  const apply = params.apply === true;
  if (!pathParam) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "'path' is required for action=delete" });
  }

  const val = validateAndResolvePath(pathParam);
  if (!val.ok) throw new Error(val.message);
  const stat = await statFileFs(val.absolutePath);
  if (!stat.ok) {
    if (!apply) {
      return record({ type: "preview" as const, path: val.absolutePath, exists: false });
    }
    throw new Error(stat.message);
  }
  if (stat.data.isDirectory) {
    return record({ type: "error" as const, code: "VALIDATION_ERROR", message: "Deleting directories is not supported" });
  }

  if (!apply) {
    return record({
      type: "preview" as const,
      path: val.absolutePath,
      exists: true,
      bytes: stat.data.size,
    });
  }

  if (!deps.config?.ENABLE_FILE_WRITE) {
    return record({ type: "error" as const, code: "WRITE_DISABLED", message: "File writes are disabled" });
  }
  if (deps.config?.APPROVAL_MODE === "always") {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Delete requires approval" });
  }

  const del = await deletePath(val.absolutePath);
  if (!del.ok) throw new Error(del.message);
  return record({
    type: "applied" as const,
    path: val.absolutePath,
    bytes: del.bytes ?? stat.data.size,
  });
}

export function createFileTool(deps: BaseToolFactoryDeps) {
  const lineRangeSchema = {
    type: "object",
    properties: {
      start: { type: "integer", minimum: 1 },
      end: { type: "integer", minimum: 1 },
    },
    required: ["start", "end"],
    additionalProperties: false,
  } as const;

  const fileParamsSchema = {
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
  } as const;

  return (tool as any)({
    description: "File operations within the workspace (read/info/list; write/move/delete gated)",
    inputSchema: jsonSchema(fileParamsSchema),
    execute: async (params: any) => {
      const t0 = Date.now();
      const record = async (result: unknown) => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try {
          await deps.onToolExecute?.("file", params, result, meta as any);
        } catch {
          // noop
        }
        return result;
      };

      if (deps.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: "RATE_LIMITED", message: "Tool execution rate limited" });
      }

      if (shouldDescribeFileTool(params)) return record(describeFileTool());

      const action = String(params?.action || "read");
      if (action === "read") return handleFileRead(params, deps, record);
      if (action === "info") return handleFileInfo(params, record);
      if (action === "list") return handleFileList(params, deps, record);
      if (action === "write") return handleFileWrite(params, deps, record);
      if (action === "move") return handleFileMove(params, deps, record);
      if (action === "delete") return handleFileDelete(params, deps, record);

      return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown file.action: ${action}` });
    },
  });
}
