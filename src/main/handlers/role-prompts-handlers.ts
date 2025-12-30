import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';
import { z } from 'zod';

import { ok, toApiError } from '../error-normalizer';
import { broadcastToRenderers } from '../broadcast-helper';
import type { DatabaseBridge } from '../db/database-bridge';
import { idParam, rolePromptBody } from './schemas';

export async function handleListRolePrompts(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const rows = await deps.db.listRolePrompts();
    const data = rows.map((p) => ({
      id: p.id,
      name: p.name,
      content: p.content,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
    return res.json(ok(data));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleCreateRolePrompt(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const body = rolePromptBody.safeParse(req.body);
  if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
  const id = body.data.id ?? randomUUID();
  try {
    await deps.db.createRolePrompt(id, body.data.name, body.data.content);
    broadcastToRenderers('role-prompts-updated');
    return res.json(ok({ id, name: body.data.name, content: body.data.content }));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleUpdateRolePrompt(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  const body = z.object({ name: z.string().min(1).max(255), content: z.string() }).safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
  try {
    await deps.db.updateRolePrompt(params.data.id, body.data.name, body.data.content);
    broadcastToRenderers('role-prompts-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleDeleteRolePrompt(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
  try {
    await deps.db.deleteRolePrompt(params.data.id);
    broadcastToRenderers('role-prompts-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}
