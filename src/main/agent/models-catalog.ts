export type ProviderId = "openai" | "anthropic" | "openrouter";

export type CatalogModel = {
  id: string;
  label: string;
  contextWindowTokens?: number;
  costTier?: "low" | "medium" | "high";
  supportsTools?: boolean;
};

export type ProviderCatalog = Record<ProviderId, CatalogModel[]>;

// Seeded static catalog. Model identifiers change frequently; this list is best-effort.
export const STATIC_MODEL_CATALOG: ProviderCatalog = {
  openai: [
    { id: "gpt-5", label: "GPT‑5", supportsTools: true, costTier: "high" },
    { id: "gpt-5-mini", label: "GPT‑5 Mini", supportsTools: true, costTier: "medium" },
    { id: "gpt-5-nano", label: "GPT‑5 Nano", supportsTools: true, costTier: "low" },
    { id: "gpt-4o-mini", label: "GPT‑4o Mini (fallback)", supportsTools: true, costTier: "low" },
    { id: "gpt-5-chat-latest", label: "GPT‑5 Chat (router)", supportsTools: true },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025‑05‑14)", supportsTools: true },
    { id: "claude-opus-4-1-20250805", label: "Claude Opus 4.1 (2025‑08‑05)", supportsTools: true },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (2024‑10‑22)", supportsTools: true, costTier: "low" },
  ],
  openrouter: [
    { id: "openai/gpt-5", label: "OpenRouter • OpenAI GPT‑5", supportsTools: true },
    { id: "openai/gpt-4o-mini", label: "OpenRouter • OpenAI GPT‑4o Mini", supportsTools: true },
    { id: "anthropic/claude-sonnet-4-20250514", label: "OpenRouter • Claude Sonnet 4", supportsTools: true },
  ],
};

export function getStaticModels(provider: ProviderId): CatalogModel[] {
  return STATIC_MODEL_CATALOG[provider] ?? [];
}

