import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import express, { Express, Request, Response, NextFunction } from 'express';

import { getMainTokenService } from '../services/token-service-main';
import type { FileTreeMode, SystemPrompt, RolePrompt, Instruction } from '../types/file-types';

import { DatabaseBridge } from './db/database-bridge';
import { WorkspaceState } from './db/database-implementation';
import { AuthManager } from './auth-manager';
import { getAllowedWorkspacePaths } from './workspace-context';
import { toApiError, ok } from './error-normalizer';
import { validateAndResolvePath, statFile as fileServiceStatFile, readTextFile } from './file-service';
import { applySelect, applyDeselect, SelectionServiceError } from './selection-service';
import { aggregateSelectedContent, scanAllFilesForTree } from './content-aggregation';
import { writeExport } from './export-writer';
import { RendererPreviewProxy } from './preview-proxy';
import { PreviewController } from './preview-controller';
import { broadcastWorkspaceUpdated } from './broadcast-helper';
import { 
  APIRouteHandlers,
  selectionBody,
  exportBody,
  previewStartBody,
  previewIdParam
} from './api-route-handlers';
import { getNodeRequire } from './node-require';

// Local require compatible with CJS (tests) and ESM (runtime) builds
const nodeRequire = getNodeRequire();

interface AggregationOptions {
  folderPath: string;
  selection: { path: string; lines?: { start: number; end: number }[] }[];
  sortOrder: string;
  fileTreeMode: FileTreeMode;
  selectedFolder: string | null;
  systemPrompts: SystemPrompt[];
  rolePrompts: RolePrompt[];
  selectedInstructions: Instruction[];
  userInstructions: string;
  exclusionPatterns: string[];
  maxFiles?: number;
  maxBytes?: number;
}

export class PasteFlowAPIServer {
  private readonly app: Express;
  private readonly auth = new AuthManager();
  private server: Server | null = null;
  private readonly previewProxy = new RendererPreviewProxy();
  private readonly previewController = new PreviewController(this.previewProxy, { timeoutMs: 120_000 });
  private readonly routeHandlers: APIRouteHandlers;

  constructor(
    private readonly db: DatabaseBridge,
    private readonly port = 5839,
    private readonly options: {
      logger?: Pick<typeof console, 'log' | 'warn' | 'error'>;
    } = {}
  ) {
    this.app = express();
    this.routeHandlers = new APIRouteHandlers(this.db, this.previewProxy, this.previewController, {
      logger: this.options.logger,
    });
    this.setupMiddleware();
    this.registerRoutes();
  }

  private setupMiddleware(): void {
    // Dev-only CORS to allow Vite renderer to call local API on a different port
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      try {
        const isDev = process.env.NODE_ENV === 'development';
        const origin = String(req.headers.origin || '');
        // Allow localhost origins during dev for cross-port requests (e.g., 5173 -> 5839)
        if (isDev && /^http:\/\/localhost:\d+$/.test(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Vary', 'Origin');
          res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
          res.header('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
          res.header('Access-Control-Allow-Credentials', 'true');
          if (req.method === 'OPTIONS') {
            return res.status(204).end();
          }
        }
      } catch { /* noop */ }
      return next();
    });

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
      if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid JSON'));
      }
      if (err instanceof SyntaxError) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid JSON'));
      }
      return next(err as Error);
    });
  }

  private registerRoutes(): void {
    // Health & Status
    this.app.get('/api/v1/health', (req, res) => this.routeHandlers.handleHealth(req, res));
    this.app.get('/api/v1/status', (req, res) => this.routeHandlers.handleStatus(req, res));

    // Workspaces
    this.app.get('/api/v1/workspaces', (req, res) => this.routeHandlers.handleListWorkspaces(req, res));
    this.app.post('/api/v1/workspaces', (req, res) => this.routeHandlers.handleCreateWorkspace(req, res));
    this.app.get('/api/v1/workspaces/:id', (req, res) => this.routeHandlers.handleGetWorkspace(req, res));
    this.app.put('/api/v1/workspaces/:id', (req, res) => this.routeHandlers.handleUpdateWorkspace(req, res));
    this.app.delete('/api/v1/workspaces/:id', (req, res) => this.routeHandlers.handleDeleteWorkspace(req, res));
    this.app.post('/api/v1/workspaces/:id/rename', (req, res) => this.routeHandlers.handleRenameWorkspace(req, res));
    this.app.post('/api/v1/workspaces/:id/load', (req, res) => this.routeHandlers.handleLoadWorkspace(req, res));

    // Instructions
    this.app.get('/api/v1/instructions', (req, res) => this.routeHandlers.handleListInstructions(req, res));
    this.app.post('/api/v1/instructions', (req, res) => this.routeHandlers.handleCreateInstruction(req, res));
    this.app.put('/api/v1/instructions/:id', (req, res) => this.routeHandlers.handleUpdateInstruction(req, res));
    this.app.delete('/api/v1/instructions/:id', (req, res) => this.routeHandlers.handleDeleteInstruction(req, res));

    // Preferences
    this.app.get('/api/v1/prefs/:key', (req, res) => this.routeHandlers.handleGetPreference(req, res));
    this.app.put('/api/v1/prefs/:key', (req, res) => this.routeHandlers.handleSetPreference(req, res));

    // Files
    this.app.get('/api/v1/files/info', (req, res) => this.routeHandlers.handleFileInfo(req, res));
    this.app.get('/api/v1/files/content', (req, res) => this.routeHandlers.handleFileContent(req, res));

    // Tokens
    this.app.post('/api/v1/tokens/count', (req, res) => this.routeHandlers.handleCountTokens(req, res));
    this.app.get('/api/v1/tokens/backend', (req, res) => this.routeHandlers.handleGetTokenBackend(req, res));

    // Folders
    this.app.get('/api/v1/folders/current', (req, res) => this.routeHandlers.handleGetCurrentFolder(req, res));
    this.app.post('/api/v1/folders/open', (req, res) => this.routeHandlers.handleOpenFolder(req, res));

    // Selection
    this.app.post('/api/v1/files/select', (req, res) => this.handleFileSelect(req, res));
    this.app.post('/api/v1/files/deselect', (req, res) => this.handleFileDeselect(req, res));
    this.app.post('/api/v1/files/clear', (req, res) => this.handleFileClear(req, res));
    this.app.get('/api/v1/files/selected', (req, res) => this.handleFileSelected(req, res));

    // Content
    this.app.get('/api/v1/content', (req, res) => this.handleContent(req, res));
    this.app.post('/api/v1/content/export', (req, res) => this.handleContentExport(req, res));

    // Selection tokens breakdown
    this.app.get('/api/v1/selection/tokens', (req, res) => this.handleSelectionTokens(req, res));

    // ASCII file tree
    this.app.get('/api/v1/tree', (req, res) => this.handleFileTree(req, res));

    // Preview
    this.app.post('/api/v1/preview/start', (req, res) => this.handlePreviewStart(req, res));
    this.app.get('/api/v1/preview/status/:id', (req, res) => this.handlePreviewStatus(req, res));
    this.app.get('/api/v1/preview/content/:id', (req, res) => this.handlePreviewContent(req, res));
    this.app.post('/api/v1/preview/cancel/:id', (req, res) => this.handlePreviewCancel(req, res));

    // Logs (dev-only optional)
    this.app.get('/api/v1/logs', (req, res) => this.handleLogs(req, res));

  }

  // File selection handlers
  private async handleFileSelect(req: Request, res: Response) {
    const body = selectionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));

    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const sanitizedItems = await this.validateSelectionItems(body.data.items, res);
      if (!sanitizedItems) return;

      const next = applySelect(validation.state, sanitizedItems);
      const newState: WorkspaceState = { ...validation.state, selectedFiles: next.selectedFiles };
      await this.db.updateWorkspaceById(String(validation.ws.id), newState);

      // Notify renderer processes that the workspace selection changed
      broadcastWorkspaceUpdated({
        workspaceId: String(validation.ws.id),
        folderPath: validation.ws.folder_path,
        selectedFiles: newState.selectedFiles ?? [],
      });

      return res.json(ok(true));
    } catch (error) {
      if (error instanceof SelectionServiceError) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', error.message, { reason: error.code }));
      }
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  private async handleFileDeselect(req: Request, res: Response) {
    const body = selectionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));

    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const sanitizedItems = body.data.items.map(item => ({
        path: validateAndResolvePath(item.path).ok ? (validateAndResolvePath(item.path) as { ok: true; absolutePath: string }).absolutePath : item.path,
        lines: item.lines
      }));

      const next = applyDeselect(validation.state, sanitizedItems);
      const newState: WorkspaceState = { ...validation.state, selectedFiles: next.selectedFiles };
      await this.db.updateWorkspaceById(String(validation.ws.id), newState);

      // Notify renderer processes that the workspace selection changed
      broadcastWorkspaceUpdated({
        workspaceId: String(validation.ws.id),
        folderPath: validation.ws.folder_path,
        selectedFiles: newState.selectedFiles ?? [],
      });

      return res.json(ok(true));
    } catch (error) {
      if (error instanceof SelectionServiceError) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', error.message, { reason: error.code }));
      }
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  private async handleFileClear(_req: Request, res: Response) {
    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const newState: WorkspaceState = { ...validation.state, selectedFiles: [] };
      await this.db.updateWorkspaceById(String(validation.ws.id), newState);

      // Notify renderer processes that the workspace selection changed
      broadcastWorkspaceUpdated({
        workspaceId: String(validation.ws.id),
        folderPath: validation.ws.folder_path,
        selectedFiles: [],
      });

      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  private async handleFileSelected(_req: Request, res: Response) {
    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const selection = (validation.state.selectedFiles ?? []) as { path: string; lines?: { start: number; end: number }[] }[];
      return res.json(ok(selection));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  

  // Content handlers
  private async handleContent(req: Request, res: Response) {
    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const options = this.parseContentOptions(req, validation);
      const { content, fileCount } = await aggregateSelectedContent(options);

      const tokenService = getMainTokenService();
      const { count } = await tokenService.countTokens(content);

      return res.json(ok({ content, fileCount, tokenCount: count }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  private async handleContentExport(req: Request, res: Response) {
    const body = exportBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));

    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const outVal = validateAndResolvePath(body.data.outputPath);
      if (!outVal.ok) {
        return this.handlePathError(outVal, res);
      }

      const options = this.parseContentOptions(req, validation);
      const { content } = await aggregateSelectedContent(options);
      const { bytes } = await writeExport(outVal.absolutePath, content, body.data.overwrite === true);

      return res.json(ok({ outputPath: outVal.absolutePath, bytes }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // ASCII file tree handler
  private async handleFileTree(req: Request, res: Response) {
    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const options = this.parseContentOptions(req, validation);

      const root = options.selectedFolder || options.folderPath;
      const validTreeModes: FileTreeMode[] = ['none', 'selected', 'selected-with-roots', 'complete'];
      const queryMode = String(((req.query as unknown as { mode?: string })?.mode || '')).trim();
      if (queryMode && !validTreeModes.includes(queryMode as FileTreeMode)) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid mode'));
      }
      const mode = (queryMode ? (queryMode as FileTreeMode) : options.fileTreeMode);

      if (mode === 'none') {
        return res.json(ok({ mode, root, tree: '' }));
      }

      // Sanitize selection to absolute paths within workspace
      const pruned: { path: string; lines?: { start: number; end: number }[] }[] = [];
      for (const s of options.selection || []) {
        const v = validateAndResolvePath(s.path);
        if (!v.ok) continue;
        pruned.push({ path: v.absolutePath, lines: s.lines });
      }

      let items: { path: string; isFile?: boolean }[] = [];

      switch (mode) {
        case 'selected': {
          items = pruned.map((s) => ({ path: s.path, isFile: true }));
          break;
        }
        case 'selected-with-roots': {
          const { getAllDirectories } = nodeRequire('../file-ops/path');
          const dirs: string[] = getAllDirectories(pruned, root);
          items = [
            ...dirs.map((directory) => ({ path: directory, isFile: false })),
            ...pruned.map((s) => ({ path: s.path, isFile: true })),
          ];
          break;
        }
        case 'complete': {
          const all = await scanAllFilesForTree(options.folderPath, options.exclusionPatterns);
          items = all.map((p) => ({ path: p, isFile: true }));
          break;
        }
        default: {
          break;
        }
      }

      const { generateAsciiFileTree } = nodeRequire('../file-ops/ascii-tree');
      const tree: string = generateAsciiFileTree(items, root);

      return res.json(ok({ mode, root, tree }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Selection token breakdown handler
  private async handleSelectionTokens(req: Request, res: Response) {
    const validation = await this.validateActiveWorkspace(res);
    if (!validation) return;

    try {
      const options = this.parseContentOptions(req, validation);

      // Parse query flags
      const q = req.query as unknown as {
        includePrompts?: string;
        includeInstructions?: string;
        relativePaths?: string;
        maxFiles?: string;
        maxBytes?: string;
      };
      const includePrompts = q.includePrompts === undefined ? true : String(q.includePrompts) !== 'false';
      const includeInstructions = q.includeInstructions === undefined ? true : String(q.includeInstructions) !== 'false';
      const relativePaths = String(q.relativePaths || '') === 'true';

      // Prune/validate selection to absolute paths within workspace
      const pruned: { path: string; lines?: { start: number; end: number }[] }[] = [];
      for (const s of options.selection || []) {
        const v = validateAndResolvePath(s.path);
        if (!v.ok) continue;
        pruned.push({ path: v.absolutePath, lines: s.lines });
      }

      // Limits
      const maxFiles = options.maxFiles;
      const maxBytes = options.maxBytes;

      const tokenService = getMainTokenService();
      const activeBackend = await tokenService.getActiveBackend();

      // Process files sequentially, respecting limits
      const files: {
        path: string;
        relativePath?: string;
        ranges: { start: number; end: number }[] | null;
        bytes: number;
        tokenCount: number;
        partial: boolean;
        skipped: boolean;
        reason: null | 'binary' | 'not-found' | 'outside-workspace' | 'too-large' | 'file-error' | 'read-error' | 'directory';
      }[] = [];

      let includedFiles = 0;
      let totalBytes = 0;

      for (const s of pruned) {
        if (typeof maxFiles === 'number' && includedFiles >= maxFiles) break;

        // Stat and basic checks
        const st = await fileServiceStatFile(s.path);
        if (!st.ok) {
          const reason = st.code === 'FILE_NOT_FOUND' ? 'not-found' : 'file-error';
          files.push({
            path: s.path,
            relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, s.path) : undefined,
            ranges: s.lines ?? null,
            bytes: 0,
            tokenCount: 0,
            partial: Boolean(s.lines && s.lines.length > 0),
            skipped: true,
            reason,
          });
          continue;
        }
        if (st.data.isDirectory) {
          files.push({
            path: st.data.path,
            relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, st.data.path) : undefined,
            ranges: s.lines ?? null,
            bytes: 0,
            tokenCount: 0,
            partial: Boolean(s.lines && s.lines.length > 0),
            skipped: true,
            reason: 'directory',
          });
          continue;
        }
        if (st.data.isBinary) {
          files.push({
            path: st.data.path,
            relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, st.data.path) : undefined,
            ranges: s.lines ?? null,
            bytes: 0,
            tokenCount: 0,
            partial: Boolean(s.lines && s.lines.length > 0),
            skipped: true,
            reason: 'binary',
          });
          continue;
        }

        const r = await readTextFile(st.data.path);
        if (!r.ok) {
          let reason: 'read-error' | 'binary' | 'file-error' = 'read-error';
          if (r.code === 'BINARY_FILE') reason = 'binary';
          else if (r.code === 'FILE_SYSTEM_ERROR') reason = 'file-error';
          files.push({
            path: st.data.path,
            relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, st.data.path) : undefined,
            ranges: s.lines ?? null,
            bytes: 0,
            tokenCount: 0,
            partial: Boolean(s.lines && s.lines.length > 0),
            skipped: true,
            reason,
          });
          continue;
        }
        if (r.isLikelyBinary) {
          files.push({
            path: st.data.path,
            relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, st.data.path) : undefined,
            ranges: s.lines ?? null,
            bytes: 0,
            tokenCount: 0,
            partial: Boolean(s.lines && s.lines.length > 0),
            skipped: true,
            reason: 'binary',
          });
          continue;
        }

        // Extract selected content if ranges provided
        const selected = { path: st.data.path, lines: s.lines } as { path: string; lines?: { start: number; end: number }[] };
        // Lazy import to avoid circular deps issues
      const { processFileContent } = nodeRequire('../utils/content-formatter');
        const { content, partial } = processFileContent(r.content, {
          path: selected.path,
          lines: selected.lines,
          isFullFile: !selected.lines || selected.lines.length === 0,
        });

        const bytes = Buffer.byteLength(content || '', 'utf8');
        if (typeof maxBytes === 'number' && (totalBytes + bytes) > maxBytes) {
          // Respect overall bytes limit by skipping this and remaining files
          files.push({
            path: st.data.path,
            relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, st.data.path) : undefined,
            ranges: s.lines ?? null,
            bytes: 0,
            tokenCount: 0,
            partial,
            skipped: true,
            reason: 'too-large',
          });
          break;
        }

        const { count } = await tokenService.countTokens(content);
        files.push({
          path: st.data.path,
          relativePath: relativePaths ? this.toRelativePath(validation.ws.folder_path, st.data.path) : undefined,
          ranges: s.lines ?? null,
          bytes,
          tokenCount: count,
          partial,
          skipped: false,
          reason: null,
        });
        includedFiles += 1;
        totalBytes += bytes;
      }

      // Prompts/instructions
      const promptsOut: {
        system: { id: string; name: string; tokenCount: number }[];
        roles: { id: string; name: string; tokenCount: number }[];
        instructions: { id: string; name: string; tokenCount: number }[];
        user: { present: boolean; tokenCount: number };
      } = {
        system: [],
        roles: [],
        instructions: [],
        user: { present: false, tokenCount: 0 },
      };

      if (includePrompts) {
        for (const p of options.systemPrompts || []) {
          const { count } = await tokenService.countTokens(p.content || '');
          promptsOut.system.push({ id: p.id, name: p.name, tokenCount: count });
        }
        for (const p of options.rolePrompts || []) {
          const { count } = await tokenService.countTokens(p.content || '');
          promptsOut.roles.push({ id: p.id, name: p.name, tokenCount: count });
        }
      }
      if (includeInstructions) {
        for (const i of options.selectedInstructions || []) {
          const { count } = await tokenService.countTokens(i.content || '');
          promptsOut.instructions.push({ id: i.id, name: i.name, tokenCount: count });
        }
        const userText = options.userInstructions || '';
        if (userText && userText.trim().length > 0) {
          const { count } = await tokenService.countTokens(userText);
          promptsOut.user = { present: true, tokenCount: count };
        } else {
          promptsOut.user = { present: false, tokenCount: 0 };
        }
      }

      const totalsFiles = files.reduce((acc, f) => acc + (f.skipped ? 0 : f.tokenCount), 0);
      const totalsPrompts =
        (promptsOut.system?.reduce((a, b) => a + b.tokenCount, 0) || 0) +
        (promptsOut.roles?.reduce((a, b) => a + b.tokenCount, 0) || 0) +
        (promptsOut.instructions?.reduce((a, b) => a + b.tokenCount, 0) || 0) +
        (promptsOut.user?.tokenCount || 0);
      const totalsAll = totalsFiles + totalsPrompts;

      return res.json(
        ok({
          backend: activeBackend ?? 'estimate',
          files,
          prompts: promptsOut,
          totals: { files: totalsFiles, prompts: totalsPrompts, all: totalsAll },
        })
      );
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  private toRelativePath(root: string, p: string): string {
    try {
      const path = nodeRequire('node:path');
      return path.relative(root, p) || p;
    } catch {
      return p;
    }
  }

  // Preview handlers
  private async handlePreviewStart(req: Request, res: Response) {
    const body = previewStartBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));

    const allowed = getAllowedWorkspacePaths();
    if (!allowed || allowed.length === 0) {
      return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
    }

    try {
      const id = randomUUID();
      this.previewController.startPreview(id, {
        includeTrees: body.data.includeTrees,
        maxFiles: body.data.maxFiles,
        maxBytes: body.data.maxBytes,
        prompt: body.data.prompt,
      });
      
      // Optional: record a log entry (best-effort)
      const dbWithLogs = this.db as DatabaseBridge & { insertLog?: (log: unknown) => Promise<void> };
      if (dbWithLogs.insertLog) {
        try { 
          await dbWithLogs.insertLog({ category: 'preview', action: 'start', status: 'queued', details: { id } }); 
        } catch {
          // Ignore logging errors
        }
      }
      
      return res.json(ok({ id }));
    } catch (error) {
      return res.status(500).json(toApiError('INTERNAL_ERROR', (error as Error).message));
    }
  }

  private async handlePreviewStatus(req: Request, res: Response) {
    const params = previewIdParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));

    const st = this.previewController.getStatus(params.data.id);
    if (!st) {
      return res.status(404).json(toApiError('PREVIEW_NOT_FOUND', 'Preview job not found'));
    }
    
    const status = st as { state: string; error?: { code: string } };
    if (status.state === 'FAILED' && status.error?.code === 'PREVIEW_TIMEOUT') {
      return res.status(504).json(toApiError('PREVIEW_TIMEOUT', 'Preview job timed out'));
    }
    
    return res.json(ok(st));
  }

  private async handlePreviewContent(req: Request, res: Response) {
    const params = previewIdParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));

    const result = this.previewController.getResult(params.data.id);
    if (!result) return res.status(404).json(toApiError('PREVIEW_NOT_FOUND', 'Preview job not found'));
    return res.json(ok(result));
  }

  private async handlePreviewCancel(req: Request, res: Response) {
    const params = previewIdParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));

    this.previewController.cancel(params.data.id);
    
    // Optional: record a log entry (best-effort)
    const dbWithLogs = this.db as DatabaseBridge & { insertLog?: (log: unknown) => Promise<void> };
    if (dbWithLogs.insertLog) {
      try { 
        await dbWithLogs.insertLog({ category: 'preview', action: 'cancel', status: 'requested', details: { id: params.data.id } }); 
      } catch {
        // Ignore logging errors
      }
    }
    
    return res.json(ok(true));
  }

  private async handleLogs(req: Request, res: Response) {
    try {
      const query = req.query as { limit?: string; category?: 'api' | 'preview' };
      const limit = Number.parseInt(query.limit ?? '100', 10);
      const category = query.category;
      
      const dbWithLogs = this.db as DatabaseBridge & { listLogs?: (opts: { limit: number; category?: 'api' | 'preview' }) => Promise<unknown[]> };
      const entries = dbWithLogs.listLogs ? await dbWithLogs.listLogs({ limit: Number.isFinite(limit) ? limit : 100, category }) : [];
      
      return res.json(ok(entries));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Helper methods
  private async validateActiveWorkspace(res: Response) {
    const allowed = getAllowedWorkspacePaths();
    if (!allowed || allowed.length === 0) {
      res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
      return null;
    }

    try {
      const activeId = await this.db.getPreference('workspace.active');
      if (!activeId) {
        res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
        return null;
      }

      const ws = await this.db.getWorkspace(String(activeId));
      if (!ws) {
        res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
        return null;
      }

      return { ws, state: (ws.state || {}) as WorkspaceState };
    } catch (error) {
      res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
      return null;
    }
  }

  private async validateSelectionItems(items: { path: string; lines?: { start: number; end: number }[] }[], res: Response) {
    const sanitizedItems: { path: string; lines?: { start: number; end: number }[] }[] = [];
    
    for (const item of items) {
      const validated = validateAndResolvePath(item.path);
      if (!validated.ok) {
        this.handlePathError(validated, res);
        return null;
      }

      const st = await fileServiceStatFile(validated.absolutePath);
      if (!st.ok) {
        if (st.code === 'FILE_NOT_FOUND') {
          res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
        } else if (st.code === 'FILE_SYSTEM_ERROR') {
          res.status(500).json(toApiError('FILE_SYSTEM_ERROR', st.message));
        } else {
          res.status(500).json(toApiError('DB_OPERATION_FAILED', st.message));
        }
        return null;
      }

      if (st.data.isDirectory) {
        res.status(400).json(toApiError('VALIDATION_ERROR', 'Path is a directory'));
        return null;
      }

      sanitizedItems.push({ path: validated.absolutePath, lines: item.lines });
    }

    return sanitizedItems;
  }

  private handlePathError(result: { ok: false; code: string; message: string }, res: Response) {
    if (result.code === 'PATH_DENIED') {
      return res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
    }
    if (result.code === 'NO_ACTIVE_WORKSPACE') {
      return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
    }
    return res.status(400).json(toApiError('VALIDATION_ERROR', result.message || 'Invalid path'));
  }

  private parseContentOptions(req: Request, validation: { ws: { folder_path: string }; state: WorkspaceState }): AggregationOptions {
    const query = req.query as { maxFiles?: string; maxBytes?: string };
    const maxFilesQ = Number.parseInt(query.maxFiles ?? '', 10);
    const maxBytesQ = Number.parseInt(query.maxBytes ?? '', 10);
    const maxFiles = Number.isFinite(maxFilesQ) && maxFilesQ > 0 ? Math.min(maxFilesQ, 10_000) : undefined;
    const maxBytes = Number.isFinite(maxBytesQ) && maxBytesQ > 0 ? Math.min(maxBytesQ, 50 * 1024 * 1024) : undefined;

    const state = validation.state as WorkspaceState & {
      sortOrder?: string;
      fileTreeMode?: string;
      selectedFolder?: string;
      systemPrompts?: string[];
      rolePrompts?: string[];
      selectedInstructions?: string[];
      userInstructions?: string;
      exclusionPatterns?: string[];
    };

    const selection = (state.selectedFiles ?? []) as { path: string; lines?: { start: number; end: number }[] }[];

    // Ensure fileTreeMode is a valid FileTreeMode value
    const validTreeModes: FileTreeMode[] = ['none', 'selected', 'selected-with-roots', 'complete'];
    const fileTreeMode = validTreeModes.includes(state.fileTreeMode as FileTreeMode) 
      ? (state.fileTreeMode as FileTreeMode)
      : 'selected' as FileTreeMode;

    // Convert string arrays to prompt objects (these are likely IDs or content stored in the workspace)
    // For now, we'll convert them to basic prompt objects
    // In a real implementation, these would be looked up from a prompts database
    const systemPrompts: SystemPrompt[] = (state.systemPrompts ?? []).map((promptStr, index) => ({
      id: `system-${index}`,
      name: `System Prompt ${index + 1}`,
      content: String(promptStr), // The string is the actual content
      tokenCount: undefined
    }));

    const rolePrompts: RolePrompt[] = (state.rolePrompts ?? []).map((promptStr, index) => ({
      id: `role-${index}`,
      name: `Role Prompt ${index + 1}`,
      content: String(promptStr), // The string is the actual content
      tokenCount: undefined
    }));

    const selectedInstructions: Instruction[] = (state.selectedInstructions ?? []).map((instructionStr, index) => ({
      id: `instruction-${index}`,
      name: `Instruction ${index + 1}`,
      content: String(instructionStr), // The string is the actual content
      tokenCount: undefined
    }));

    return {
      folderPath: validation.ws.folder_path,
      selection,
      sortOrder: state.sortOrder ?? 'name',
      fileTreeMode,
      selectedFolder: state.selectedFolder ?? null,
      systemPrompts,
      rolePrompts,
      selectedInstructions,
      userInstructions: state.userInstructions ?? '',
      exclusionPatterns: state.exclusionPatterns ?? [],
      maxFiles,
      maxBytes,
    };
  }

  // Server lifecycle methods
  start(): void {
    void this.startAsync();
  }

  async startAsync(): Promise<void> {
    if (this.server) return;
    const host = '127.0.0.1';
    const tryPorts = this.port === 0 ? [0] : Array.from({ length: 21 }, (_, i) => this.port + i);
    
    for (const p of tryPorts) {
      try {
        await new Promise<void>((resolve, reject) => {
          const srv = this.app.listen(p, host, () => {
            this.server = srv as Server;
            resolve();
          });
          
          const onError = (err: NodeJS.ErrnoException) => {
            if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
              try { srv.close(); } catch {
                // Ignore close errors
              }
              reject(err);
            } else {
              reject(err);
            }
          };
          srv.on('error', onError);
        });
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
}
