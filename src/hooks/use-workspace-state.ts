import { useCallback, useEffect, useState } from 'react';

import { STORAGE_KEYS } from '../constants';
import { WorkspaceState } from '../types/file-types';
import { getPathValidator } from '../security/path-validator';
import { useDatabaseWorkspaceState } from './use-database-workspace-state';
import { usePersistentState } from './use-persistent-state';
import { useCancellableOperation } from './use-cancellable-operation';

export const useWorkspaceState = () => {
  const db = useDatabaseWorkspaceState();
  const { runCancellableOperation } = useCancellableOperation();
  const [currentWorkspace, setCurrentWorkspace] = usePersistentState<string | null>(
    STORAGE_KEYS.CURRENT_WORKSPACE,
    null
  );
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);

  // Mark as initialized on mount
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  const saveWorkspace = useCallback((name: string, workspace: WorkspaceState) => {
    try {
      // Validate the workspace folder path if it exists
      if (workspace.selectedFolder) {
        const validator = getPathValidator();
        const validation = validator.validatePath(workspace.selectedFolder);
        
        if (!validation.valid) {
          throw new Error(`Cannot save workspace with invalid path: ${validation.reason}`);
        }
        
        // Update workspace with sanitized path
        workspace = {
          ...workspace,
          selectedFolder: validation.sanitizedPath || workspace.selectedFolder
        };
      }
      
      // Save to database asynchronously (fire and forget)
      db.saveWorkspace(name, workspace)
        .then(() => {
          setCurrentWorkspace(name);
        })
        .catch(error => {
          console.error(`Failed to save workspace '${name}':`, error);
          throw error;
        });
    } catch (error) {
      throw error;
    }
  }, [db, setCurrentWorkspace]);

  // These methods need to be async now
  const loadWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    if (isLoadingWorkspace) {
      console.log('Cancelling previous workspace load operation');
    }

    setIsLoadingWorkspace(true);
    
    const result = await runCancellableOperation(async (token) => {
      try {
        const workspace = await db.loadWorkspace(name);
        
        // Check if cancelled before processing
        if (token.cancelled) {
          console.log('Workspace load cancelled');
          return null;
        }
        
        if (workspace) {
          // Don't set current workspace here - let the caller decide
          return workspace;
        }
        return null;
      } catch (error) {
        console.error(`Failed to load workspace '${name}':`, error);
        return null;
      }
    });
    
    setIsLoadingWorkspace(false);
    return result;
  }, [db, isLoadingWorkspace, runCancellableOperation]);

  const deleteWorkspace = useCallback(async (name: string): Promise<void> => {
    try {
      await db.deleteWorkspace(name);
      
      // Clear current workspace if it was the deleted one
      if (currentWorkspace === name) {
        setCurrentWorkspace(null);
      }
    } catch (error) {
      console.error(`Failed to delete workspace '${name}':`, error);
      throw error;
    }
  }, [db, currentWorkspace, setCurrentWorkspace]);

  const renameWorkspace = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    if (!newName || oldName === newName) {
      return false;
    }
    
    try {
      // Check if new name already exists
      const exists = await db.doesWorkspaceExist(newName);
      if (exists) {
        return false;
      }
      
      await db.renameWorkspace(oldName, newName);
      
      // Update current workspace if it was renamed
      if (currentWorkspace === oldName) {
        setCurrentWorkspace(newName);
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to rename workspace '${oldName}' to '${newName}':`, error);
      return false;
    }
  }, [db, currentWorkspace, setCurrentWorkspace]);

  const getWorkspaceNames = useCallback(async (): Promise<string[]> => {
    try {
      const names = await db.getWorkspaceNames();
      
      // Sort by last accessed time (database already returns them sorted)
      return names;
    } catch (error) {
      console.error('Failed to get workspace names:', error);
      return [];
    }
  }, [db]);

  // Export/Import functionality
  const exportWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    return db.exportWorkspace(name);
  }, [db]);

  const importWorkspace = useCallback(async (name: string, workspaceData: WorkspaceState): Promise<void> => {
    return db.importWorkspace(name, workspaceData);
  }, [db]);

  // Utility methods
  const doesWorkspaceExist = useCallback(async (name: string): Promise<boolean> => {
    return db.doesWorkspaceExist(name);
  }, [db]);

  const clearAllWorkspaces = useCallback(async (): Promise<void> => {
    await db.clearAllWorkspaces();
    setCurrentWorkspace(null);
  }, [db, setCurrentWorkspace]);

  return { 
    saveWorkspace, 
    loadWorkspace, 
    deleteWorkspace, 
    renameWorkspace, 
    getWorkspaceNames,
    exportWorkspace,
    importWorkspace,
    doesWorkspaceExist,
    clearAllWorkspaces,
    currentWorkspace,
    setCurrentWorkspace,
    isLoading: db.isLoading,
    error: db.error
  };
};