import { useCallback, useEffect, useState, useMemo } from 'react';
import { WorkspaceState } from '../types/file-types';

interface DatabaseWorkspace {
  id: string;
  name: string;
  folderPath: string;
  state: WorkspaceState;
  createdAt: number;
  updatedAt: number;
  lastAccessed: number;
}

export const useDatabaseWorkspaceState = () => {
  const [workspacesList, setWorkspacesList] = useState<DatabaseWorkspace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspacesList = useCallback(async () => {
    try {
      if (!window.electron) return;
      
      const workspaces = await window.electron.ipcRenderer.invoke('/workspace/list');
      setWorkspacesList(workspaces);
    } catch (error) {
      console.error('Failed to refresh workspaces list:', error);
      setError('Failed to load workspaces');
    }
  }, []);

  useEffect(() => {
    refreshWorkspacesList();

    const handleWorkspacesChanged = () => {
      refreshWorkspacesList();
    };

    window.addEventListener('workspacesChanged', handleWorkspacesChanged);
    return () => {
      window.removeEventListener('workspacesChanged', handleWorkspacesChanged);
    };
  }, [refreshWorkspacesList]);

  const findWorkspaceByName = useCallback(async (name: string): Promise<DatabaseWorkspace | null> => {
    try {
      if (!window.electron) return null;
      
      // Use the direct load method instead of listing all workspaces
      const workspace = await window.electron.ipcRenderer.invoke('/workspace/load', { id: name });
      return workspace;
    } catch (error) {
      // Workspace not found is expected, don't log as error
      if (error.message !== 'Workspace not found') {
        console.error('Failed to find workspace by name:', error);
      }
      return null;
    }
  }, []);

  const saveWorkspace = useCallback(async (name: string, workspace: WorkspaceState): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      const existing = await findWorkspaceByName(name);
      
      if (existing) {
        await window.electron.ipcRenderer.invoke('/workspace/update', {
          id: existing.id,
          state: workspace
        });
      } else {
        await window.electron.ipcRenderer.invoke('/workspace/create', {
          name,
          folderPath: workspace.selectedFolder || '',
          state: workspace
        });
      }
      
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      console.error('Failed to save workspace:', error);
      setError('Failed to save workspace');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  const loadWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      const workspace = await findWorkspaceByName(name);
      if (!workspace) return null;
      
      // Load the full workspace data including state
      const fullWorkspace = await window.electron.ipcRenderer.invoke('/workspace/load', {
        id: workspace.id
      });
      
      // Update last accessed time
      await window.electron.ipcRenderer.invoke('/workspace/touch', {
        id: workspace.id
      });
      
      return fullWorkspace.state;
    } catch (error) {
      console.error('Failed to load workspace:', error);
      setError('Failed to load workspace');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  const deleteWorkspace = useCallback(async (name: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      const workspace = await findWorkspaceByName(name);
      if (!workspace) {
        console.warn('Workspace not found:', name);
        return;
      }
      
      await window.electron.ipcRenderer.invoke('/workspace/delete', {
        id: workspace.id
      });
      
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      console.error('Failed to delete workspace:', error);
      setError('Failed to delete workspace');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  const renameWorkspace = useCallback(async (oldName: string, newName: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      const workspace = await findWorkspaceByName(oldName);
      if (!workspace) {
        throw new Error('Workspace not found');
      }
      
      await window.electron.ipcRenderer.invoke('/workspace/rename', {
        id: workspace.id,
        newName
      });
      
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      console.error('Failed to rename workspace:', error);
      setError('Failed to rename workspace');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  const getWorkspaceNames = useCallback(async (): Promise<string[]> => {
    try {
      if (!window.electron) return [];
      
      const workspaces = await window.electron.ipcRenderer.invoke('/workspace/list');
      return workspaces.map((w: DatabaseWorkspace) => w.name);
    } catch (error) {
      console.error('Failed to get workspace names:', error);
      return [];
    }
  }, []);

  const importWorkspace = useCallback(async (name: string, workspaceData: WorkspaceState): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      await window.electron.ipcRenderer.invoke('/workspace/create', {
        name,
        folderPath: workspaceData.selectedFolder || '',
        state: workspaceData
      });
      
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      console.error('Failed to import workspace:', error);
      setError('Failed to import workspace');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const exportWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      const workspace = await findWorkspaceByName(name);
      if (!workspace) return null;
      
      return workspace.state;
    } catch (error) {
      console.error('Failed to export workspace:', error);
      setError('Failed to export workspace');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  const doesWorkspaceExist = useCallback(async (name: string): Promise<boolean> => {
    const workspace = await findWorkspaceByName(name);
    return workspace !== null;
  }, [findWorkspaceByName]);

  const getWorkspaceCreatedTime = useCallback(async (name: string): Promise<number | null> => {
    const workspace = await findWorkspaceByName(name);
    return workspace ? workspace.createdAt : null;
  }, [findWorkspaceByName]);

  const getWorkspaceLastAccessedTime = useCallback(async (name: string): Promise<number | null> => {
    const workspace = await findWorkspaceByName(name);
    return workspace ? workspace.lastAccessed : null;
  }, [findWorkspaceByName]);

  const clearAllWorkspaces = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }

      const workspaces = await window.electron.ipcRenderer.invoke('/workspace/list');
      
      for (const workspace of workspaces) {
        await window.electron.ipcRenderer.invoke('/workspace/delete', {
          id: workspace.id
        });
      }
      
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      console.error('Failed to clear all workspaces:', error);
      setError('Failed to clear all workspaces');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return useMemo(() => ({
    saveWorkspace,
    loadWorkspace,
    deleteWorkspace,
    renameWorkspace,
    getWorkspaceNames,
    importWorkspace,
    exportWorkspace,
    doesWorkspaceExist,
    getWorkspaceCreatedTime,
    getWorkspaceLastAccessedTime,
    clearAllWorkspaces,
    refreshWorkspacesList,
    workspacesList,
    isLoading,
    error
  }), [
    saveWorkspace, loadWorkspace, deleteWorkspace, renameWorkspace, getWorkspaceNames, 
    importWorkspace, exportWorkspace, doesWorkspaceExist, getWorkspaceCreatedTime, 
    getWorkspaceLastAccessedTime, clearAllWorkspaces, refreshWorkspacesList, 
    workspacesList, isLoading, error
  ]);
};