export type ProviderId = "openai" | "anthropic" | "openrouter" | "groq";

export type CatalogModel = {
  id: string;
  label: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  costTier?: "low" | "medium" | "high";
  supportsTools?: boolean;
};

export type ProviderCatalog = Record<ProviderId, CatalogModel[]>;

// Seeded static catalog. Model identifiers change frequently; this list is best-effort.
export const STATIC_MODEL_CATALOG: ProviderCatalog = {
  openai: [
    { id: "gpt-5", label: "GPT‑5", supportsTools: true, costTier: "high", maxOutputTokens: 128000 },
    { id: "gpt-5-mini", label: "GPT‑5 Mini", supportsTools: true, costTier: "medium", maxOutputTokens: 128000 },
    { id: "gpt-5-nano", label: "GPT‑5 Nano", supportsTools: true, costTier: "low", maxOutputTokens: 128000 },
    { id: "gpt-4o-mini", label: "GPT‑4o Mini (fallback)", supportsTools: true, costTier: "low", maxOutputTokens: 16384 },
    { id: "gpt-5-chat-latest", label: "GPT‑5 Chat (router)", supportsTools: true, maxOutputTokens: 128000 },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025‑05‑14)", supportsTools: true, maxOutputTokens: 128000 },
    { id: "claude-opus-4-1-20250805", label: "Claude Opus 4.1 (2025‑08‑05)", supportsTools: true, maxOutputTokens: 128000 },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (2024‑10‑22)", supportsTools: true, costTier: "low", maxOutputTokens: 8192 },
  ],
  openrouter: [
    { id: "openai/gpt-5", label: "OpenRouter • OpenAI GPT‑5", supportsTools: true, maxOutputTokens: 128000 },
    { id: "openai/gpt-4o-mini", label: "OpenRouter • OpenAI GPT‑4o Mini", supportsTools: true, maxOutputTokens: 16384 },
    { id: "anthropic/claude-sonnet-4-20250514", label: "OpenRouter • Claude Sonnet 4", supportsTools: true, maxOutputTokens: 128000 },
  ],
  groq: [
    { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 0905", supportsTools: true, maxOutputTokens: 16384, contextWindowTokens: 262144, costTier: "medium" },
  ],
};

export function getStaticModels(provider: ProviderId): CatalogModel[] {
  return STATIC_MODEL_CATALOG[provider] ?? [];
}

/**
 * Get the maximum output tokens for a specific model.
 * Returns the model-specific limit if found, otherwise returns a fallback value.
 *
 * @param provider - The provider ID (openai, anthropic, openrouter)
 * @param modelId - The model identifier
 * @param fallback - Fallback value if model not found (default: 4096)
 * @returns Maximum output tokens for the model
 */
export function getMaxOutputTokensForModel(
  provider: ProviderId,
  modelId: string,
  fallback: number = 4096
): number {
  const models = getStaticModels(provider);
  const model = models.find(m => m.id === modelId);

  if (model?.maxOutputTokens) {
    return model.maxOutputTokens;
  }

  // Fallback patterns for models not in catalog
  const lowerModelId = modelId.toLowerCase();

  // OpenAI model patterns
  if (provider === "openai") {
    if (lowerModelId.includes("gpt-5") && !lowerModelId.includes("chat")) {
      return 128000; // GPT-5 family reasoning models
    }
    if (lowerModelId.includes("gpt-4o-mini")) {
      return 16384;
    }
    if (lowerModelId.includes("gpt-4o")) {
      return 4096; // Standard GPT-4o
    }
  }

  // Anthropic model patterns
  if (provider === "anthropic") {
    if (lowerModelId.includes("claude-sonnet-4") || lowerModelId.includes("claude-opus-4")) {
      return 128000;
    }
    if (lowerModelId.includes("haiku")) {
      return 8192;
    }
    if (lowerModelId.includes("sonnet") || lowerModelId.includes("opus")) {
      return 8192; // Conservative default for Claude 3.x
    }
  }

  // OpenRouter patterns (mirror underlying models)
  if (provider === "openrouter") {
    if (lowerModelId.includes("gpt-5")) {
      return 128000;
    }
    if (lowerModelId.includes("gpt-4o-mini")) {
      return 16384;
    }
    if (lowerModelId.includes("claude-sonnet-4") || lowerModelId.includes("claude-opus-4")) {
      return 128000;
    }
    if (lowerModelId.includes("claude") && lowerModelId.includes("haiku")) {
      return 8192;
    }
  }

  // Groq model patterns
  if (provider === "groq") {
    if (lowerModelId.includes("kimi-k2") || lowerModelId.includes("moonshotai/kimi")) {
      return 16384;
    }
  }

  return fallback;
}

