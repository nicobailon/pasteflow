import type { DatabaseBridge } from "../db/database-bridge";
import { isSecretBlob, decryptSecret } from "../secret-prefs";
import type { AgentConfig } from "./config";
import type { ProviderId } from "./models-catalog";
import { getStaticModels } from "./models-catalog";

import { createOpenAI, openai as openaiDirect } from "@ai-sdk/openai";
import { createAnthropic, anthropic as anthropicDirect } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

type DbGetter = { getPreference: (k: string) => Promise<unknown> };

export type ProviderCredentials = {
  openai?: { apiKey?: string | null };
  anthropic?: { apiKey?: string | null };
  openrouter?: { apiKey?: string | null; baseUrl?: string | null };
};

export async function loadProviderCredentials(db: DbGetter): Promise<ProviderCredentials> {
  const safeGet = async (k: string): Promise<unknown> => {
    try { return await db.getPreference(k); } catch { return undefined; }
  };

  const [okey, akey, orKey, orBase] = await Promise.all([
    safeGet("integrations.openai.apiKey"),
    safeGet("integrations.anthropic.apiKey"),
    safeGet("integrations.openrouter.apiKey"),
    safeGet("integrations.openrouter.baseUrl"),
  ]);

  const unwrap = (v: unknown): string | null => {
    if (isSecretBlob(v)) {
      try { return decryptSecret(v); } catch { return null; }
    }
    if (typeof v === "string" && v.trim()) return v.trim();
    return null;
  };

  return {
    openai: { apiKey: unwrap(okey) },
    anthropic: { apiKey: unwrap(akey) },
    openrouter: { apiKey: unwrap(orKey), baseUrl: typeof orBase === "string" && orBase.trim() ? orBase.trim() : "https://openrouter.ai/api/v1" },
  };
}

export type ResolveModelInput = {
  db: DbGetter;
  provider: ProviderId;
  modelId: string;
};

export async function resolveModelForRequest(input: ResolveModelInput): Promise<{ model: LanguageModel }>
{
  const { db, provider } = input;
  const modelId = canonicalizeModelId(provider, input.modelId);
  const creds = await loadProviderCredentials(db);

  if (provider === "openai") {
    const key = creds.openai?.apiKey || process.env.OPENAI_API_KEY || null;
    if (key && typeof createOpenAI === 'function') {
      const client = createOpenAI({ apiKey: key });
      return { model: client(modelId) } as any;
    }
    // Fall back to env-only direct helper or when createOpenAI is unavailable in test/mocks
    return { model: openaiDirect(modelId) } as any;
  }

  if (provider === "anthropic") {
    const key = creds.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || null;
    if (key && typeof createAnthropic === 'function') {
      const client = createAnthropic({ apiKey: key });
      return { model: client(modelId) } as any;
    }
    // Fall back to env only or when createAnthropic is unavailable
    return { model: anthropicDirect(modelId) } as any;
  }

  if (provider === "openrouter") {
    const key = creds.openrouter?.apiKey || null;
    const baseURL = creds.openrouter?.baseUrl || "https://openrouter.ai/api/v1";
    if (typeof createOpenAI !== 'function') {
      // Fallback to direct helper when createOpenAI is not available in mocks/tests
      return { model: openaiDirect(modelId) } as any;
    }
    if (!key) {
      // Return an OpenAI client without key to force validation errors on use
      const client = createOpenAI({ apiKey: "" as unknown as string, baseURL });
      // Explicitly use .chat() to force Chat Completions API
      return { model: client.chat(modelId) } as any;
    }
    const client = createOpenAI({ apiKey: key, baseURL });
    // Explicitly use .chat() to force Chat Completions API
    return { model: client.chat(modelId) } as any;
  }

  // Unknown provider: attempt OpenAI as default
  const client = createOpenAI({ apiKey: (await loadProviderCredentials(db)).openai?.apiKey || undefined });
  // Explicitly use .chat() to force Chat Completions API
  return { model: client.chat(modelId) };
}

export function pickSafeDefaultModel(provider: ProviderId, cfg: AgentConfig): string {
  // Prefer stored default; otherwise pick a safe catalog model
  if (cfg.DEFAULT_MODEL && typeof cfg.DEFAULT_MODEL === "string") return cfg.DEFAULT_MODEL;
  const cat = getStaticModels(provider);
  return cat[0]?.id || "gpt-4o-mini";
}

/**
 * Canonicalize a user-provided model value to a known provider model id when possible.
 * Matches against both id and label in the static catalog, case- and punctuation-insensitive.
 */
function canonicalizeModelId(provider: ProviderId, id: string): string {
  try {
    const raw = String(id || "").trim();
    if (!raw) return provider === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini";

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(raw);
    const cat = getStaticModels(provider);

    // 1) Exact id match first
    const exact = cat.find(m => m.id === raw);
    if (exact) return exact.id;

    // 2) Case-insensitive id match
    const caseInsensitive = cat.find(m => m.id.toLowerCase() === raw.toLowerCase());
    if (caseInsensitive) return caseInsensitive.id;

    // 3) Normalized id or label match (remove dashes/spaces/slashes)
    for (const m of cat) {
      if (norm(m.id) === target || norm(m.label || m.id) === target) return m.id;
    }

    // 4) OpenRouter special-case: allow bare OpenAI ids
    if (provider === "openrouter") {
      const prefixed = `openai/${raw}`;
      const pr = cat.find(m => m.id.toLowerCase() === prefixed.toLowerCase());
      if (pr) return pr.id;
    }

    return raw; // pass through; provider will validate
  } catch {
    return provider === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini";
  }
}
