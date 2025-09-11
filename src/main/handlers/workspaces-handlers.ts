import type { Request, Response } from 'express';

import { ok, toApiError } from '../error-normalizer';
import { setAllowedWorkspacePaths, getAllowedWorkspacePaths } from '../workspace-context';
import { getPathValidator } from '../../security/path-validator';
import { broadcastToRenderers, broadcastWorkspaceUpdated } from '../broadcast-helper';

import type { DatabaseBridge } from '../db/database-bridge';
import type { ParsedWorkspace, WorkspaceState } from '../db/database-implementation';

import { idParam, createWorkspaceBody, updateWorkspaceBody, renameBody } from './schemas';

export function mapWorkspaceDbToJson(w: ParsedWorkspace) {
  return {
    id: String(w.id),
    name: w.name,
    folderPath: w.folder_path,
    state: w.state,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    lastAccessed: w.last_accessed,
  };
}

export async function handleHealth(_deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  return res.json(ok({ status: 'ok' as const }));
}

export async function handleStatus(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const activeId = await deps.db.getPreference('workspace.active');
    let active: null | { id: string; name: string; folderPath: string } = null;
    const allowedPaths = [...getAllowedWorkspacePaths()];
    let ws: ParsedWorkspace | null = null;
    if (activeId) {
      ws = await deps.db.getWorkspace(String(activeId));
      if (ws) {
        active = { id: String(ws.id), name: ws.name, folderPath: ws.folder_path };
      }
    }
    if (allowedPaths.length === 0 && ws?.folder_path) {
      allowedPaths.push(ws.folder_path);
    }
    return res.json(ok({ status: 'running', activeWorkspace: active, securityContext: { allowedPaths } }));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleListWorkspaces(deps: { db: DatabaseBridge }, _req: Request, res: Response) {
  try {
    const rows = await deps.db.listWorkspaces();
    const data = rows.map((w) => mapWorkspaceDbToJson(w));
    return res.json(ok(data));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleCreateWorkspace(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const parsed = createWorkspaceBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
  try {
    const created = await deps.db.createWorkspace(
      parsed.data.name,
      parsed.data.folderPath,
      (parsed.data.state ?? {}) as Partial<WorkspaceState>
    );
    broadcastToRenderers('workspaces-updated');
    return res.json(ok(mapWorkspaceDbToJson(created)));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleGetWorkspace(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
  try {
    const ws = await deps.db.getWorkspace(params.data.id);
    if (!ws) return res.json(ok(null));
    return res.json(ok(mapWorkspaceDbToJson(ws)));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleUpdateWorkspace(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  const body = updateWorkspaceBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
  try {
    await deps.db.updateWorkspaceById(params.data.id, body.data.state as Partial<WorkspaceState>);
    try {
      const ws = await deps.db.getWorkspace(params.data.id);
      if (ws) {
        broadcastWorkspaceUpdated({
          workspaceId: String(ws.id),
          folderPath: ws.folder_path,
          selectedFiles: (ws.state?.selectedFiles ?? []) as { path: string; lines?: { start: number; end: number }[] }[],
        });
      }
    } catch { /* noop */ }
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleDeleteWorkspace(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
  try {
    await deps.db.deleteWorkspaceById(params.data.id);
    broadcastToRenderers('workspaces-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleRenameWorkspace(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  const body = renameBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
  try {
    const ws = await deps.db.getWorkspace(params.data.id);
    if (!ws) return res.status(404).json(toApiError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
    await deps.db.renameWorkspace(ws.name, body.data.newName);
    broadcastToRenderers('workspaces-updated');
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}

export async function handleLoadWorkspace(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
  try {
    await deps.db.setPreference('workspace.active', params.data.id);
    const ws = await deps.db.getWorkspace(params.data.id);
    if (ws?.folder_path) {
      setAllowedWorkspacePaths([ws.folder_path]);
      getPathValidator([ws.folder_path]);
      try {
        const { globalSystemContextCache } = await import('../agent/system-context-cache');
        await globalSystemContextCache.refresh();
      } catch { /* non-fatal */ }
      broadcastToRenderers('folder-selected', ws.folder_path);
      broadcastWorkspaceUpdated({
        workspaceId: String(ws.id),
        folderPath: ws.folder_path,
        selectedFiles: (ws.state?.selectedFiles ?? []) as { path: string; lines?: { start: number; end: number }[] }[],
      });
    }
    return res.json(ok(true));
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}
