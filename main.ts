import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { parseXmlString, applyFileChanges, prepareXmlWithCdata } from './src/main/xmlUtils';
// If you have this file
import { xmlFormatInstructions } from './src/main/xmlFormatInstructions';

// Main window reference
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    // In development, load from the Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  }

  // Open DevTools in development mode
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for file operations
ipcMain.handle('parse-xml', async (event, xmlString: string) => {
  try {
    const changes = await parseXmlString(xmlString);
    return { success: true, changes };
  } catch (error) {
    console.error('Error parsing XML:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('apply-changes', async (event, changes: any[], projectDir: string) => {
  try {
    const results = [];
    
    for (const change of changes) {
      try {
        await applyFileChanges(change, projectDir);
        results.push({
          file_path: change.file_path,
          success: true
        });
      } catch (error) {
        console.error(`Error applying change to ${change.file_path}:`, error);
        results.push({
          file_path: change.file_path,
          success: false,
          error: (error as Error).message
        });
      }
    }
    
    return { success: true, results };
  } catch (error) {
    console.error('Error applying changes:', error);
    return { success: false, error: (error as Error).message };
  }
});

// Add any other IPC handlers and functionality from your main.js file...