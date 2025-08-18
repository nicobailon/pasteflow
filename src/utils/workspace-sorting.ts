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
      const resp = await window.electron.ipcRenderer.invoke('/prefs/get', {
        key: STORAGE_KEYS.WORKSPACE_SORT_MODE
      });
      // Accept either envelope or legacy raw value
      const savedMode = (resp && typeof resp === 'object' && 'success' in (resp as any))
        ? ((resp as any).success === true ? ((resp as any).data as WorkspaceSortMode | null) : null)
        : (resp as WorkspaceSortMode | null);
      return savedMode || 'recent';
    }
  } catch (error) {
    console.error('Error getting workspace sort mode:', error);
  }
  return 'recent';
};

export const setWorkspaceSortMode = async (mode: WorkspaceSortMode): Promise<void> => {
  try {
    if (window.electron) {
      const resp = await window.electron.ipcRenderer.invoke('/prefs/set', {
        key: STORAGE_KEYS.WORKSPACE_SORT_MODE,
        value: mode,
        encrypted: false
      });
      // Accept either envelope or legacy boolean true
      if (resp && typeof resp === 'object' && 'success' in (resp as any)) {
        if ((resp as any).success !== true) {
          throw new Error((resp as any).error || 'IPC /prefs/set failed');
        }
      } else if (resp !== true) {
        throw new Error('IPC /prefs/set failed');
      }
    }
  } catch (error) {
    console.error('Error setting workspace sort mode:', error);
  }
};

export const getWorkspaceManualOrder = async (): Promise<string[]> => {
  try {
    if (window.electron) {
      const resp = await window.electron.ipcRenderer.invoke('/prefs/get', {
        key: STORAGE_KEYS.WORKSPACE_MANUAL_ORDER
      });
      // Accept envelope or legacy raw array
      if (resp && typeof resp === 'object' && 'success' in (resp as any)) {
        if ((resp as any).success === true) {
          return ((resp as any).data as string[]) || [];
        }
        return [];
      }
      return (resp as string[]) || [];
    }
  } catch (error) {
    console.error('Error getting workspace manual order:', error);
  }
  return [];
};

export const setWorkspaceManualOrder = async (order: string[]): Promise<void> => {
  try {
    if (window.electron) {
      const resp = await window.electron.ipcRenderer.invoke('/prefs/set', {
        key: STORAGE_KEYS.WORKSPACE_MANUAL_ORDER,
        value: order,
        encrypted: false
      });
      // Accept either envelope or legacy boolean true
      if (resp && typeof resp === 'object' && 'success' in (resp as any)) {
        if ((resp as any).success !== true) {
          throw new Error((resp as any).error || 'IPC /prefs/set failed');
        }
      } else if (resp !== true) {
        throw new Error('IPC /prefs/set failed');
      }
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