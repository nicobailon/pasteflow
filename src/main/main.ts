import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import type { ParsedWorkspace, PreferenceValue } from './db/database-implementation';
import type { InstructionRow } from './db/types';

import { loadGitignore } from '../utils/ignore-utils';
import { FILE_PROCESSING, ELECTRON, TOKEN_COUNTING } from '../constants';
import { binaryExtensions } from '../shared/excluded-files';
import { getPathValidator } from '../security/path-validator';
import { shouldExcludeByDefault as shouldExcludeByDefaultFromFileOps, BINARY_EXTENSIONS as BINARY_EXTENSIONS_FROM_FILE_OPS, isLikelyBinaryContent as isLikelyBinaryContentFromFileOps } from '../file-ops/filters';
import { getMainTokenService } from '../services/token-service-main';

import * as zSchemas from './ipc/schemas';
import { DatabaseBridge } from './db/database-bridge';
import { PasteFlowAPIServer } from './api-server';
import { setAllowedWorkspacePaths } from './workspace-context';
import type { ContextResult } from './agent/tool-types';
process.env.ZOD_DISABLE_DOC = process.env.ZOD_DISABLE_DOC || '1';

// ABI/runtime diagnostics (helps verify native module compatibility)
try {
   
  console.log('Runtime versions', {
    electron: process.versions.electron,
    node: process.versions.node,
    v8: process.versions.v8,
    modules: process.versions.modules
  });
} catch {
  // Intentionally empty - diagnostic logging
}

/** State */
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Cancellation and request tracking for file loading flow
let fileLoadingCancelled = false;
let currentRequestId: string | null = null;

// Track current workspace paths for path-validator
let currentWorkspacePaths: string[] = [];

// Database instance (initialized in whenReady)
let database: DatabaseBridge | null = null;
// HTTP API server instance
let apiServer: PasteFlowAPIServer | null = null;

// Initialize token service
const tokenService = getMainTokenService();

/** Special files specific to main process */
const SPECIAL_FILE_EXTENSIONS = new Set<string>(['.asar', '.bin', '.dll', '.exe', '.so', '.dylib']);

// Create a combined set of binary extensions including both file-ops and legacy extensions
const BINARY_EXTENSIONS = new Set<string>([
  ...BINARY_EXTENSIONS_FROM_FILE_OPS,
  '.lockb', // Additional extension specific to main process
  ...binaryExtensions // Legacy extensions from shared/excluded-files
]);

/** Use shared binary content detection */
const isLikelyBinaryContent = isLikelyBinaryContentFromFileOps;

function isSpecialFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SPECIAL_FILE_EXTENSIONS.has(ext);
}

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext) || isSpecialFile(filePath);
}

async function countTokens(text: string): Promise<number> {
  try {
    const result = await tokenService.countTokens(text);
    return result.count;
  } catch (error) {
    console.error('Token counting failed:', error);
    // Fallback to simple estimation
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }
}

/** Types for file scanning pipeline */
type SerializableFile = {
  name: string;
  path: string;
  tokenCount: number;
  size: number;
  content: string;
  mtimeMs: number;
  isBinary: boolean;
  isSkipped: boolean;
  isDirectory: boolean;
  error: string | null;
  fileType: string | null;
  excludedByDefault?: boolean;
  isContentLoaded: boolean;
};


// Use exclusion logic from file-ops
const shouldExcludeByDefault = shouldExcludeByDefaultFromFileOps;

function processFile(
  dirent: fs.Dirent,
  fullPath: string,
  folderPath: string,
  fileSize: number,
  mtimeMs: number
): SerializableFile {
  // Size guard
  if (fileSize > FILE_PROCESSING.MAX_FILE_SIZE_BYTES) {
    return {
      name: dirent.name,
      path: fullPath,
      tokenCount: 0,
      size: fileSize,
      content: '',
      mtimeMs,
      isBinary: false,
      isSkipped: true,
      error: 'File too large to process',
      isDirectory: false,
      isContentLoaded: false,
      fileType: path.extname(fullPath).slice(1).toUpperCase() || 'TEXT'
    };
  }

  // Special types to skip entirely
  if (isSpecialFile(fullPath)) {
    return {
      name: dirent.name,
      path: fullPath,
      tokenCount: 0,
      size: fileSize,
      content: '',
      mtimeMs,
      isBinary: true,
      isSkipped: true,
      fileType: path.extname(fullPath).slice(1).toUpperCase(),
      error: 'Special file type skipped',
      isDirectory: false,
      isContentLoaded: false
    };
  }

  const binary = isBinaryFile(fullPath);

  return {
    name: dirent.name,
    path: fullPath,
    tokenCount: 0,
    size: fileSize,
    content: '',
    mtimeMs,
    isBinary: binary,
    isSkipped: false,
    fileType: path.extname(fullPath).slice(1).toUpperCase() || 'TEXT',
    excludedByDefault: shouldExcludeByDefault(fullPath, folderPath),
    isDirectory: false,
    isContentLoaded: false,
    error: null
  };
}

/** BrowserWindow + CSP */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: ELECTRON.WINDOW.WIDTH,
    height: ELECTRON.WINDOW.HEIGHT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Load preload built alongside main (CJS)
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self';" +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: http://localhost:*;" +
        "worker-src 'self' blob:;" +
        "connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*;" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' data: blob:;" +
        "font-src 'self' data:;"
      : "default-src 'self';" +
        "script-src 'self' 'wasm-unsafe-eval' blob:;" +
        "worker-src 'self' blob:;" +
        "connect-src 'self' http://localhost:* http://127.0.0.1:*;" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' data: blob:;" +
        "font-src 'self' data:;";

    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  if (isDev) {
    const startUrl = process.env.ELECTRON_START_URL || ELECTRON.DEV_SERVER.URL;
    setTimeout(() => {
      mainWindow?.webContents.session.clearCache().then(() => {
        mainWindow?.loadURL(startUrl);
        if (mainWindow && !mainWindow.webContents.isDevToolsOpened()) {
          const DEVTOOLS_MODES = ['right', 'bottom', 'undocked', 'detach'] as const;
          type DevtoolsMode = (typeof DEVTOOLS_MODES)[number];
          const asDevtoolsMode = (v: string): DevtoolsMode | undefined =>
            (DEVTOOLS_MODES as readonly string[]).includes(v) ? (v as DevtoolsMode) : undefined;
          const mode = asDevtoolsMode(ELECTRON.WINDOW.DEVTOOLS_MODE);
          mainWindow.webContents.openDevTools(mode ? { mode } : undefined);
        }
      });
    }, ELECTRON.WINDOW.DEV_RELOAD_DELAY_MS);
  } else {
    const indexPath = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
    const indexUrl = `file://${indexPath}`;
    mainWindow.loadURL(indexUrl);
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
     
    console.error(`Failed to load the application: ${errorDescription} (${errorCode})`);
     
    console.error(`Attempted to load URL: ${validatedURL}`);

    const isDev2 = process.env.NODE_ENV === 'development';
    if (isDev2) {
      const retryUrl = process.env.ELECTRON_START_URL || ELECTRON.DEV_SERVER.URL;
      mainWindow?.webContents.session.clearCache().then(() => {
        setTimeout(() => mainWindow?.loadURL(retryUrl), 1000);
      });
    } else {
      const indexPath = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
      const indexUrl = `file://${indexPath}`;
      mainWindow?.loadURL(indexUrl);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Lifecycle */
// eslint-disable-next-line unicorn/prefer-top-level-await
app.whenReady().then(async () => {
  // Initialize database bridge (fail-fast on error)
  try {
    database = new DatabaseBridge();
    await database.initialize();
     
    console.log('Database initialized successfully');

    // On fresh app start, clear any previously persisted "active" workspace so
    // CLI status reflects the UI (no folder loaded) until the user explicitly
    // opens a folder or loads a workspace.
    try {
      await database.setPreference('workspace.active', null as unknown as PreferenceValue);
      setAllowedWorkspacePaths([]);
      getPathValidator([]);
    } catch (error) {
      console.warn('Failed to clear active workspace on startup:', error);
    }
  } catch (error: unknown) {
     
    console.error('Failed to initialize database:', error);
    app.exit(1);
    return;
  }

  // Start local HTTP API server
  try {
    apiServer = new PasteFlowAPIServer(database!, 5839);
    // Await actual bind to ensure we write the real bound port
    await apiServer.startAsync();

    // Write server port for CLI discovery
    const boundPort = apiServer.getPort();
    const configDir = path.join(os.homedir(), '.pasteflow');
    try { fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); } catch {
      // Intentionally empty - directory may already exist
    }
    const portFile = path.join(configDir, 'server.port');
    // Write with 0644 per plan so CLI tools can read it
    try {
      fs.writeFileSync(portFile, String(boundPort) + '\n', { mode: 0o644 });
      // Ensure correct permissions even if file already existed
      try { fs.chmodSync(portFile, 0o644); } catch {
        // Intentionally empty - best effort chmod
      }
    } catch (error) {
       
      console.warn('Failed to write server.port:', error);
    }
  } catch (error: unknown) {
     
    console.error('Failed to start API server:', error);
    // Proceed to launch UI; CLI integration will be unavailable
  }

  createWindow();

  // Schedule telemetry pruning (on start and weekly)
  try {
    const retentionDays = Number(process.env.PF_AGENT_TELEMETRY_RETENTION_DAYS ?? 90);
    const cutoff = () => Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const prune = async () => {
      try {
        await database!.pruneToolExecutions(cutoff());
      } catch { /* ignore */ }
      try {
        await database!.pruneUsageSummary(cutoff());
      } catch { /* ignore */ }
    };
    void prune();
    setInterval(prune, 7 * 24 * 60 * 60 * 1000);
  } catch { /* ignore scheduling errors */ }

  // After the window is created, inject API info for the renderer (auth token + base URL)
  try {
    const port = apiServer?.getPort() ?? 5839;
    const token = apiServer?.getAuthToken() ?? '';
    const inject = async () => {
      try {
        // Resolve agent config (env + preferences) — feature flags injection removed
        const { resolveAgentConfig } = await import('./agent/config');
        await resolveAgentConfig(database ? { getPreference: (k: string) => database!.getPreference(k) } : undefined);
        const payload = {
          apiBase: `http://localhost:${port}`,
          authToken: token,
        };
        // Attach to a well-known global for the renderer (read by AgentPanel)
        mainWindow?.webContents.executeJavaScript(
          `window.__PF_API_INFO = ${JSON.stringify(payload)};`,
          true
        ).catch(() => {/* ignore */});
      } catch {
        // ignore
      }
    };
    // Attempt immediate injection and also on dom-ready for robustness
    void inject();
    mainWindow?.webContents.on('dom-ready', () => { void inject(); });
  } catch {
    // ignore injection errors
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const savePromise = new Promise<'completed' | 'timeout'>((resolve) => {
        ipcMain.once('app-will-quit-save-complete', () => resolve('completed'));
        const timeout = Number(process.env.PASTEFLOW_SAVE_TIMEOUT ?? 2000);
        setTimeout(() => resolve('timeout'), timeout);
      });
      mainWindow.webContents.send('app-will-quit');
      const result = await savePromise;
      if (result === 'timeout') {
         
        console.warn('Auto-save timeout during shutdown - proceeding with quit');
      }
    } catch (error: unknown) {
       
      console.error('Error during shutdown save:', error);
    }
  }

  // Clean up token service
  try {
    await tokenService.cleanup();
  } catch (error) {
    console.warn('Error cleaning up token service:', error);
  }

  // Close API server
  if (apiServer) {
    try {
      apiServer.close();
       
      console.log('API server closed');
    } catch (error) {
       
      console.error('Error closing API server:', error);
    } finally {
      apiServer = null;
    }
  }
  
  // Clear active workspace preference and allowed paths on shutdown
  try {
    if (database?.initialized) {
      await database.setPreference('workspace.active', null);
    }
  } catch (error) {
    console.warn('Failed to clear active workspace on shutdown:', error);
  }
  try {
    setAllowedWorkspacePaths([]);
    getPathValidator([]);
  } catch {
    // best-effort
  }

  // Best-effort close database
  if (database?.initialized) {
    try {
      await database.close();
       
      console.log('Database closed successfully');
    } catch (error: unknown) {
       
      console.error('Error closing database:', error);
    }
  }

  app.exit(0);
});

/** Utility: broadcast to all renderers */
function broadcastUpdate(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    try { win.webContents.send(channel, data as never); } catch {
      // Intentionally empty - window may be destroyed
    }
  }
}

/** IPC: Open folder selection (event-based) */
ipcMain.on('open-folder', async (event) => {
  try {
    zSchemas.FolderSelectionSchema.parse({});
  } catch (error: unknown) {
     
    console.warn('Validation error for open-folder:', (error as Error)?.message);
  }

  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths?.length) {
    const selectedPath = String(result.filePaths[0]);
    try {
      // Update in-memory validator and HTTP API allowed paths
      currentWorkspacePaths = [selectedPath];
      setAllowedWorkspacePaths(currentWorkspacePaths);
      getPathValidator(currentWorkspacePaths); // Initialize validator

      // Persist active workspace selection for API/CLI consumers
      try {
        if (database?.initialized) {
          const workspaces = await database.listWorkspaces();
          let ws: ParsedWorkspace | undefined = workspaces.find((w: ParsedWorkspace) => w.folder_path === selectedPath);
          if (!ws) {
            // Create a workspace for this folder; avoid name collisions
            const baseName = path.basename(selectedPath) || 'workspace';
            const collision = workspaces.find((w: ParsedWorkspace) => w.name === baseName && w.folder_path !== selectedPath);
            const name = collision ? `${baseName}-${Math.random().toString(36).slice(2, 8)}` : baseName;
            ws = await database.createWorkspace(name, selectedPath, {});
          }
          await database.setPreference('workspace.active', String(ws.id));
        }
      } catch (persistError) {
         
        console.warn('Failed to persist active workspace for selected folder:', persistError);
      }
      event.sender.send('folder-selected', selectedPath);
    } catch (error) {
       
      console.error('Error sending folder-selected event:', error);
    }
  }
});

/** IPC: File list request (event-based streaming) */
ipcMain.on(
  'request-file-list',
  async (event, folderPath: string, exclusionPatterns: string[] = [], requestId: string | null = null) => {
    // Validate inputs
    try {
      zSchemas.FileListRequestSchema.parse({ folderPath, exclusionPatterns, requestId });
    } catch (error: unknown) {
      const message = (error as Error)?.message || 'Invalid parameters';
      event.sender.send('file-processing-status', { status: 'error', message });
      return;
    }

    currentRequestId = requestId;
    try {
      // Update workspace paths for path validator
      currentWorkspacePaths = [folderPath];
      setAllowedWorkspacePaths(currentWorkspacePaths);
      getPathValidator(currentWorkspacePaths);

      fileLoadingCancelled = false;

      event.sender.send('file-processing-status', {
        status: 'processing',
        message: 'Scanning directory structure...'
      });

      const allFiles: SerializableFile[] = [];
      const directoryQueue: { path: string; depth: number }[] = [{ path: folderPath, depth: 0 }];
      const processedDirs = new Set<string>();
      const ignoreFilter = loadGitignore(folderPath, exclusionPatterns);
      let processingComplete = false;

      const sendBatch = (files: SerializableFile[], isComplete = false) => {
        const serializableFiles = files.map((file) => ({
          name: file.name || '',
          path: file.path || '',
          tokenCount: file.tokenCount || 0,
          size: file.size ?? 0,
          content: '',
          mtimeMs: file.mtimeMs,
          isBinary: Boolean(file.isBinary),
          isSkipped: Boolean(file.isSkipped),
          isDirectory: Boolean(file.isDirectory),
          error: file.error || null,
          fileType: file.fileType || null,
          excludedByDefault: file.excludedByDefault || false,
          isContentLoaded: false
        }));

        event.sender.send('file-list-data', {
          files: serializableFiles,
          isComplete,
          processed: allFiles.length,
          directories: processedDirs.size,
          requestId: currentRequestId
        });
      };

      const processNextBatch = async () => {
        if (fileLoadingCancelled) {
          event.sender.send('file-processing-status', {
            status: 'idle',
            message: 'File loading cancelled'
          });
          return;
        }

        let processedDirsCount = 0;
        const MAX_DIRS_PER_BATCH = 20;
        const currentBatchFiles: SerializableFile[] = [];

        const batcher = {
          TARGET_BATCH_SIZE: 200 * 1024,
          MIN_FILES: 50,
          MAX_FILES: 500,
          calculateBatchSize(files: SerializableFile[]) {
            if (files.length === 0) return this.MIN_FILES;
            const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
            const avgFileSize = totalSize / files.length || 1024;
            const optimalCount = Math.floor(this.TARGET_BATCH_SIZE / avgFileSize);
            return Math.max(this.MIN_FILES, Math.min(this.MAX_FILES, optimalCount));
          }
        };

        let dynamicBatchSize = batcher.calculateBatchSize(currentBatchFiles);

        while (directoryQueue.length > 0 && processedDirsCount < MAX_DIRS_PER_BATCH) {
          // BFS-ish traversal
          directoryQueue.sort((a, b) => a.depth - b.depth);
          const next = directoryQueue.shift();
          if (!next) break;
          const { path: dirPath, depth } = next;

          if (processedDirs.has(dirPath) || depth > 20) continue;

          processedDirs.add(dirPath);
          processedDirsCount++;

          try {
            const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });

            const filePromises: Promise<void>[] = [];
            for (const dirent of dirents) {
              const fullPath = path.join(dirPath, dirent.name);
              const relativePath = path.relative(folderPath, fullPath);

              if (ignoreFilter.ignores(relativePath)) continue;

              if (dirent.isDirectory()) {
                directoryQueue.push({ path: fullPath, depth: depth + 1 });
              } else if (dirent.isFile()) {
                filePromises.push(
                  fs.promises
                    .stat(fullPath)
                    .then((stats) => {
                      const fi = processFile(dirent, fullPath, folderPath, stats.size, stats.mtimeMs);
                      currentBatchFiles.push(fi);
                      allFiles.push(fi);
                    })
                    .catch((error: unknown) => {
                       
                      console.error(`Error processing file ${fullPath}:`, error);
                    })
                );

                if (filePromises.length >= 10) {
                  await Promise.all(filePromises);
                  filePromises.length = 0;
                }
              }
            }

            if (filePromises.length > 0) {
              await Promise.all(filePromises);
            }
          } catch (error: unknown) {
             
            console.error(`Error reading directory ${dirPath}:`, error);
          }

          dynamicBatchSize = batcher.calculateBatchSize(currentBatchFiles);
          if (currentBatchFiles.length >= dynamicBatchSize) {
            sendBatch(currentBatchFiles, false);
            currentBatchFiles.length = 0;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }

        if (currentBatchFiles.length > 0) {
          sendBatch(currentBatchFiles, false);
        }

        event.sender.send('file-processing-status', {
          status: 'processing',
          message: `Found ${allFiles.length} files... (${processedDirs.size} directories)`,
          processed: allFiles.length,
          directories: processedDirs.size
        });

        if (directoryQueue.length === 0 && !processingComplete) {
          finishProcessing();
        } else if (directoryQueue.length > 0) {
          setTimeout(processNextBatch, 0);
        }
      };

      const finishProcessing = () => {
        if (fileLoadingCancelled || processingComplete) return;
        processingComplete = true;

        event.sender.send('file-processing-status', {
          status: 'complete',
          message: `Found ${allFiles.length} files`
        });

        sendBatch([], true);
      };

      // Start
      processNextBatch();
    } catch (error: unknown) {
       
      console.error('Error reading directory:', error);
      event.sender.send('file-processing-status', {
        status: 'error',
        message: `Error reading directory: ${(error as Error)?.message || error}`
      });
    }
  }
);

/** IPC: Cancel file loading */
ipcMain.on('cancel-file-loading', (_event, requestId: string | null = null) => {
  try {
    if (requestId !== null) {
      zSchemas.CancelFileLoadingSchema.parse({ requestId });
    }
    fileLoadingCancelled = true;
    currentRequestId = null;
  } catch (error: unknown) {
     
    console.error('Invalid input for cancel-file-loading:', (error as Error)?.message);
  }
});

/** IPC: Open local docs safely */
ipcMain.on('open-docs', (event, docName?: string) => {
  try {
    zSchemas.OpenDocsSchema.parse({ docName });
  } catch (error: unknown) {
     
    console.warn('Invalid input for open-docs:', (error as Error)?.message);
    return;
  }

  const sanitizedDocName = path.basename(docName || '');
  const docPath = path.join(__dirname, 'docs', sanitizedDocName);
  const resolvedDocPath = path.resolve(docPath);
  const docsDir = path.resolve(__dirname, 'docs');
  if (!resolvedDocPath.startsWith(docsDir + path.sep)) {
     
    console.warn(`Attempted access outside docs directory: ${docName}`);
    return;
  }

  fs.access(resolvedDocPath, fs.constants.F_OK, (err) => {
    if (err) {
       
      console.error(`Documentation file not found: ${resolvedDocPath}`);
      return;
    }
    shell.openPath(resolvedDocPath).then((result) => {
      if (result) {
         
        console.error(`Error opening documentation: ${result}`);
      }
    });
  });
});

/** IPC: Lazy file content load (envelope) */
ipcMain.handle('request-file-content', async (_event, filePath: string) => {
  try {
    zSchemas.RequestFileContentSchema.parse({ filePath });
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || 'Invalid parameters' };
  }

  if (!currentWorkspacePaths?.length) {
    return { success: false, error: 'No workspace selected', reason: 'NO_WORKSPACE' };
  }

  const validator = getPathValidator(currentWorkspacePaths);
  const validation = validator.validatePath(filePath);
  if (!validation.valid) {
    return { success: false, error: 'Access denied', reason: validation.reason };
  }

  if (isBinaryFile(filePath) || isSpecialFile(filePath)) {
    return { success: false, error: 'File contains binary data', isBinary: true };
  }

  try {
    const content = await fs.promises.readFile(validation.sanitizedPath!, 'utf8');
    if (isLikelyBinaryContent(content, filePath)) {
      return { success: false, error: 'File contains binary data', isBinary: true };
    }
    const tokenCount = await countTokens(content);
    return { success: true, data: { content, tokenCount } };
  } catch (error: unknown) {
    const extIsBinary = isBinaryFile(filePath) || isSpecialFile(filePath);
    return { success: false, error: (error as Error)?.message || String(error), isBinary: extIsBinary };
  }
});

/** Workspace management (envelope) */
function mapWorkspaceDbToIpc(w: ParsedWorkspace) {
  return {
    id: String(w.id),
    name: w.name,
    folderPath: w.folder_path,
    state: w.state,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    lastAccessed: w.last_accessed,
  } as const;
}

ipcMain.handle('/workspace/list', async () => {
  try {
    if (database?.initialized) {
      const workspaces = await database.listWorkspaces();
      const shaped = workspaces.map(mapWorkspaceDbToIpc);
      return { success: true, data: shaped };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/workspace/create', async (_e, params: unknown) => {
  try {
    const validated = zSchemas.WorkspaceCreateSchema.parse(params);
    const { name, folderPath, state } = validated;

    if (database?.initialized) {
      const created = await database.createWorkspace(name, folderPath, state as Record<string, unknown>);
      return { success: true, data: { ...mapWorkspaceDbToIpc(created) } };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/workspace/load', async (_e, params: unknown) => {
  try {
    const { id } = zSchemas.WorkspaceLoadSchema.parse(params);

    if (database?.initialized) {
      const ws = await database.getWorkspace(id);
      if (!ws) return { success: true, data: null };
      // Mark as active and sync allowed paths for API/CLI
      try {
        await database.setPreference('workspace.active', String(ws.id));
      } catch (prefErr) {
         
        console.warn('Failed to set active workspace preference:', prefErr);
      }
      try {
        setAllowedWorkspacePaths([ws.folder_path]);
        getPathValidator([ws.folder_path]);
      } catch (syncErr) {
         
        console.warn('Failed to sync allowed paths for loaded workspace:', syncErr);
      }
      const shaped = mapWorkspaceDbToIpc(ws);
      return { success: true, data: shaped };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

// Activate a workspace by id or name without broadcasting folder-selected
ipcMain.handle('/workspace/activate', async (_e, params: unknown) => {
  try {
    // Accept either { id: string } or a raw string id
    let idParam: string | undefined;
    if (typeof params === 'string') {
      idParam = params;
    } else if (params && typeof params === 'object' && 'id' in (params as Record<string, unknown>)) {
      idParam = String((params as { id?: string }).id);
    }
    if (!idParam) {
      return { success: false, error: 'INVALID_PARAMS' };
    }

    if (database?.initialized) {
      const ws = await database.getWorkspace(idParam);
      if (!ws) return { success: false, error: 'Workspace not found' };

      // Mark as active and sync allowed paths for API/CLI silently
      try {
        await database.setPreference('workspace.active', String(ws.id));
      } catch (prefErr) {
         
        console.warn('Failed to set active workspace preference:', prefErr);
      }
      try {
        setAllowedWorkspacePaths([ws.folder_path]);
        getPathValidator([ws.folder_path]);
      } catch (syncErr) {
         
        console.warn('Failed to sync allowed paths for activated workspace:', syncErr);
      }

      const shaped = mapWorkspaceDbToIpc(ws);
      return { success: true, data: shaped };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/workspace/update', async (_e, params: unknown) => {
  try {
    const { id, state } = zSchemas.WorkspaceUpdateSchema.parse(params);
    if (database?.initialized) {
      await database.updateWorkspaceById(id, state);
      return { success: true, data: null };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/workspace/touch', async (_e, params: unknown) => {
  try {
    const { id } = zSchemas.WorkspaceTouchSchema.parse(params);
    if (database?.initialized) {
      const ws = await database.getWorkspace(id);
      if (!ws) return { success: false, error: 'Workspace not found' };
      await database.touchWorkspace(ws.name);
      return { success: true, data: null };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/workspace/delete', async (_e, params: unknown) => {
  try {
    const { id } = zSchemas.WorkspaceDeleteSchema.parse(params);
    if (database?.initialized) {
      await database.deleteWorkspaceById(id);
      return { success: true, data: null };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/workspace/rename', async (_e, params: unknown) => {
  try {
    const { id, newName } = zSchemas.WorkspaceRenameSchema.parse(params);
    if (database?.initialized) {
      const ws = await database.getWorkspace(id);
      if (!ws) return { success: false, error: 'Workspace not found' };
      await database.renameWorkspace(ws.name, newName);
      return { success: true, data: null };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

/**
 * Agent IPC channels (Phase 4)
 */
ipcMain.handle('agent:start-session', async (_e, params: unknown) => {
  try {
    const { AgentStartSessionSchema } = await import('./ipc/schemas');
    const { randomUUID } = await import('node:crypto');
    const parsed = AgentStartSessionSchema.safeParse(params || {});
    const sessionId = parsed.success && parsed.data.seedId ? parsed.data.seedId : randomUUID();
    if (database?.initialized) {
      try { await database!.upsertChatSession(sessionId, JSON.stringify([]), null); } catch { /* ignore */ }
      return { success: true, data: { sessionId } };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:get-history', async (_e, params: unknown) => {
  try {
    const { AgentGetHistorySchema } = await import('./ipc/schemas');
    const parsed = AgentGetHistorySchema.safeParse(params || {});
    if (!parsed.success) return { success: false, error: 'INVALID_PARAMS' };
    if (database?.initialized) {
      const row = await database!.getChatSession(parsed.data.sessionId);
      return { success: true, data: row ? { sessionId: row.id, messages: row.messages } : null };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

// List usage summaries for a session (tokens + optional latency)
ipcMain.handle('agent:usage:list', async (_e, params: unknown) => {
  try {
    const p = (params || {}) as { sessionId?: string };
    const sessionId = typeof p.sessionId === 'string' && p.sessionId.trim() ? p.sessionId.trim() : null;
    if (!sessionId) return { success: false, error: 'INVALID_PARAMS' };
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    const rows = await database.listUsageSummaries(sessionId);
    try {
      // eslint-disable-next-line no-console
      console.log('[Main][Telemetry] agent:usage:list', { sessionId, rows: Array.isArray(rows) ? rows.length : 0 });
    } catch { /* noop */ }
    return { success: true, data: rows };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

// Append a usage row (renderer-provided fallback)
ipcMain.handle('agent:usage:append', async (_e, params: unknown) => {
  try {
    const p = (params || {}) as { sessionId?: string; inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null; latencyMs?: number | null };
    const sessionId = typeof p.sessionId === 'string' && p.sessionId.trim() ? p.sessionId.trim() : null;
    if (!sessionId) return { success: false, error: 'INVALID_PARAMS' };
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    const input = (typeof p.inputTokens === 'number') ? p.inputTokens : null;
    const output = (typeof p.outputTokens === 'number') ? p.outputTokens : null;
    const total = (typeof p.totalTokens === 'number') ? p.totalTokens : ((input != null && output != null) ? (input + output) : null);
    const latency = (typeof p.latencyMs === 'number') ? p.latencyMs : null;
    try {
      await database.insertUsageSummaryWithLatency(sessionId, input, output, total, latency);
      // eslint-disable-next-line no-console
      console.log('[Main][Telemetry] agent:usage:append', { sessionId, input, output, total, latency });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error)?.message || 'DB_WRITE_FAILED' };
    }
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:execute-tool', async (_e, params: unknown) => {
  try {
    const { AgentExecuteToolSchema } = await import('./ipc/schemas');
    const parsed = AgentExecuteToolSchema.safeParse(params || {});
    if (!parsed.success) return { success: false, error: 'INVALID_PARAMS' };
    const { resolveAgentConfig } = await import('./agent/config');
    const { AgentSecurityManager } = await import('./agent/security-manager');
    const { getAgentTools } = await import('./agent/tools');
    const cfg = await resolveAgentConfig(database ? { getPreference: (k: string) => database!.getPreference(k) } : undefined);
    const security = await AgentSecurityManager.create({ db: database ? { getPreference: (k: string) => database!.getPreference(k) } : null });
    const tools = getAgentTools({
      security,
      config: cfg,
      sessionId: parsed.data.sessionId,
      onToolExecute: async (name, args, result, meta) => {
        try {
          const typedResult = name === 'context' ? (result as ContextResult) : result;
          await database!.insertToolExecution({
            sessionId: parsed.data.sessionId,
            toolName: String(name),
            args,
            result: typedResult,
            status: 'ok',
            error: null,
            startedAt: (typeof (meta as Record<string, unknown> | null | undefined)?.['startedAt'] === 'number') ? (meta as Record<string, unknown>)['startedAt'] as number : null,
            durationMs: (typeof (meta as Record<string, unknown> | null | undefined)?.['durationMs'] === 'number') ? (meta as Record<string, unknown>)['durationMs'] as number : null,
          });
        } catch { /* ignore logging errors */ }
      }
    });
    const toolDef = (tools as Record<string, { execute?: (args: unknown) => Promise<unknown> }>)[parsed.data.tool];
    if (!toolDef || typeof toolDef.execute !== 'function') return { success: false, error: 'TOOL_NOT_FOUND' };
    const result = await toolDef.execute(parsed.data.args);
    return { success: true, data: result };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:export-session', async (_e, sessionId: string, outPath?: string) => {
  try {
    if (!sessionId || typeof sessionId !== 'string') return { success: false, error: 'INVALID_SESSION_ID' };
    if (database?.initialized) {
      const row = await database.getChatSession(sessionId);
      if (!row) return { success: false, error: 'NOT_FOUND' };
      const tools = await database.listToolExecutions(sessionId);
      const usage = await database.listUsageSummaries(sessionId);
      const payload = { session: row, toolExecutions: tools, usage };
      const fs = await import('node:fs');
      const p = await import('node:path');
      const { app } = await import('electron');
      const { validateAndResolvePath } = await import('./file-service');
      if (outPath && typeof outPath === 'string' && outPath.trim().length > 0) {
        const val = validateAndResolvePath(outPath);
        if (!val.ok) return { success: false, error: `PATH_DENIED:${val.reason || val.message}` };
        await fs.promises.writeFile(val.absolutePath, JSON.stringify(payload, null, 2), 'utf8');
        return { success: true, data: { file: val.absolutePath } };
      }
      // Default: write to Downloads folder with a safe filename
      const downloads = app.getPath('downloads');
      const safeName = `pasteflow-session-${sessionId}.json`;
      const filePath = p.join(downloads, safeName);
      await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { success: true, data: { file: filePath } };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

/**
 * Agent threads IPC (Phase 1)
 * JSON-backed per-workspace chat threads
 */
ipcMain.handle('agent:threads:list', async (_e, params: unknown) => {
  try {
    const { AgentThreadsListSchema } = await import('./ipc/schemas');
    const parsed = AgentThreadsListSchema.safeParse(params || {});
    const wsIdParam = parsed.success ? parsed.data.workspaceId : undefined;
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    let wsId: string | null = wsIdParam ?? null;
    if (!wsId) {
      const active = await database.getPreference('workspace.active');
      wsId = (typeof active === 'string' && active.trim().length > 0) ? active : null;
    }
    if (!wsId) return { success: true, data: { threads: [] } };
    const ws = await database.getWorkspace(wsId);
    if (!ws) return { success: true, data: { threads: [] } };
    const { listThreads } = await import('./agent/chat-storage');
    const items = await listThreads({ id: String(ws.id), name: ws.name, folderPath: ws.folder_path });
    return { success: true, data: { threads: items } };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:threads:load', async (_e, params: unknown) => {
  try {
    const { AgentThreadsLoadSchema } = await import('./ipc/schemas');
    const parsed = AgentThreadsLoadSchema.safeParse(params || {});
    if (!parsed.success) return { success: false, error: 'INVALID_PARAMS' };
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    const ws = await database.getWorkspace(parsed.data.workspaceId);
    if (!ws) return { success: false, error: 'WORKSPACE_NOT_FOUND' };
    const { loadThreadInWorkspace } = await import('./agent/chat-storage');
    const data = await loadThreadInWorkspace({ id: String(ws.id), name: ws.name, folderPath: ws.folder_path }, parsed.data.sessionId);
    return { success: true, data };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:threads:saveSnapshot', async (_e, params: unknown) => {
  try {
    const { AgentThreadsSaveSnapshotSchema } = await import('./ipc/schemas');
    const parsed = AgentThreadsSaveSnapshotSchema.safeParse(params || {});
    if (!parsed.success) return { success: false, error: 'INVALID_PARAMS' };
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    let wsId: string | null = parsed.data.workspaceId ?? null;
    if (!wsId) {
      const active = await database.getPreference('workspace.active');
      wsId = (typeof active === 'string' && active.trim().length > 0) ? active : null;
    }
    if (!wsId) return { success: false, error: 'WORKSPACE_NOT_SELECTED' };
    const ws = await database.getWorkspace(wsId);
    if (!ws) return { success: false, error: 'WORKSPACE_NOT_FOUND' };
    const { saveSnapshot } = await import('./agent/chat-storage');
    const result = await saveSnapshot({
      sessionId: parsed.data.sessionId,
      workspace: { id: String(ws.id), name: ws.name, folderPath: ws.folder_path },
      messages: parsed.data.messages as unknown[],
      meta: parsed.data.meta as Record<string, unknown> | undefined,
    });
    if ('ok' in result && result.ok) return { success: true, data: result };
    return { success: false, error: (result as { error?: string } | null)?.error || 'SAVE_FAILED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:threads:delete', async (_e, params: unknown) => {
  try {
    const { AgentThreadsDeleteSchema } = await import('./ipc/schemas');
    const parsed = AgentThreadsDeleteSchema.safeParse(params || {});
    if (!parsed.success) return { success: false, error: 'INVALID_PARAMS' };
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    const ws = await database.getWorkspace(parsed.data.workspaceId);
    if (!ws) return { success: false, error: 'WORKSPACE_NOT_FOUND' };
    const { deleteThreadInWorkspace } = await import('./agent/chat-storage');
    const ok = await deleteThreadInWorkspace({ id: String(ws.id), name: ws.name, folderPath: ws.folder_path }, parsed.data.sessionId);
    return { success: true, data: { ok } };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('agent:threads:rename', async (_e, params: unknown) => {
  try {
    const { AgentThreadsRenameSchema } = await import('./ipc/schemas');
    const parsed = AgentThreadsRenameSchema.safeParse(params || {});
    if (!parsed.success) return { success: false, error: 'INVALID_PARAMS' };
    if (!database?.initialized) return { success: false, error: 'DB_NOT_INITIALIZED' };
    const ws = await database.getWorkspace(parsed.data.workspaceId);
    if (!ws) return { success: false, error: 'WORKSPACE_NOT_FOUND' };
    const { renameThreadInWorkspace } = await import('./agent/chat-storage');
    const ok = await renameThreadInWorkspace({ id: String(ws.id), name: ws.name, folderPath: ws.folder_path }, parsed.data.sessionId, parsed.data.title);
    return { success: true, data: { ok } };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

/** Instructions (envelope) */
function mapInstructionDbToIpc(i: InstructionRow) {
  return {
    id: i.id,
    name: i.name,
    content: i.content,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  } as const;
}

ipcMain.handle('/instructions/list', async () => {
  try {
    if (database?.initialized) {
      const list = await database.listInstructions();
      const shaped = list.map(mapInstructionDbToIpc);
      return { success: true, data: shaped };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/instructions/create', async (_e, params: unknown) => {
  try {
    const p = (await import('zod')).z.object({ id: (await import('zod')).z.string().min(1), name: (await import('zod')).z.string().min(1), content: (await import('zod')).z.string() }).parse(params);
    if (database?.initialized) {
      await database.createInstruction(p.id, p.name, p.content);
      return { success: true, data: null };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/instructions/update', async (_e, params: unknown) => {
  try {
    const p = (await import('zod')).z.object({ id: (await import('zod')).z.string().min(1), name: (await import('zod')).z.string().min(1), content: (await import('zod')).z.string() }).parse(params);
    if (database?.initialized) {
      await database.updateInstruction(p.id, p.name, p.content);
      return { success: true, data: null };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/instructions/delete', async (_e, params: unknown) => {
  try {
    const p = (await import('zod')).z.object({ id: (await import('zod')).z.string().min(1) }).parse(params);
    if (database?.initialized) {
      await database.deleteInstruction(p.id);
      return { success: true, data: null };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

/** Preferences (envelope) */
ipcMain.handle('/prefs/get', async (_e, params: unknown) => {
  try {
    let key: string | undefined;
    if (typeof params === 'string') {
      key = params;
    } else if (params && typeof params === 'object' && 'key' in (params as Record<string, unknown>)) {
      key = (params as { key?: string }).key;
    }
    if (!key || typeof key !== 'string') {
      return { success: true, data: null };
    }

    if (database?.initialized) {
      const value = await database.getPreference(key);
      return { success: true, data: value ?? null };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});

ipcMain.handle('/prefs/set', async (_e, params: unknown) => {
  try {
    const parsed = zSchemas.PreferenceSetSchema.parse(params);
    if (database?.initialized) {
      const { key, value, encrypted } = parsed;
      let toStore: unknown = value;
      if (encrypted === true && typeof value === 'string' && value.trim().length > 0) {
        const { encryptSecret } = await import('./secret-prefs');
        toStore = encryptSecret(value);
      }
      await database.setPreference(key, toStore as PreferenceValue);
      broadcastUpdate('/prefs/get:update');
      return { success: true, data: true };
    }

    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error: unknown) {
    return { success: false, error: (error as Error)?.message || String(error) };
  }
});
