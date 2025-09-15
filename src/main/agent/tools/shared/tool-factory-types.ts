import type { TokenService } from "../../../services/token-service";
import type { AgentConfig } from "../config";
import type { AgentSecurityManager } from "../security-manager";

export type ToolExecuteHook = (
  name: string,
  args: unknown,
  result: unknown,
  meta?: Record<string, unknown>
) => void | Promise<void>;

export type BaseToolFactoryDeps = {
  tokenService: TokenService;
  config: AgentConfig | null;
  security: AgentSecurityManager | null;
  sessionId?: string | null;
  signal?: AbortSignal;
  onToolExecute?: ToolExecuteHook;
};

export type ToolRecorder<TArgs, TResult> = (
  args: TArgs,
  result: TResult
) => Promise<TResult> | TResult;
