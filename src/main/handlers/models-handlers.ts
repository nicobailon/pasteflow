import type { Request, Response } from 'express';
import type { LanguageModel } from 'ai';

import { ok, toApiError } from '../error-normalizer';
import type { ProviderId } from '../agent/models-catalog';
import type { DatabaseBridge } from '../db/database-bridge';

import { listModelsQuery, validateModelBody } from './schemas';

export async function handleListModels(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  try {
    const parsed = listModelsQuery.safeParse(req.query);
    const { resolveAgentConfig } = await import('../agent/config');
    const cfg = await resolveAgentConfig(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
    const providerParam = parsed.success && typeof parsed.data.provider === 'string' ? parsed.data.provider.toLowerCase() : null;
    const provider: ProviderId = (providerParam === 'openai' || providerParam === 'anthropic' || providerParam === 'openrouter') ? providerParam : cfg.PROVIDER;
    const { getStaticModels } = await import('../agent/models-catalog');
    const models = getStaticModels(provider);
    return res.json(ok({ provider, models }));
  } catch (error) {
    return res.status(500).json(toApiError('SERVER_ERROR', (error as Error)?.message || 'Failed to list models'));
  }
}

export async function handleValidateModel(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const body = validateModelBody.safeParse(req.body);
  if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request body'));
  const { provider, model, apiKey, baseUrl, temperature, maxOutputTokens } = body.data;

  // Validate maxOutputTokens against model-specific limits
  if (maxOutputTokens) {
    const { getMaxOutputTokensForModel } = await import('../agent/models-catalog');
    const modelLimit = getMaxOutputTokensForModel(provider, model);
    if (maxOutputTokens > modelLimit) {
      return res.status(400).json(toApiError('VALIDATION_ERROR',
        `maxOutputTokens (${maxOutputTokens}) exceeds the limit for ${provider}:${model} (${modelLimit})`));
    }
  }
  try {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { generateText } = await import('ai');
    const { loadProviderCredentials } = await import('../agent/model-resolver');

    const creds = await loadProviderCredentials(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });

    let lm: LanguageModel;
    if (provider === 'openai') {
      const client = createOpenAI({ apiKey: apiKey || creds.openai?.apiKey || undefined });
      lm = client(model);
    } else if (provider === 'anthropic') {
      const client = createAnthropic({ apiKey: apiKey || creds.anthropic?.apiKey || undefined });
      lm = client(model);
    } else {
      const client = createOpenAI({ apiKey: apiKey || creds.openrouter?.apiKey || undefined, baseURL: baseUrl || creds.openrouter?.baseUrl || 'https://openrouter.ai/api/v1' });
      lm = client(model);
    }

    const validationModelIdStr = String(model || '');
    const validationIsReasoningModel = (() => {
      try {
        const s = validationModelIdStr.toLowerCase();
        return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
      } catch { return false; }
    })();

    await generateText({
      model: lm,
      prompt: 'ping',
      maxOutputTokens: Math.max(1, Math.min(10, Number(maxOutputTokens || 1))),
      temperature: validationIsReasoningModel ? undefined : (typeof temperature === 'number' ? temperature : 0),
    });

    return res.json(ok({ ok: true }));
  } catch (error) {
    const msg = (error as Error)?.message || 'Validation failed';
    return res.json(ok({ ok: false, error: msg }));
  }
}
