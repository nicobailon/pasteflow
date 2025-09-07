import { validateAndResolvePath } from "../file-service";
import { resolveAgentConfig, type AgentConfig } from "./config";

type AllowResult = { ok: true; path?: string } | { ok: false; reason: string };

/**
 * Centralized security manager for agent operations: file access validation and simple rate limiting.
 * - Validates paths against workspace allowlist via PathValidator
 * - Gates writes/destructive ops behind config flags
 * - Provides basic in-memory per-session counters for tool usage
 */
export class AgentSecurityManager {
  private cfg: AgentConfig;
  private toolUsageBySession = new Map<string, { windowStart: number; count: number }>();

  private constructor(cfg: AgentConfig) {
    this.cfg = cfg;
  }

  static async create(deps?: { db?: { getPreference: (k: string) => Promise<unknown> } }): Promise<AgentSecurityManager> {
    const cfg = await resolveAgentConfig(deps?.db);
    return new AgentSecurityManager(cfg);
  }

  getConfig(): AgentConfig {
    return this.cfg;
  }

  canReadFile(path: string): AllowResult {
    const val = validateAndResolvePath(path);
    if (!val.ok) return { ok: false, reason: val.reason || val.message } as const;
    return { ok: true, path: val.absolutePath } as const;
  }

  canWriteFile(path: string): AllowResult {
    if (!this.cfg.ENABLE_FILE_WRITE) return { ok: false, reason: "FILE_WRITE_DISABLED" } as const;
    const val = validateAndResolvePath(path);
    if (!val.ok) return { ok: false, reason: val.reason || val.message } as const;
    return { ok: true, path: val.absolutePath } as const;
  }

  /**
   * Simple per-session rate limiter for tool executions within a moving one-minute window.
   * Returns true if allowed, false otherwise.
   */
  allowToolExecution(sessionId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const cap = Math.max(1, Math.min(1000, this.cfg.MAX_TOOLS_PER_TURN));
    const entry = this.toolUsageBySession.get(sessionId);
    if (!entry || now - entry.windowStart > windowMs) {
      this.toolUsageBySession.set(sessionId, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= cap) return false;
    entry.count += 1;
    return true;
  }

  /**
   * Probe-only check for whether a session is currently rate limited.
   * Does not increment counters.
   */
  isRateLimited(sessionId: string): boolean {
    const now = Date.now();
    const entry = this.toolUsageBySession.get(sessionId);
    const windowMs = 60_000;
    const cap = Math.max(1, Math.min(1000, this.cfg.MAX_TOOLS_PER_TURN));
    if (!entry || now - entry.windowStart > windowMs) return false;
    return entry.count >= cap;
  }
}
