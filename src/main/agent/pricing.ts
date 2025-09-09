import type { ProviderId } from "./models-catalog";

// Prices are per 1,000,000 tokens (per-million) to match vendor docs
export type Pricing = {
  inPerMTok: number; // USD per 1M input tokens
  outPerMTok: number; // USD per 1M output tokens
  cacheWritePerMTok?: number;
  cacheReadPerMTok?: number;
  thinkPerMTok?: number; // e.g., "reasoning"/"thinking" tokens for some providers
  subscriptionFree?: boolean; // when usage is covered by subscription (set cost=0)
};

// Minimal seed catalog covering common defaults used by PasteFlow out of the box
// Extend over time as needed; unknown models return null for cost (UI can show "—")
const PRICING: Record<string, Pricing> = {
  // OpenAI
  "openai:gpt-4o-mini": { inPerMTok: 5, outPerMTok: 15 },
  "openai:gpt-5": { inPerMTok: 10, outPerMTok: 30 }, // placeholder conservative
  "openai:gpt-5-mini": { inPerMTok: 6, outPerMTok: 18 }, // placeholder conservative

  // Anthropic
  "anthropic:claude-3-5-haiku-20241022": { inPerMTok: 3, outPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  "anthropic:claude-sonnet-4-20250514": { inPerMTok: 3, outPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },

  // OpenRouter routes (map to underlying OpenAI pricing as a safe approximation)
  "openrouter:openai/gpt-4o-mini": { inPerMTok: 5, outPerMTok: 15 },
};

export type CostInput = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheWriteTokens?: number | null;
  cacheReadTokens?: number | null;
  thinkingTokens?: number | null;
};

function keyFor(provider: ProviderId, modelId: string): string {
  return `${provider}:${modelId}`.toLowerCase();
}

export function calculateCostUSD(
  provider: ProviderId,
  modelId: string,
  usage: CostInput
): number | null {
  try {
    const k = keyFor(provider, modelId);
    const p = PRICING[k];
    if (!p) return null;
    if (p.subscriptionFree) return 0;

    const inTok = Math.max(0, Number(usage.inputTokens || 0));
    const outTok = Math.max(0, Number(usage.outputTokens || 0));
    const cwTok = Math.max(0, Number(usage.cacheWriteTokens || 0));
    const crTok = Math.max(0, Number(usage.cacheReadTokens || 0));
    const thTok = Math.max(0, Number(usage.thinkingTokens || 0));

    // OpenAI-like rule: subtract cached reads/writes from input for "uncached" input cost when both are present
    let uncachedIn = inTok;
    if ((cwTok > 0 || crTok > 0) && inTok > 0) {
      const subtract = Math.min(inTok, cwTok + crTok);
      uncachedIn = Math.max(0, inTok - subtract);
    }

    const inCost = p.inPerMTok * (uncachedIn / 1_000_000);
    const outCost = p.outPerMTok * (outTok / 1_000_000);
    const cwCost = p.cacheWritePerMTok ? p.cacheWritePerMTok * (cwTok / 1_000_000) : 0;
    const crCost = p.cacheReadPerMTok ? p.cacheReadPerMTok * (crTok / 1_000_000) : 0;
    const thCost = p.thinkPerMTok ? p.thinkPerMTok * (thTok / 1_000_000) : 0;

    const total = inCost + outCost + cwCost + crCost + thCost;
    // Guard against denormals; round to cents precision but return full float
    if (!Number.isFinite(total) || total < 0) return null;
    return total;
  } catch {
    return null;
  }
}

