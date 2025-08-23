import express, { Express, Request, Response, NextFunction } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseBridge } from './db/database-bridge';
import { WorkspaceState, PreferenceValue } from './db/database-implementation';
import { AuthManager } from './auth-manager';
import { setAllowedWorkspacePaths, getAllowedWorkspacePaths } from './workspace-context';
import { toApiError, ok } from './error-normalizer';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { validateAndResolvePath, statFile as fileServiceStatFile, readTextFile } from './file-service';
import { getMainTokenService } from '../services/token-service-main';
import { getPathValidator } from '../security/path-validator';

const idParam = z.object({ id: z.string().min(1) });
const createWorkspaceBody = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional(),
});
const updateWorkspaceBody = z.object({
  state: z.record(z.string(), z.unknown()),
});
const renameBody = z.object({ newName: z.string().min(1).max(255) });
const instructionBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
});
const keyParam = z.object({ key: z.string().min(1) });
const prefSetBody = z.object({ value: z.unknown().optional() });
const filePathQuery = z.object({ path: z.string().min(1) });
const tokensCountBody = z.object({ text: z.string().min(0) });
const foldersOpenBody = z.object({
  folderPath: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});

function mapWorkspaceDbToJson(w: any) {
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

export class PasteFlowAPIServer {
  private readonly app: Express;
  private readonly auth = new AuthManager();
  private server: Server | null = null;

  constructor(private readonly db: DatabaseBridge, private readonly port = 5839) {
    this.app = express();
    // Authorization first to minimize processing on unauthorized requests
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (this.auth.validate(req.headers.authorization)) {
        return next();
      }
      return res.status(401).json(toApiError('UNAUTHORIZED', 'Unauthorized'));
    });
    // JSON parser after auth
    this.app.use(express.json({ limit: '10mb' }));
    // Normalize JSON parse errors to 400 VALIDATION_ERROR
    this.app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (err && typeof err === 'object' && 'type' in (err as any) && (err as any).type === 'entity.parse.failed') {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid JSON'));
      }
      if (err instanceof SyntaxError) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid JSON'));
      }
      return next(err as any);
    });

    this.registerRoutes();
  }

  start(): void {
    // Fire-and-forget start; useful for tests that poll getPort()
    void this.startAsync();
  }

  async startAsync(): Promise<void> {
    if (this.server) return;
    const host = '127.0.0.1';
    // If port is 0, bind once to ephemeral; otherwise try range [port, port+20]
    const tryPorts = this.port === 0 ? [0] : Array.from({ length: 21 }, (_, i) => this.port + i);
    for (const p of tryPorts) {
      try {
        await new Promise<void>((resolve, reject) => {
          const srv = this.app.listen(p, host, () => {
            this.server = srv as Server;
            resolve();
          });
          const onError = (err: any) => {
            // Clean up listener to avoid leaks
            // @ts-ignore - off may not exist in older node typings
            srv.off?.('error', onError);
            // Allow next port on address-in-use or access-denied
            if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
              try { srv.close(); } catch {}
              reject(err);
            } else {
              reject(err);
            }
          };
          srv.on('error', onError);
        });
        // Success
        return;
      } catch {
        // Try next port
      }
    }
    throw new Error('Failed to bind API server to any port in range');
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }

  getPort(): number {
    if (this.server) {
      const addr = this.server.address() as AddressInfo | string | null;
      if (addr && typeof addr === 'object') {
        return addr.port;
      }
    }
    return this.port;
  }

  getAuthToken(): string {
    return this.auth.getToken();
  }

  private registerRoutes(): void {
    // Health
    this.app.get('/api/v1/health', (_req, res) => res.json(ok({ status: 'ok' as const })));

    // Status
    this.app.get('/api/v1/status', async (_req, res) => {
      try {
        const activeId = await this.db.getPreference('workspace.active');
        let active: null | { id: string; name: string; folderPath: string } = null;
        const allowedPaths = [...getAllowedWorkspacePaths()];
        let ws: any | null = null;
        if (activeId) {
          ws = await this.db.getWorkspace(String(activeId));
          if (ws) {
            active = { id: String(ws.id), name: ws.name, folderPath: ws.folder_path };
          }
        }
        // Fallback: if allowedPaths are not initialized yet but we have an active workspace, include it
        if (allowedPaths.length === 0 && ws?.folder_path) {
          allowedPaths.push(ws.folder_path);
        }
        return res.json(ok({ status: 'running', activeWorkspace: active, securityContext: { allowedPaths } }));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Workspaces
    this.app.get('/api/v1/workspaces', async (_req, res) => {
      try {
        const rows = await this.db.listWorkspaces();
        const data = rows.map(mapWorkspaceDbToJson);
        return res.json(ok(data));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/workspaces', async (req, res) => {
      const parsed = createWorkspaceBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      try {
        const created = await this.db.createWorkspace(
          parsed.data.name,
          parsed.data.folderPath,
          (parsed.data.state ?? {}) as WorkspaceState
        );
        return res.json(ok(mapWorkspaceDbToJson(created)));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.get('/api/v1/workspaces/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        const ws = await this.db.getWorkspace(params.data.id);
        if (!ws) return res.json(ok(null));
        return res.json(ok(mapWorkspaceDbToJson(ws)));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.put('/api/v1/workspaces/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      const body = updateWorkspaceBody.safeParse(req.body);
      if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      try {
        await this.db.updateWorkspaceById(params.data.id, body.data.state as WorkspaceState);
        return res.json(ok(true));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.delete('/api/v1/workspaces/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        await this.db.deleteWorkspaceById(params.data.id);
        return res.json(ok(true));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/workspaces/:id/rename', async (req, res) => {
      const params = idParam.safeParse(req.params);
      const body = renameBody.safeParse(req.body);
      if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      try {
        const ws = await this.db.getWorkspace(params.data.id);
        if (!ws) return res.status(404).json(toApiError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
        await this.db.renameWorkspace(ws.name, body.data.newName);
        return res.json(ok(true));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/workspaces/:id/load', async (req, res) => {
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
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Instructions
    this.app.get('/api/v1/instructions', async (_req, res) => {
      try {
        const rows = await this.db.listInstructions();
        const data = rows.map((i: any) => ({
          id: i.id,
          name: i.name,
          content: i.content,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        }));
        return res.json(ok(data));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/instructions', async (req, res) => {
      const body = instructionBody.safeParse(req.body);
      if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      const id = body.data.id ?? randomUUID();
      try {
        await this.db.createInstruction(id, body.data.name, body.data.content);
        return res.json(ok({ id, name: body.data.name, content: body.data.content }));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.put('/api/v1/instructions/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      const body = z.object({ name: z.string().min(1).max(255), content: z.string() }).safeParse(req.body);
      if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      try {
        await this.db.updateInstruction(params.data.id, body.data.name, body.data.content);
        return res.json(ok(true));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.delete('/api/v1/instructions/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        await this.db.deleteInstruction(params.data.id);
        return res.json(ok(true));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Preferences
    this.app.get('/api/v1/prefs/:key', async (req, res) => {
      const params = keyParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid key'));
      try {
        const value = await this.db.getPreference(params.data.key);
        return res.json(ok(value ?? null));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.put('/api/v1/prefs/:key', async (req, res) => {
      const params = keyParam.safeParse(req.params);
      const body = prefSetBody.safeParse(req.body);
      if (!params.success || !body.success) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      }
      try {
        await this.db.setPreference(params.data.key, (body.data.value ?? null) as PreferenceValue);
        return res.json(ok(true));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Phase 2: Files - info
    this.app.get('/api/v1/files/info', async (req, res) => {
      const q = filePathQuery.safeParse(req.query);
      if (!q.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid query'));
      const allowed = getAllowedWorkspacePaths();
      if (!allowed || allowed.length === 0) {
        return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
      }
      const val = validateAndResolvePath(String(q.data.path));
      if (!val.ok) {
        if (val.code === 'NO_ACTIVE_WORKSPACE') {
          return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', val.message));
        }
        if (val.code === 'PATH_DENIED') {
          return res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
        }
        return res.status(400).json(toApiError('VALIDATION_ERROR', val.message));
      }
      const s = await fileServiceStatFile(val.absolutePath);
      if (!s.ok) {
        if (s.code === 'FILE_NOT_FOUND') {
          return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
        }
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', s.message));
      }
      return res.json(ok(s.data));
    });

    // Phase 2: Files - content
    this.app.get('/api/v1/files/content', async (req, res) => {
      const q = filePathQuery.safeParse(req.query);
      if (!q.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid query'));
      const allowed = getAllowedWorkspacePaths();
      if (!allowed || allowed.length === 0) {
        return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
      }
      const val = validateAndResolvePath(String(q.data.path));
      if (!val.ok) {
        if (val.code === 'NO_ACTIVE_WORKSPACE') {
          return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', val.message));
        }
        if (val.code === 'PATH_DENIED') {
          return res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
        }
        return res.status(400).json(toApiError('VALIDATION_ERROR', val.message));
      }
      const s = await fileServiceStatFile(val.absolutePath);
      if (!s.ok) {
        if (s.code === 'FILE_NOT_FOUND') {
          return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
        }
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', s.message));
      }
      if (s.data.isDirectory) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Path is a directory'));
      }
      if (s.data.isBinary) {
        return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
      }
      const r = await readTextFile(val.absolutePath);
      if (!r.ok) {
        if (r.code === 'FILE_NOT_FOUND') {
          return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
        }
        if (r.code === 'BINARY_FILE') {
          return res.status(409).json(toApiError('BINARY_FILE', r.message));
        }
        if (r.code === 'VALIDATION_ERROR') {
          return res.status(400).json(toApiError('VALIDATION_ERROR', r.message));
        }
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', r.message));
      }
      if (r.isLikelyBinary) {
        return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
      }
      const tokenService = getMainTokenService();
      const { count } = await tokenService.countTokens(r.content);
      return res.json(ok({ content: r.content, tokenCount: count, fileType: s.data.fileType || 'plaintext' }));
    });

    // Phase 2: Tokens - count
    this.app.post('/api/v1/tokens/count', async (req, res) => {
      const body = tokensCountBody.safeParse(req.body);
      if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      try {
        const tokenService = getMainTokenService();
        const result = await tokenService.countTokens(body.data.text);
        return res.json(ok(result));
      } catch (e) {
        return res.status(500).json(toApiError('INTERNAL_ERROR', (e as Error).message));
      }
    });

    // Phase 2: Tokens - backend
    this.app.get('/api/v1/tokens/backend', async (_req, res) => {
      try {
        const tokenService = getMainTokenService();
        const backend = await tokenService.getActiveBackend();
        return res.json(ok({ backend: backend ?? 'estimate' }));
      } catch (e) {
        return res.status(500).json(toApiError('INTERNAL_ERROR', (e as Error).message));
      }
    });

    // Phase 2: Folders - current
    this.app.get('/api/v1/folders/current', async (_req, res) => {
      try {
        const activeId = await this.db.getPreference('workspace.active');
        if (!activeId) return res.json(ok(null));
        const ws = await this.db.getWorkspace(String(activeId));
        if (!ws) return res.json(ok(null));
        return res.json(ok({ folderPath: ws.folder_path }));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Phase 2: Folders - open
    this.app.post('/api/v1/folders/open', async (req, res) => {
      const body = foldersOpenBody.safeParse(req.body);
      if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      try {
        const folderPath = String(body.data.folderPath);
        let st;
        try {
          st = await fs.promises.stat(folderPath);
        } catch {
          return res.status(400).json(toApiError('VALIDATION_ERROR', 'Folder does not exist'));
        }
        if (!st.isDirectory()) {
          return res.status(400).json(toApiError('VALIDATION_ERROR', 'Path is not a directory'));
        }

        const workspaces = await this.db.listWorkspaces();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ws = workspaces.find((w: any) => w.folder_path === folderPath);

        if (!ws) {
          const requestedName = body.data.name ?? (path.basename(folderPath) || `workspace-${randomUUID().slice(0, 8)}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const collision = workspaces.find((w: any) => w.name === requestedName && w.folder_path !== folderPath);
          if (collision && body.data.name) {
            return res.status(409).json(toApiError('VALIDATION_ERROR', `Workspace name '${requestedName}' already exists`));
          }
          const effectiveName = collision && !body.data.name ? `${requestedName}-${randomUUID().slice(0, 6)}` : requestedName;
          ws = await this.db.createWorkspace(effectiveName, folderPath, {} as WorkspaceState);
        }

        await this.db.setPreference('workspace.active', String(ws.id));
        setAllowedWorkspacePaths([ws.folder_path]);
        getPathValidator([ws.folder_path]);

        return res.json(ok({ id: String(ws.id), name: ws.name, folderPath: ws.folder_path }));
      } catch (e) {
        return res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });
  }
}