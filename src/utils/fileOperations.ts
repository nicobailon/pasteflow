// Add this file to define the electron API for TypeScript

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, data: any) => void;
    on: (channel: string, func: (...args: any[]) => void) => void;
    once: (channel: string, func: (...args: any[]) => void) => void;
    removeListener: (channel: string, func: (...args: any[]) => void) => void;
    invoke: (channel: string, data: any) => Promise<any>;
  };
}

interface Window {
  electron: ElectronAPI;
}

export async function readFile(filePath: string): Promise<string> {
  try {
    const result = await window.electron.ipcRenderer.invoke('file-operation', {
      operation: 'read',
      path: filePath
    });
    
    if (result.error) {
      throw new Error(result.message || 'Failed to read file');
    }
    
    return result;
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('file-operation', {
    operation: 'write',
    path: filePath,
    content
  });
  
  if (result.error) {
    throw new Error(result.message || 'Failed to write file');
  }
} 