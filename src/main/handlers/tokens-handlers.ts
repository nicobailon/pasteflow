import type { Request, Response } from 'express';

import { ok, toApiError } from '../error-normalizer';
import { getMainTokenService } from '../../services/token-service-main';

import { tokensCountBody } from './schemas';

export async function handleCountTokens(req: Request, res: Response) {
  const body = tokensCountBody.safeParse(req.body);
  if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
  try {
    const tokenService = getMainTokenService();
    const result = await tokenService.countTokens(body.data.text);
    return res.json(ok(result));
  } catch (error) {
    return res.status(500).json(toApiError('INTERNAL_ERROR', (error as Error).message));
  }
}

export async function handleGetTokenBackend(_req: Request, res: Response) {
  try {
    const tokenService = getMainTokenService();
    const backend = await tokenService.getActiveBackend();
    return res.json(ok({ backend: backend ?? 'estimate' }));
  } catch (error) {
    return res.status(500).json(toApiError('INTERNAL_ERROR', (error as Error).message));
  }
}

