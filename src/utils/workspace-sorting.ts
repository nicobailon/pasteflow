import { STORAGE_KEYS } from '../constants';

export type WorkspaceSortMode = 'recent' | 'alphabetical' | 'manual';

export interface WorkspaceInfo {
  name: string;
  savedAt: number;
}

// Database-backed workspace sorting utilities
// These now use IPC to communicate with the database

export const getWorkspaceSortMode = async (): Promise<WorkspaceSortMode> => {
  try {
    if (window.electron) {
      const savedMode = await window.electron.ipcRenderer.invoke('/prefs/get', {
        key: STORAGE_KEYS.WORKSPACE_SORT_MODE
      });
      return (savedMode as WorkspaceSortMode) || 'recent';
    }
  } catch (error) {
    console.error('Error getting workspace sort mode:', error);
  }
  return 'recent';
};

export const setWorkspaceSortMode = async (mode: WorkspaceSortMode): Promise<void> => {
  try {
    if (window.electron) {
      await window.electron.ipcRenderer.invoke('/prefs/set', {
        key: STORAGE_KEYS.WORKSPACE_SORT_MODE,
        value: mode,
        encrypted: false
      });
    }
  } catch (error) {
    console.error('Error setting workspace sort mode:', error);
  }
};

export const getWorkspaceManualOrder = async (): Promise<string[]> => {
  try {
    if (window.electron) {
      const savedOrder = await window.electron.ipcRenderer.invoke('/prefs/get', {
        key: STORAGE_KEYS.WORKSPACE_MANUAL_ORDER
      });
      return savedOrder || [];
    }
  } catch (error) {
    console.error('Error getting workspace manual order:', error);
  }
  return [];
};

export const setWorkspaceManualOrder = async (order: string[]): Promise<void> => {
  try {
    if (window.electron) {
      await window.electron.ipcRenderer.invoke('/prefs/set', {
        key: STORAGE_KEYS.WORKSPACE_MANUAL_ORDER,
        value: order,
        encrypted: false
      });
    }
  } catch (error) {
    console.error('Error setting workspace manual order:', error);
  }
};

export const sortWorkspaces = (
  workspaces: WorkspaceInfo[], 
  mode: WorkspaceSortMode,
  manualOrder?: string[]
): string[] => {
  switch (mode) {
    case 'recent': {
      return [...workspaces]
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(w => w.name);
    }
    
    case 'alphabetical': {
      return [...workspaces]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map(w => w.name);
    }
    
    case 'manual': {
      if (!manualOrder || manualOrder.length === 0) {
        return workspaces.map(w => w.name);
      }
      
      const workspaceMap = new Map(workspaces.map(w => [w.name, w]));
      const orderedNames: string[] = [];
      const remainingNames = new Set(workspaces.map(w => w.name));
      
      for (const name of manualOrder) {
        if (workspaceMap.has(name)) {
          orderedNames.push(name);
          remainingNames.delete(name);
        }
      }
      
      const remaining = [...remainingNames].sort((a, b) => 
        a.toLowerCase().localeCompare(b.toLowerCase())
      );
      
      return [...orderedNames, ...remaining];
    }
    
    default: {
      return workspaces.map(w => w.name);
    }
  }
};

export const moveWorkspace = (
  workspaces: string[],
  fromIndex: number,
  toIndex: number
): string[] => {
  if (fromIndex === toIndex) return workspaces;
  
  const result = [...workspaces];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  
  return result;
};