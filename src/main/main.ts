import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

import { ELECTRON } from '@constants';
import { excludedFiles } from '@shared/excluded-files';
import { getPathValidator } from '../security/path-validator';
import * as zSchemas from './ipc/schemas';

process.env.ZOD_DISABLE_DOC = process.env.ZOD_DISABLE_DOC || '1';

// Track current workspace paths for security validation
let currentWorkspacePaths: string[] = [];

// Main window instance
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: ELECTRON.WINDOW.WIDTH,
    height: ELECTRON.WINDOW.HEIGHT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set Content Security Policy for Web Workers and WASM
  const isDev = process.env.NODE_ENV === 'development';
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self';" +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: http://localhost:*;" +
        "worker-src 'self' blob:;" +
        "connect-src 'self' http://localhost:* ws://localhost:*;" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' data: blob:;" +
        "font-src 'self' data:;"
      : "default-src 'self';" +
        "script-src 'self' 'wasm-unsafe-eval' blob:;" +
        "worker-src 'self' blob:;" +
        "connect-src 'self';" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' data: blob:;" +
        "font-src 'self' data:;";

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });

  if (isDev) {
    const startUrl = process.env.ELECTRON_START_URL || ELECTRON.DEV_SERVER.URL;
    setTimeout(() => {
      mainWindow?.webContents.session.clearCache().then(() => {
        mainWindow?.loadURL(startUrl);
        if (mainWindow && !mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.openDevTools({ mode: ELECTRON.WINDOW.DEVTOOLS_MODE as any });
        }
      });
    }, ELECTRON.WINDOW.DEV_RELOAD_DELAY_MS);
  } else {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    const indexUrl = `file://${indexPath}`;
    mainWindow.loadURL(indexUrl);
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to load the application: ${errorDescription} (${errorCode})`);
    // eslint-disable-next-line no-console
    console.error(`Attempted to load URL: ${validatedURL}`);

    const isDev2 = process.env.NODE_ENV === 'development';
    if (isDev2) {
      const retryUrl = process.env.ELECTRON_START_URL || ELECTRON.DEV_SERVER.URL;
      mainWindow?.webContents.session.clearCache().then(() => {
        setTimeout(() => mainWindow?.loadURL(retryUrl), 1000);
      });
    } else {
      const indexPath = path.join(__dirname, 'dist', 'index.html');
      const indexUrl = `file://${indexPath}`;
      mainWindow?.loadURL(indexUrl);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Replace top-level await with app.whenReady()
app.whenReady().then(() => {
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

let isQuitting = false;
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
        // eslint-disable-next-line no-console
        console.warn('Auto-save timeout during shutdown - proceeding with quit');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error during shutdown save:', err);
    }
  }

  app.exit(0);
});

// IPC: Open folder selection
ipcMain.on('open-folder', async (event) => {
  try {
    // Optional validation with zod schema for parity
    zSchemas.FolderSelectionSchema.parse({});
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.warn('Validation error for open-folder:', (error as Error)?.message);
  }

  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths?.length) {
    const selectedPath = String(result.filePaths[0]);
    try {
      currentWorkspacePaths = [selectedPath];
      getPathValidator(currentWorkspacePaths); // Initialize validator
      event.sender.send('folder-selected', selectedPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error sending folder-selected event:', err);
    }
  }
});

// Minimal handlers kept here for compilation parity only.
// Runtime still uses legacy main.js until package.json main is flipped.

// Placeholder to reference shared resources so tsc-alias validates rewrites
void excludedFiles;
void getPathValidator;