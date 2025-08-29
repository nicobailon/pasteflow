import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

import type { Request, Response } from 'express';
import { z } from 'zod';

import { getPathValidator } from '../security/path-validator';
import { getMainTokenService } from '../services/token-service-main';

import { DatabaseBridge } from './db/database-bridge';
import { WorkspaceState, PreferenceValue, ParsedWorkspace } from './db/database-implementation';
import { setAllowedWorkspacePaths, getAllowedWorkspacePaths } from './workspace-context';
import { toApiError, ok } from './error-normalizer';
import { validateAndResolvePath, statFile as fileServiceStatFile, readTextFile } from './file-service';
import { applySelect, applyDeselect } from './selection-service';
import { aggregateSelectedContent } from './content-aggregation';
import { writeExport } from './export-writer';
import { RendererPreviewProxy } from './preview-proxy';
import { PreviewController } from './preview-controller';

// Schema definitions
export const idParam = z.object({ id: z.string().min(1) });
export const createWorkspaceBody = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional(),
});
export const updateWorkspaceBody = z.object({
  state: z.record(z.string(), z.unknown()),
});
export const renameBody = z.object({ newName: z.string().min(1).max(255) });
export const instructionBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
});
export const keyParam = z.object({ key: z.string().min(1) });
export const prefSetBody = z.object({ value: z.unknown().optional() });
export const filePathQuery = z.object({ path: z.string().min(1) });
export const tokensCountBody = z.object({ text: z.string().min(0) });
export const foldersOpenBody = z.object({
  folderPath: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});
export const lineRange = z.object({ start: z.number().int().min(1), end: z.number().int().min(1) });
export const selectionItem = z.object({ path: z.string().min(1), lines: z.array(lineRange).nonempty().optional() });
export const selectionBody = z.object({ items: z.array(selectionItem).min(1) });
export const exportBody = z.object({ outputPath: z.string().min(1), overwrite: z.boolean().optional() });
export const previewStartBody = z.object({
  includeTrees: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(10_000).optional(),
  maxBytes: z.number().int().min(1).max(50 * 1024 * 1024).optional(),
  prompt: z.string().max(100_000).optional()
});
export const previewIdParam = z.object({ id: z.string().min(1) });

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

export class APIRouteHandlers {
  constructor(
    private readonly db: DatabaseBridge,
    private readonly previewProxy: RendererPreviewProxy,
    private readonly previewController: PreviewController
  ) {}

  // Health and Status handlers
  async handleHealth(_req: Request, res: Response) {
    return res.json(ok({ status: 'ok' as const }));
  }

  async handleStatus(_req: Request, res: Response) {
    try {
      const activeId = await this.db.getPreference('workspace.active');
      let active: null | { id: string; name: string; folderPath: string } = null;
      const allowedPaths = [...getAllowedWorkspacePaths()];
      let ws: ParsedWorkspace | null = null;
      if (activeId) {
        ws = await this.db.getWorkspace(String(activeId));
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

  // Workspace handlers
  async handleListWorkspaces(_req: Request, res: Response) {
    try {
      const rows = await this.db.listWorkspaces();
      const data = rows.map(mapWorkspaceDbToJson);
      return res.json(ok(data));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleCreateWorkspace(req: Request, res: Response) {
    const parsed = createWorkspaceBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    try {
      const created = await this.db.createWorkspace(
        parsed.data.name,
        parsed.data.folderPath,
        (parsed.data.state ?? {}) as Partial<WorkspaceState>
      );
      return res.json(ok(mapWorkspaceDbToJson(created)));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleGetWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      const ws = await this.db.getWorkspace(params.data.id);
      if (!ws) return res.json(ok(null));
      return res.json(ok(mapWorkspaceDbToJson(ws)));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleUpdateWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    const body = updateWorkspaceBody.safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    try {
      await this.db.updateWorkspaceById(params.data.id, body.data.state as Partial<WorkspaceState>);
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleDeleteWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      await this.db.deleteWorkspaceById(params.data.id);
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleRenameWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    const body = renameBody.safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    try {
      const ws = await this.db.getWorkspace(params.data.id);
      if (!ws) return res.status(404).json(toApiError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
      await this.db.renameWorkspace(ws.name, body.data.newName);
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleLoadWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      await this.db.setPreference('workspace.active', params.data.id);
      const ws = await this.db.getWorkspace(params.data.id);
      if (ws?.folder_path) {
        setAllowedWorkspacePaths([ws.folder_path]);
        getPathValidator([ws.folder_path]);
      }
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Instruction handlers
  async handleListInstructions(_req: Request, res: Response) {
    try {
      const rows = await this.db.listInstructions();
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

  async handleCreateInstruction(req: Request, res: Response) {
    const body = instructionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    const id = body.data.id ?? randomUUID();
    try {
      await this.db.createInstruction(id, body.data.name, body.data.content);
      return res.json(ok({ id, name: body.data.name, content: body.data.content }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleUpdateInstruction(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    const body = z.object({ name: z.string().min(1).max(255), content: z.string() }).safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    try {
      await this.db.updateInstruction(params.data.id, body.data.name, body.data.content);
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleDeleteInstruction(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      await this.db.deleteInstruction(params.data.id);
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Preference handlers
  async handleGetPreference(req: Request, res: Response) {
    const params = keyParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid key'));
    try {
      const value = await this.db.getPreference(params.data.key);
      return res.json(ok(value ?? null));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleSetPreference(req: Request, res: Response) {
    const params = keyParam.safeParse(req.params);
    const body = prefSetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    }
    try {
      await this.db.setPreference(params.data.key, (body.data.value ?? null) as PreferenceValue);
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // File handlers
  async handleFileInfo(req: Request, res: Response) {
    const validation = await this.validateFilePath(req, res);
    if (!validation) return;

    const s = await fileServiceStatFile(validation.absolutePath);
    if (!s.ok) {
      return this.handleFileError(s, res);
    }
    return res.json(ok(s.data));
  }

  async handleFileContent(req: Request, res: Response) {
    const validation = await this.validateFilePath(req, res);
    if (!validation) return;

    const s = await fileServiceStatFile(validation.absolutePath);
    if (!s.ok) {
      return this.handleFileError(s, res);
    }

    if (s.data.isDirectory) {
      return res.status(400).json(toApiError('VALIDATION_ERROR', 'Path is a directory'));
    }
    if (s.data.isBinary) {
      return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
    }

    const r = await readTextFile(validation.absolutePath);
    if (!r.ok) {
      return this.handleReadError(r, res);
    }

    if (r.isLikelyBinary) {
      return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
    }

    const tokenService = getMainTokenService();
    const { count } = await tokenService.countTokens(r.content);
    return res.json(ok({ content: r.content, tokenCount: count, fileType: s.data.fileType || 'plaintext' }));
  }

  // Token handlers
  async handleCountTokens(req: Request, res: Response) {
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

  async handleGetTokenBackend(_req: Request, res: Response) {
    try {
      const tokenService = getMainTokenService();
      const backend = await tokenService.getActiveBackend();
      return res.json(ok({ backend: backend ?? 'estimate' }));
    } catch (error) {
      return res.status(500).json(toApiError('INTERNAL_ERROR', (error as Error).message));
    }
  }

  // Folder handlers
  async handleGetCurrentFolder(_req: Request, res: Response) {
    try {
      const activeId = await this.db.getPreference('workspace.active');
      if (!activeId) return res.json(ok(null));
      const ws = await this.db.getWorkspace(String(activeId));
      if (!ws) return res.json(ok(null));
      return res.json(ok({ folderPath: ws.folder_path }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleOpenFolder(req: Request, res: Response) {
    const body = foldersOpenBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    
    try {
      const folderPath = String(body.data.folderPath);
      const validation = await this.validateFolderPath(folderPath);
      if (!validation.isValid) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', validation.message));
      }

      const workspace = await this.findOrCreateWorkspace(folderPath, body.data.name);
      if (workspace.error) {
        return res.status(workspace.status).json(toApiError(workspace.code, workspace.message));
      }

      // TypeScript now knows workspace.error is false, so workspace.data exists
      const { data } = workspace;
      await this.activateWorkspace(data);
      return res.json(ok({ 
        id: String(data.id), 
        name: data.name, 
        folderPath: data.folder_path 
      }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Helper methods
  private async validateFilePath(req: Request, res: Response) {
    const q = filePathQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid query'));
      return null;
    }

    const allowed = getAllowedWorkspacePaths();
    if (!allowed || allowed.length === 0) {
      res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
      return null;
    }

    const val = validateAndResolvePath(String(q.data.path));
    if (!val.ok) {
      this.handlePathValidationError(val, res);
      return null;
    }

    return val;
  }

  private handlePathValidationError(val: { ok: false; code: string; message: string }, res: Response) {
    if (val.code === 'NO_ACTIVE_WORKSPACE') {
      res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', val.message));
    } else if (val.code === 'PATH_DENIED') {
      res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
    } else {
      res.status(400).json(toApiError('VALIDATION_ERROR', val.message));
    }
  }

  private handleFileError(s: { ok: false; code: string; message: string }, res: Response) {
    if (s.code === 'FILE_NOT_FOUND') {
      return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
    }
    if (s.code === 'FILE_SYSTEM_ERROR') {
      return res.status(500).json(toApiError('FILE_SYSTEM_ERROR', s.message));
    }
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', s.message));
  }

  private handleReadError(r: { ok: false; code: string; message: string }, res: Response) {
    if (r.code === 'FILE_NOT_FOUND') {
      return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
    }
    if (r.code === 'BINARY_FILE') {
      return res.status(409).json(toApiError('BINARY_FILE', r.message));
    }
    if (r.code === 'VALIDATION_ERROR') {
      return res.status(400).json(toApiError('VALIDATION_ERROR', r.message));
    }
    if (r.code === 'FILE_SYSTEM_ERROR') {
      return res.status(500).json(toApiError('FILE_SYSTEM_ERROR', r.message));
    }
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', r.message));
  }

  private async validateFolderPath(folderPath: string) {
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

  private async findOrCreateWorkspace(folderPath: string, name?: string): Promise<
    | { error: true; status: number; code: 'VALIDATION_ERROR'; message: string }
    | { error: false; data: ParsedWorkspace }
  > {
    const workspaces = await this.db.listWorkspaces();
    let ws = workspaces.find((w) => w.folder_path === folderPath);

    if (!ws) {
      const requestedName = name ?? (path.basename(folderPath) || `workspace-${randomUUID().slice(0, 8)}`);
      const collision = workspaces.find((w) => w.name === requestedName && w.folder_path !== folderPath);
      
      if (collision && name) {
        return { 
          error: true, 
          status: 409, 
          code: 'VALIDATION_ERROR' as const, 
          message: `Workspace name '${requestedName}' already exists` 
        };
      }
      
      const effectiveName = collision && !name ? `${requestedName}-${randomUUID().slice(0, 6)}` : requestedName;
      ws = await this.db.createWorkspace(effectiveName, folderPath, {} as WorkspaceState);
    }

    return { error: false, data: ws };
  }

  private async activateWorkspace(workspace: ParsedWorkspace) {
    await this.db.setPreference('workspace.active', String(workspace.id));
    setAllowedWorkspacePaths([workspace.folder_path]);
    getPathValidator([workspace.folder_path]);
  }
}