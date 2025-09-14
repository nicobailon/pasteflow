import { createOpenAI, openai as openaiDirect } from "@ai-sdk/openai";
import { createAnthropic, anthropic as anthropicDirect } from "@ai-sdk/anthropic";
import { createGroq, groq as groqDirect } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

// Note: keep minimal types local to avoid importing broad DB bridge types
import { isSecretBlob, decryptSecret } from "../secret-prefs";

import type { AgentConfig } from "./config";
import type { ProviderId } from "./models-catalog";
import { getStaticModels } from "./models-catalog";


type DbGetter = { getPreference: (k: string) => Promise<unknown> };

function isReasoningModelId(id: string): boolean {
  try {
    const s = id.toLowerCase();
    return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
  } catch { return false; }
}

export type ProviderCredentials = {
  openai?: { apiKey?: string | null };
  anthropic?: { apiKey?: string | null };
  openrouter?: { apiKey?: string | null; baseUrl?: string | null };
  groq?: { apiKey?: string | null };
};

const unwrapSecretOrString = (v: unknown): string | null => {
  if (isSecretBlob(v)) {
    try { return decryptSecret(v); } catch { return null; }
  }
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
};

export async function loadProviderCredentials(db: DbGetter): Promise<ProviderCredentials> {
  const safeGet = async (k: string): Promise<unknown> => {
    try { return await db.getPreference(k); } catch { return undefined; }
  };

  const [okey, akey, orKey, orBase, groqKey] = await Promise.all([
    safeGet("integrations.openai.apiKey"),
    safeGet("integrations.anthropic.apiKey"),
    safeGet("integrations.openrouter.apiKey"),
    safeGet("integrations.openrouter.baseUrl"),
    safeGet("integrations.groq.apiKey"),
  ]);

  return {
    openai: { apiKey: unwrapSecretOrString(okey) },
    anthropic: { apiKey: unwrapSecretOrString(akey) },
    openrouter: { apiKey: unwrapSecretOrString(orKey), baseUrl: typeof orBase === "string" && orBase.trim() ? orBase.trim() : "https://openrouter.ai/api/v1" },
    groq: { apiKey: unwrapSecretOrString(groqKey) },
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


  const resolveOpenAI = (): { model: LanguageModel } => {
    const key = creds.openai?.apiKey || process.env.OPENAI_API_KEY || null;
    if (key && typeof createOpenAI === 'function') {
      const client = createOpenAI({ apiKey: key });
      return { model: client(modelId) } as any;
    }
    return { model: openaiDirect(modelId) } as any;
  };

  const resolveAnthropic = (): { model: LanguageModel } => {
    const key = creds.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || null;
    if (key && typeof createAnthropic === 'function') {
      const client = createAnthropic({ apiKey: key });
      return { model: client(modelId) } as any;
    }
    return { model: anthropicDirect(modelId) } as any;
  };

  const resolveGroq = (): { model: LanguageModel } => {
    const key = creds.groq?.apiKey || null;
    if (key && typeof createGroq === 'function') {
      const client = createGroq({ apiKey: key });
      return { model: client(modelId) } as any;
    }
    return { model: groqDirect(modelId) } as any;
  };

  const resolveOpenRouter = (): { model: LanguageModel } => {
    const key = creds.openrouter?.apiKey || null;
    const baseURL = creds.openrouter?.baseUrl || "https://openrouter.ai/api/v1";
    const isReasoning = isReasoningModelId(modelId);
    if (typeof createOpenAI !== 'function') {
      return { model: openaiDirect(modelId) } as any;
    }
    const client = createOpenAI({ apiKey: key || ("" as unknown as string), baseURL });
    return { model: isReasoning ? client(modelId) : client.chat(modelId) } as any;
  };

  switch (provider) {
    case "openai": {
      return resolveOpenAI();
    }
    case "anthropic": {
      return resolveAnthropic();
    }
    case "groq": {
      return resolveGroq();
    }
    case "openrouter": {
      return resolveOpenRouter();
    }
    default: {
      const provCreds = await loadProviderCredentials(db);
      const client = createOpenAI({ apiKey: provCreds.openai?.apiKey || undefined });
      const isReasoning = isReasoningModelId(modelId);
      return { model: isReasoning ? client(modelId) : client.chat(modelId) };
    }
  }
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
    if (!raw) {
      if (provider === "openrouter") return "openai/gpt-4o-mini";
      if (provider === "groq") return "moonshotai/kimi-k2-instruct-0905";
      return "gpt-4o-mini";
    }

    const norm = (s: string) => s.toLowerCase().replace(/[^\da-z]/g, "");
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
    if (provider === "openrouter") return "openai/gpt-4o-mini";
    if (provider === "groq") return "moonshotai/kimi-k2-instruct-0905";
    return "gpt-4o-mini";
  }
}
