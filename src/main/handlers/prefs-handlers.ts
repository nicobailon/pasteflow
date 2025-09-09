import type { Request, Response } from 'express';

import { ok, toApiError } from '../error-normalizer';
import { broadcastToRenderers } from '../broadcast-helper';
import type { DatabaseBridge } from '../db/database-bridge';
import type { PreferenceValue } from '../db/database-implementation';

import { keyParam, prefSetBody } from './schemas';

export async function handleGetPreference(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = keyParam.safeParse(req.params);
  if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid key'));
  try {
    const value = await deps.db.getPreference(params.data.key);
    return res.json(ok(value ?? null));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleSetPreference(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = keyParam.safeParse(req.params);
  const body = prefSetBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
  }
  try {
    const val = body.data.value ?? null;
    const enc = body.data.encrypted === true;
    let toStore: PreferenceValue = val as PreferenceValue;
    if (enc && typeof val === 'string' && val.trim().length > 0) {
      const { encryptSecret } = await import('../secret-prefs');
      toStore = encryptSecret(val);
    }
    await deps.db.setPreference(params.data.key, toStore as PreferenceValue);
    broadcastToRenderers('/prefs/get:update');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

