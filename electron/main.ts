// Helper for validating file paths
function isPathSafe(filePath: string): boolean {
  // Normalize path to prevent path traversal attacks
  const normalizedPath = path.normalize(filePath);
  
  // Define safe directories
  const userDataPath = app.getPath('userData');
  const documentsPath = app.getPath('documents');
  
  // Check if the path is within safe directories
  return normalizedPath.startsWith(userDataPath) || 
         normalizedPath.startsWith(documentsPath) ||
         // Add any other allowed directories
         false;
}

// Example of a secure IPC handler for file operations
ipcMain.handle('file-operation', async (_event, arg) => {
  try {
    // Type checking
    if (!arg || typeof arg !== 'object') {
      throw new Error('Invalid arguments');
    }
    
    const { operation, path: filePath, content } = arg as { 
      operation: string; 
      path: string; 
      content?: string 
    };
    
    // Validate operation
    if (!['read', 'write', 'delete'].includes(operation)) {
      throw new Error('Invalid operation');
    }
    
    // Validate path
    if (typeof filePath !== 'string' || !isPathSafe(filePath)) {
      throw new Error('Invalid or unsafe file path');
    }
    
    // Perform operation with proper validation
    switch (operation) {
      case 'read':
        return await fs.promises.readFile(filePath, 'utf8');
      
      case 'write':
        if (typeof content !== 'string') {
          throw new Error('Content must be a string');
        }
        await fs.promises.writeFile(filePath, content, 'utf8');
        return { success: true };
      
      case 'delete':
        await fs.promises.unlink(filePath);
        return { success: true };
      
      default:
        throw new Error('Unsupported operation');
    }
  } catch (error) {
    console.error('File operation error:', error);
    return { 
      error: true, 
      message: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
});

// Additional secure handlers for your app's functionality
ipcMain.handle('get-files', async (_event, directory) => {
  try {
    // Validate input
    if (typeof directory !== 'string' || !isPathSafe(directory)) {
      throw new Error('Invalid or unsafe directory path');
    }
    
    // Implement with proper error handling
    const files = await fs.promises.readdir(directory);
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    return { 
      error: true, 
      message: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Enable context isolation
      contextIsolation: true,
      
      // Disable Node integration in renderer
      nodeIntegration: false,
      
      // Specify preload script
      preload: path.join(__dirname, 'preload.js'),
      
      // Additional security settings
      sandbox: true,
      webSecurity: true,
      
      // Disable remote module access (deprecated in newer Electron versions)
      enableRemoteModule: false
    }
  });
  
  // Load the app
  mainWindow.loadURL(
    app.isPackaged 
      ? `file://${path.join(__dirname, '../renderer/index.html')}` 
      : 'http://localhost:3000'
  );
  
  // Prevent creating new windows from the renderer
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
} 