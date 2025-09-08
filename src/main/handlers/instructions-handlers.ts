import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';
import { z } from 'zod';

import { ok, toApiError } from '../error-normalizer';
import { broadcastToRenderers } from '../broadcast-helper';
import type { DatabaseBridge } from '../db/database-bridge';
import { idParam, instructionBody } from './schemas';

export async function handleListInstructions(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const rows = await deps.db.listInstructions();
    const data = rows.map((i) => ({
      id: i.id,
      name: i.name,
      content: i.content,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    }));
    return res.json(ok(data));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleCreateInstruction(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const body = instructionBody.safeParse(req.body);
  if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
  const id = body.data.id ?? randomUUID();
  try {
    await deps.db.createInstruction(id, body.data.name, body.data.content);
    broadcastToRenderers('instructions-updated');
    return res.json(ok({ id, name: body.data.name, content: body.data.content }));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleUpdateInstruction(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  const body = z.object({ name: z.string().min(1).max(255), content: z.string() }).safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
  try {
    await deps.db.updateInstruction(params.data.id, body.data.name, body.data.content);
    broadcastToRenderers('instructions-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleDeleteInstruction(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
  try {
    await deps.db.deleteInstruction(params.data.id);
    broadcastToRenderers('instructions-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}
