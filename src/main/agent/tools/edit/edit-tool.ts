import { tool, jsonSchema } from "ai";

import type { BaseToolFactoryDeps } from "../shared/tool-factory-types";

import { handleEditBlock, handleEditMulti, handleEditUnified } from "./edit-handlers";

function shouldDescribeEditTool(rawParams: unknown): boolean {
  if (!rawParams || typeof rawParams !== "object") return true;
  const obj = rawParams as Record<string, unknown>;
  const hasAnyField =
    "path" in obj ||
    "diff" in obj ||
    "apply" in obj ||
    "search" in obj ||
    "replacement" in obj ||
    "paths" in obj;
  return !("action" in obj) && !hasAnyField;
}

function describeEditTool() {
  return {
    type: "about" as const,
    name: "edit",
    actions: [
      { name: "diff", required: ["path", "diff"], optional: ["apply"] },
      {
        name: "block",
        required: ["path", "search"],
        optional: ["replacement", "occurrence", "isRegex", "preview", "apply"],
      },
      {
        name: "multi",
        required: ["paths", "search"],
        optional: ["replacement", "occurrencePolicy", "index", "maxFiles", "apply"],
      },
    ],
  } as const;
}

export function createEditTool(deps: BaseToolFactoryDeps) {
  const inputSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["diff", "block", "multi"], description: "Edit variant; defaults to 'diff' if omitted" },
      path: { type: "string" },
      diff: { type: "string" },
      apply: { type: "boolean", default: false },
      search: { type: "string" },
      replacement: { type: "string" },
      occurrence: { type: "integer", minimum: 1 },
      isRegex: { type: "boolean" },
      preview: { type: "boolean" },
      paths: { type: "array", items: { type: "string" } },
      occurrencePolicy: { type: "string", enum: ["first", "all", "index"] },
      index: { type: "integer", minimum: 1 },
      maxFiles: { type: "integer", minimum: 1, maximum: 10_000 },
    },
    required: [],
    additionalProperties: false,
  } as const;

  return (tool as any)({
    description: "Edit operations: diff (unified), block (targeted), multi (batch)",
    inputSchema: jsonSchema(inputSchema),
    execute: async (rawParams: any) => {
      const onExec = deps.onToolExecute;
      const t0 = Date.now();

      const record = async (args: unknown, result: unknown) => {
        try {
          await onExec?.("edit", args, result, { startedAt: t0, durationMs: Date.now() - t0 });
        } catch {
          // noop
        }
        return result;
      };

      if (shouldDescribeEditTool(rawParams)) return record(rawParams, describeEditTool());

      if (!rawParams || typeof rawParams !== "object" || !("action" in rawParams)) {
        return handleEditUnified(rawParams, deps, record);
      }

      const action = String((rawParams as { action: unknown }).action);
      if (action === "block") {
        return handleEditBlock(rawParams, deps, record);
      }

      if (action === "multi") {
        return handleEditMulti(rawParams, deps, record);
      }

      if (action === "diff" || action === "" || action === undefined) {
        return handleEditUnified(rawParams, deps, record);
      }

      return record(rawParams, { type: "error" as const, code: "INVALID_ACTION", message: `Unknown edit.action: ${String(action)}` });
    },
  });
}
