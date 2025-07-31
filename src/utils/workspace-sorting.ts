import { STORAGE_KEYS } from '../constants';

export type WorkspaceSortMode = 'recent' | 'alphabetical' | 'manual';

export interface WorkspaceInfo {
  name: string;
  savedAt: number;
}

export const getWorkspaceSortMode = (): WorkspaceSortMode => {
  const savedMode = localStorage.getItem(STORAGE_KEYS.WORKSPACE_SORT_MODE);
  return (savedMode as WorkspaceSortMode) || 'recent';
};

export const setWorkspaceSortMode = (mode: WorkspaceSortMode) => {
  localStorage.setItem(STORAGE_KEYS.WORKSPACE_SORT_MODE, mode);
};

export const getWorkspaceManualOrder = (): string[] => {
  const savedOrder = localStorage.getItem(STORAGE_KEYS.WORKSPACE_MANUAL_ORDER);
  return savedOrder ? JSON.parse(savedOrder) : [];
};

export const setWorkspaceManualOrder = (order: string[]) => {
  localStorage.setItem(STORAGE_KEYS.WORKSPACE_MANUAL_ORDER, JSON.stringify(order));
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
      
      const remaining = Array.from(remainingNames).sort((a, b) => 
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