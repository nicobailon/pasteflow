import type { Request, Response } from 'express';

import { ok, toApiError } from '../error-normalizer';
import { broadcastToRenderers } from '../broadcast-helper';
import type { DatabaseBridge } from '../db/database-bridge';
import { userInstructionsBody } from './schemas';

const USER_INSTRUCTIONS_KEY = 'user.instructions';

export async function handleGetUserInstructions(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const value = await deps.db.getPreference(USER_INSTRUCTIONS_KEY);
    return res.json(ok({ content: (value as string) ?? '' }));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleSetUserInstructions(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const body = userInstructionsBody.safeParse(req.body);
  if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
  try {
    await deps.db.setPreference(USER_INSTRUCTIONS_KEY, body.data.content);
    broadcastToRenderers('user-instructions-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}
