import path from 'node:path';
import fs from 'node:fs';

import type { Request, Response } from 'express';

import { ok, toApiError } from '../error-normalizer';
import { setAllowedWorkspacePaths } from '../workspace-context';
import { getPathValidator } from '../../security/path-validator';
import { broadcastToRenderers } from '../broadcast-helper';
import type { DatabaseBridge } from '../db/database-bridge';
import type { ParsedWorkspace, WorkspaceState } from '../db/database-implementation';
import { foldersOpenBody } from './schemas';

export async function handleGetCurrentFolder(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const activeId = await deps.db.getPreference('workspace.active');
    if (!activeId) return res.json(ok(null));
    const ws = await deps.db.getWorkspace(String(activeId));
    if (!ws) return res.json(ok(null));
    return res.json(ok({ folderPath: ws.folder_path }));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleOpenFolder(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const body = foldersOpenBody.safeParse(req.body);
  if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));

  try {
    const folderPath = String(body.data.folderPath);
    const validation = await validateFolderPath(folderPath);
    if (!validation.isValid) {
      return res.status(400).json(toApiError('VALIDATION_ERROR', validation.message));
    }

    const workspace = await findOrCreateWorkspace(deps.db, folderPath, body.data.name);
    if (workspace.error) {
      return res.status(workspace.status).json(toApiError(workspace.code, workspace.message));
    }

    const { data } = workspace;
    await activateWorkspace(deps.db, data);
    try {
      const { globalSystemContextCache } = await import('../agent/system-context-cache');
      await globalSystemContextCache.refresh();
    } catch { /* non-fatal */ }

    broadcastToRenderers('folder-selected', data.folder_path);

    return res.json(ok({ id: String(data.id), name: data.name, folderPath: data.folder_path }));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

async function validateFolderPath(folderPath: string) {
  try {
    const st = await fs.promises.stat(folderPath);
    if (!st.isDirectory()) {
      return { isValid: false, message: 'Path is not a directory' };
    }
    return { isValid: true, message: '' };
  } catch {
    return { isValid: false, message: 'Folder does not exist' };
  }
}

async function findOrCreateWorkspace(db: DatabaseBridge, folderPath: string, name?: string): Promise<
  | { error: true; status: number; code: 'VALIDATION_ERROR'; message: string }
  | { error: false; data: ParsedWorkspace }
> {
  const workspaces = await db.listWorkspaces();
  let ws = workspaces.find((w) => w.folder_path === folderPath);

  if (!ws) {
    const requestedName = name ?? (path.basename(folderPath) || `workspace-${Math.random().toString(36).slice(2, 10)}`);
    const collision = workspaces.find((w) => w.name === requestedName && w.folder_path !== folderPath);

    if (collision && name) {
      return { error: true, status: 409, code: 'VALIDATION_ERROR' as const, message: `Workspace name '${requestedName}' already exists` };
    }

    const effectiveName = collision && !name ? `${requestedName}-${Math.random().toString(36).slice(2, 8)}` : requestedName;
    ws = await db.createWorkspace(effectiveName, folderPath, {} as WorkspaceState);
  }

  return { error: false, data: ws };
}

async function activateWorkspace(db: DatabaseBridge, workspace: ParsedWorkspace) {
  await db.setPreference('workspace.active', String(workspace.id));
  setAllowedWorkspacePaths([workspace.folder_path]);
  getPathValidator([workspace.folder_path]);
}
