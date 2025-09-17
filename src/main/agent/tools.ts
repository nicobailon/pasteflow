import { getMainTokenService } from "../../services/token-service-main";

import type { AgentSecurityManager } from "./security-manager";
import type { AgentConfig } from "./config";
import { createFileTool } from "./tools/file-tool";
import { createSearchTool } from "./tools/search-tool";
import { createEditTool } from "./tools/edit/edit-tool";
import { createContextTool } from "./tools/context-tool";
import { createTerminalTool } from "./tools/terminal-tool";
import type { BaseToolFactoryDeps } from "./tools/shared/tool-factory-types";

export function getAgentTools(deps?: {
  signal?: AbortSignal;
  security?: AgentSecurityManager | null;
  config?: AgentConfig | null;
  onToolExecute?: (name: string, args: unknown, result: unknown, meta?: Record<string, unknown>) => void | Promise<void>;
  sessionId?: string | null;
}) {
  const tokenService = getMainTokenService();

  const baseDeps: BaseToolFactoryDeps = {
    tokenService,
    config: deps?.config ?? null,
    security: deps?.security ?? null,
    sessionId: deps?.sessionId ?? null,
    signal: deps?.signal,
    onToolExecute: deps?.onToolExecute,
  };

  const file = createFileTool(baseDeps);
  const search = createSearchTool(baseDeps);
  const edit = createEditTool(baseDeps);
  const context = createContextTool(baseDeps);
  const terminal = createTerminalTool(baseDeps);
  return { file, search, edit, context, terminal } as const;
}
