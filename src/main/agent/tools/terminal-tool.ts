import { tool, jsonSchema } from "ai";

import { validateAndResolvePath } from "../../file-service";

import { isRiskyCommand } from "./shared/safety-utils";
import type { BaseToolFactoryDeps } from "./shared/tool-factory-types";

async function terminalStart(params: any, deps: BaseToolFactoryDeps, tm: any, record: (r: unknown) => Promise<unknown>) {
  const cwd = typeof params?.cwd === "string" && params.cwd.trim().length > 0 ? params.cwd : ".";
  const v = validateAndResolvePath(cwd);
  if (!v.ok) return record({ type: "error" as const, code: "PATH_DENIED", message: v.message });
  const cmdStr = params?.command ? String(params.command) : "";
  if (deps.config?.APPROVAL_MODE === "always" && params?.skipPermissions !== true) {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Command requires approval" });
  }
  if (deps.config?.APPROVAL_MODE === "risky" && cmdStr && isRiskyCommand(cmdStr) && params?.skipPermissions !== true) {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Risky command requires approval" });
  }
  const { id, pid } = tm.create({ command: params?.command, args: Array.isArray(params?.args) ? params.args : undefined, cwd: v.absolutePath });
  return record({ sessionId: id, pid });
}

async function terminalInteract(params: any, deps: BaseToolFactoryDeps, tm: any, record: (r: unknown) => Promise<unknown>) {
  const id = String(params?.sessionId || "");
  const input = String(params?.input || "");
  if (deps.config?.APPROVAL_MODE === "always" && params?.skipPermissions !== true) {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Command requires approval" });
  }
  if (deps.config?.APPROVAL_MODE === "risky" && isRiskyCommand(input) && params?.skipPermissions !== true) {
    return record({ type: "error" as const, code: "APPROVAL_NEEDED", message: "Risky input requires approval" });
  }
  try {
    tm.write(id, input);
  } catch (error) {
    return record({ type: "error" as const, code: "NOT_FOUND", message: (error as Error)?.message || "NOT_FOUND" });
  }
  return record({ ok: true });
}

async function terminalOutput(params: any, tm: any, record: (r: unknown) => Promise<unknown>) {
  const id = String(params?.sessionId || "");
  const cursor = Number.isFinite(params?.cursor) ? Math.floor(params.cursor) : undefined;
  const maxBytes = Number.isFinite(params?.maxBytes) ? Math.floor(params.maxBytes) : undefined;
  try {
    const out = tm.getOutput(id, { fromCursor: cursor, maxBytes });
    return record(out);
  } catch (error) {
    return record({ type: "error" as const, code: "NOT_FOUND", message: (error as Error)?.message || "NOT_FOUND" });
  }
}

function terminalList(tm: any, record: (r: unknown) => Promise<unknown>) {
  return record({ sessions: tm.list() });
}

function terminalKill(params: any, tm: any, record: (r: unknown) => Promise<unknown>) {
  const id = String(params?.sessionId || "");
  try {
    tm.kill(id);
    return record({ ok: true });
  } catch {
    return record({ type: "error" as const, code: "NOT_FOUND", message: "NOT_FOUND" });
  }
}

export function createTerminalTool(deps: BaseToolFactoryDeps) {
  const inputSchema = {
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
  } as const;

  return (tool as any)({
    description: "Terminal operations: start | interact | output | list | kill",
    inputSchema: jsonSchema(inputSchema),
    execute: async (params: any) => {
      const t0 = Date.now();
      const record = async (result: unknown) => {
        const meta = { startedAt: t0, durationMs: Date.now() - t0 } as const;
        try {
          await deps.onToolExecute?.("terminal", params, result, meta as any);
        } catch {
          // noop
        }
        return result;
      };

      const hasKeys = params && typeof params === "object" && Object.keys(params).length > 0;
      const hasTaskFields = !!(params && typeof params === "object" && ("command" in params || "sessionId" in params));
      if (!hasKeys || (!params?.action && !hasTaskFields)) {
        return record({
          type: "about" as const,
          name: "terminal",
          actions: [
            { name: "start", required: ["command"], optional: ["args", "cwd"] },
            { name: "interact", required: ["sessionId", "input"], optional: [] },
            { name: "output", required: ["sessionId"], optional: ["cursor", "maxBytes"] },
            { name: "list", required: [], optional: [] },
            { name: "kill", required: ["sessionId"], optional: [] },
          ],
          gatedBy: "ENABLE_CODE_EXECUTION/APPROVAL_MODE",
        });
      }
      if (deps.config?.ENABLE_CODE_EXECUTION !== true) {
        return record({ type: "error" as const, code: "EXECUTION_DISABLED", message: "Code execution is disabled" });
      }
      if (deps.security && deps.sessionId && !deps.security.allowToolExecution(deps.sessionId)) {
        return record({ type: "error" as const, code: "RATE_LIMITED", message: "Tool execution rate limited" });
      }

      const action = String(params?.action || "");
      const { TerminalManager } = await import("../../terminal/terminal-manager");
      const TM_KEY = "__pf_terminal_manager_singleton__";
      const g = globalThis as Record<string, unknown>;
      let tm = (g[TM_KEY] as InstanceType<typeof TerminalManager> | undefined) || null;
      if (!tm) {
        tm = new TerminalManager();
        g[TM_KEY] = tm as unknown as unknown;
      }

      switch (action) {
        case "start": {
          return terminalStart(params, deps, tm, record);
        }
        case "interact": {
          return terminalInteract(params, deps, tm, record);
        }
        case "output": {
          return terminalOutput(params, tm, record);
        }
        case "list": {
          return terminalList(tm, record);
        }
        case "kill": {
          return terminalKill(params, tm, record);
        }
        default: {
          return record({ type: "error" as const, code: "INVALID_ACTION", message: `Unknown terminal.action: ${action}` });
        }
      }
    },
  });
}
