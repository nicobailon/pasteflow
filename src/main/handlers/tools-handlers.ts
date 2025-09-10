import type { Request, Response } from 'express';
import { getToolCatalog } from '../agent/tool-catalog';
import { ok, toApiError } from '../error-normalizer';
import type { DatabaseBridge } from '../db/database-bridge';
import { getEnabledToolsRecord } from '../agent/tools-config';

export async function handleListTools(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const catalog = getToolCatalog();
    const enabled = await getEnabledToolsRecord(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
    return res.json(ok({ tools: catalog, enabled }));
  } catch (error) {
    return res.status(500).json(toApiError('SERVER_ERROR', (error as Error)?.message || 'Failed to list tools'));
  }
}

