// Helper for validating file paths (adjust safe directories as needed)
function isPathSafe(filePath) {
  const normalizedPath = path.normalize(filePath);
  const userDataPath = app.getPath('userData');
  const documentsPath = app.getPath('documents');
  const projectPath = process.env.PROJECT_PATH; // Set this based on your app's needs
  
  return normalizedPath.startsWith(userDataPath) || 
         normalizedPath.startsWith(documentsPath) ||
         (projectPath && normalizedPath.startsWith(projectPath));
}

// Secure handler for file operations
ipcMain.handle('file-operation', async (event, arg) => {
  try {
    const { operation, path: filePath, content } = arg;
    
    // Validate operation
    if (!['read', 'write', 'delete'].includes(operation)) {
      return { error: true, message: 'Invalid operation' };
    }
    
    // Validate path
    if (typeof filePath !== 'string') {
      return { error: true, message: 'Invalid file path' };
    }
    
    // For production, uncomment the path safety check
    // if (!isPathSafe(filePath)) {
    //   return { error: true, message: 'Path access denied for security reasons' };
    // }
    
    // Perform operations with validation
    switch (operation) {
      case 'read':
        const data = await fs.promises.readFile(filePath, 'utf8');
        return data;
      
      case 'write':
        if (typeof content !== 'string') {
          return { error: true, message: 'Content must be a string' };
        }
        await fs.promises.writeFile(filePath, content, 'utf8');
        return { success: true };
      
      case 'delete':
        await fs.promises.unlink(filePath);
        return { success: true };
      
      default:
        return { error: true, message: 'Unsupported operation' };
    }
  } catch (error) {
    console.error('File operation error:', error);
    return { 
      error: true, 
      message: error.message || 'Unknown error'
    };
  }
}); 