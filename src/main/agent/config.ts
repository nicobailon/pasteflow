
// Minimal, central Agent configuration with env + preferences precedence.
// When a DatabaseBridge is provided, preferences override env; otherwise env-only.

export type AgentConfig = {
  PROVIDER: "openai" | "anthropic" | "openrouter";
  DEFAULT_MODEL: string;
  MAX_CONTEXT_TOKENS: number;
  MAX_OUTPUT_TOKENS: number;
  MAX_TOOLS_PER_TURN: number;
  MAX_RESULTS_PER_TOOL: number;
  MAX_SEARCH_MATCHES: number;
  TEMPERATURE: number;
  ENABLE_FILE_WRITE: boolean;
  ENABLE_CODE_EXECUTION: boolean;
  APPROVAL_MODE: 'never' | 'risky' | 'always';
  RETRY_ATTEMPTS: number;
  RETRY_BASE_MS: number;
  RETRY_MAX_MS: number;
};

function pickProvider(input: string): "openai" | "anthropic" | "openrouter" {
  const v = input.trim().toLowerCase();
  return v === "openai" || v === "anthropic" || v === "openrouter" ? v : "openai";
}

const Defaults: AgentConfig = {
  PROVIDER: pickProvider(String(process.env.PF_AGENT_PROVIDER || "")),
  DEFAULT_MODEL: process.env.PF_AGENT_DEFAULT_MODEL || "gpt-4o-mini",
  MAX_CONTEXT_TOKENS: Number(process.env.PF_AGENT_MAX_CONTEXT_TOKENS ?? 120_000),
  MAX_OUTPUT_TOKENS: Number(process.env.PF_AGENT_MAX_OUTPUT_TOKENS ?? 4000),
  MAX_TOOLS_PER_TURN: Number(process.env.PF_AGENT_MAX_TOOLS_PER_TURN ?? 8),
  MAX_RESULTS_PER_TOOL: Number(process.env.PF_AGENT_MAX_RESULTS_PER_TOOL ?? 200),
  MAX_SEARCH_MATCHES: Number(process.env.PF_AGENT_MAX_SEARCH_MATCHES ?? 500),
  TEMPERATURE: Number(process.env.PF_AGENT_TEMPERATURE ?? 0.3),
  ENABLE_FILE_WRITE: String(process.env.PF_AGENT_ENABLE_FILE_WRITE || "true") !== "false",
  ENABLE_CODE_EXECUTION: String(process.env.PF_AGENT_ENABLE_CODE_EXECUTION || "true") !== "false",
  APPROVAL_MODE: ((): 'never'|'risky'|'always' => {
    const raw = String(process.env.PF_AGENT_APPROVAL_MODE || '').toLowerCase();
    return raw === 'never' || raw === 'always' || raw === 'risky' ? (raw as any) : 'risky';
  })(),
  RETRY_ATTEMPTS: Number(process.env.PF_AGENT_RETRY_ATTEMPTS ?? 3),
  RETRY_BASE_MS: Number(process.env.PF_AGENT_RETRY_BASE_MS ?? 800),
  RETRY_MAX_MS: Number(process.env.PF_AGENT_RETRY_MAX_MS ?? 8000),
};

// Preference keys used when a DatabaseBridge is provided.
const PrefKeys = {
  PROVIDER: "agent.provider",
  DEFAULT_MODEL: "agent.defaultModel",
  MAX_CONTEXT_TOKENS: "agent.maxContextTokens",
  MAX_OUTPUT_TOKENS: "agent.maxOutputTokens",
  MAX_TOOLS_PER_TURN: "agent.maxToolsPerTurn",
  MAX_RESULTS_PER_TOOL: "agent.maxResultsPerTool",
  MAX_SEARCH_MATCHES: "agent.maxSearchMatches",
  TEMPERATURE: "agent.temperature",
  ENABLE_FILE_WRITE: "agent.enableFileWrite",
  ENABLE_CODE_EXECUTION: "agent.enableCodeExecution",
  APPROVAL_MODE: "agent.approvalMode",
  RETRY_ATTEMPTS: "agent.retryAttempts",
  RETRY_BASE_MS: "agent.retryBaseMs",
  RETRY_MAX_MS: "agent.retryMaxMs",
} as const;

type DbGetter = { getPreference: (k: string) => Promise<unknown> } | null | undefined;

function coerceBoolean(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function coerceNumber(v: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  let out = n;
  if (typeof min === "number") out = Math.max(min, out);
  if (typeof max === "number") out = Math.min(max, out);
  return out;
}

/**
 * Resolve Agent configuration from preferences (if db provided) and environment variables.
 * Prefs take precedence over env, env over baked defaults.
 */
export async function resolveAgentConfig(db?: DbGetter): Promise<AgentConfig> {
  const base = { ...Defaults };
  if (!db) return base;

  const safeGet = async (k: string): Promise<unknown> => {
    try { return await db!.getPreference(k); } catch { return undefined; }
  };

  const [
    pProvider,
    pModel,
    pMaxCtx,
    pMaxOut,
    pMaxTools,
    pMaxResults,
    pMaxMatches,
    pTemp,
    pWrite,
    pExec,
    pApprovalMode,
    pRetryAttempts,
    pRetryBase,
    pRetryMax,
    pLegacyRequire,
  ] = await Promise.all([
    safeGet(PrefKeys.PROVIDER),
    safeGet(PrefKeys.DEFAULT_MODEL),
    safeGet(PrefKeys.MAX_CONTEXT_TOKENS),
    safeGet(PrefKeys.MAX_OUTPUT_TOKENS),
    safeGet(PrefKeys.MAX_TOOLS_PER_TURN),
    safeGet(PrefKeys.MAX_RESULTS_PER_TOOL),
    safeGet(PrefKeys.MAX_SEARCH_MATCHES),
    safeGet(PrefKeys.TEMPERATURE),
    safeGet(PrefKeys.ENABLE_FILE_WRITE),
    safeGet(PrefKeys.ENABLE_CODE_EXECUTION),
    safeGet(PrefKeys.APPROVAL_MODE),
    safeGet(PrefKeys.RETRY_ATTEMPTS),
    safeGet(PrefKeys.RETRY_BASE_MS),
    safeGet(PrefKeys.RETRY_MAX_MS),
    safeGet('agent.requireApproval'),
  ]);

  return {
    PROVIDER: ((): "openai" | "anthropic" | "openrouter" => {
      const v = typeof pProvider === "string" ? pProvider.trim().toLowerCase() : "";
      return v === "openai" || v === "anthropic" || v === "openrouter" ? v : base.PROVIDER;
    })(),
    DEFAULT_MODEL: typeof pModel === "string" && pModel.trim() ? pModel : base.DEFAULT_MODEL,
    MAX_CONTEXT_TOKENS: coerceNumber(pMaxCtx, base.MAX_CONTEXT_TOKENS, 1000, 2_000_000),
    MAX_OUTPUT_TOKENS: coerceNumber(pMaxOut, base.MAX_OUTPUT_TOKENS, 128_000, 128_000),
    MAX_TOOLS_PER_TURN: coerceNumber(pMaxTools, base.MAX_TOOLS_PER_TURN, 1, 100),
    MAX_RESULTS_PER_TOOL: coerceNumber(pMaxResults, base.MAX_RESULTS_PER_TOOL, 1, 10_000),
    MAX_SEARCH_MATCHES: coerceNumber(pMaxMatches, base.MAX_SEARCH_MATCHES, 1, 50_000),
    TEMPERATURE: coerceNumber(pTemp, base.TEMPERATURE, 0, 2),
    ENABLE_FILE_WRITE: coerceBoolean(pWrite, base.ENABLE_FILE_WRITE),
    ENABLE_CODE_EXECUTION: coerceBoolean(pExec, base.ENABLE_CODE_EXECUTION),
    APPROVAL_MODE: ((): 'never'|'risky'|'always' => {
      if (typeof pApprovalMode === 'string') {
        const v = pApprovalMode.toLowerCase().trim();
        if (v === 'never' || v === 'risky' || v === 'always') return v as any;
      }
      if (typeof pLegacyRequire === 'boolean') return pLegacyRequire ? 'always' : 'never';
      return base.APPROVAL_MODE;
    })(),
    // Treat null/undefined prefs as absent so env/defaults apply
    RETRY_ATTEMPTS: (pRetryAttempts == null)
      ? base.RETRY_ATTEMPTS
      : coerceNumber(pRetryAttempts, base.RETRY_ATTEMPTS, 1, 10),
    RETRY_BASE_MS: (pRetryBase == null)
      ? base.RETRY_BASE_MS
      : coerceNumber(pRetryBase, base.RETRY_BASE_MS, 0, 60_000),
    RETRY_MAX_MS: (pRetryMax == null)
      ? base.RETRY_MAX_MS
      : coerceNumber(pRetryMax, base.RETRY_MAX_MS, 0, 300_000),
  };
}

/** Lightweight sync accessor using env + defaults only (no DB). */
export function getEnvAgentConfig(): AgentConfig {
  return { ...Defaults };
}

// Renderer-facing feature hints (read-only). Kept narrow to avoid leaking config surface.
// Renderer feature flags removed; renderer reads direct config via API if needed.
