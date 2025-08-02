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
          throw new Error(`Cannot save workspace '${name}' with invalid path '${workspace.selectedFolder}': ${validation.reason}. Choose a valid directory path.`);
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
          console.error(`Failed to save workspace '${name}': ${error.message}`);
          throw new Error(`Failed to save workspace '${name}': ${error.message}. Check workspace data and database permissions.`);
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
        console.error(`Failed to load workspace '${name}': ${error.message}`);
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
      console.error(`Failed to delete workspace '${name}': ${error.message}`);
      throw new Error(`Failed to delete workspace '${name}': ${error.message}. Check database permissions and workspace references.`);
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
      console.error(`Failed to rename workspace '${oldName}' to '${newName}': ${error.message}`);
      return false;
    }
  }, [db, currentWorkspace, setCurrentWorkspace]);

  const getWorkspaceNames = useCallback(async (): Promise<string[]> => {
    try {
      const names = await db.getWorkspaceNames();
      
      // Sort by last accessed time (database already returns them sorted)
      return names;
    } catch (error) {
      console.error(`Failed to get workspace names: ${error.message}`);
      return [];
    }
  }, [db]);

  // Export/Import functionality
  const exportWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    try {
      return await db.exportWorkspace(name);
    } catch (error) {
      console.error(`Failed to export workspace '${name}': ${error.message}`);
      throw new Error(`Failed to export workspace '${name}': ${error.message}. Verify workspace exists and is accessible.`);
    }
  }, [db]);

  const importWorkspace = useCallback(async (name: string, workspaceData: WorkspaceState): Promise<void> => {
    try {
      return await db.importWorkspace(name, workspaceData);
    } catch (error) {
      console.error(`Failed to import workspace '${name}': ${error.message}`);
      throw new Error(`Failed to import workspace '${name}': ${error.message}. Check workspace data format and database permissions.`);
    }
  }, [db]);

  // Utility methods
  const doesWorkspaceExist = useCallback(async (name: string): Promise<boolean> => {
    try {
      return await db.doesWorkspaceExist(name);
    } catch (error) {
      console.error(`Failed to check if workspace '${name}' exists: ${error.message}`);
      return false;
    }
  }, [db]);

  const clearAllWorkspaces = useCallback(async (): Promise<void> => {
    try {
      await db.clearAllWorkspaces();
      setCurrentWorkspace(null);
    } catch (error) {
      console.error(`Failed to clear all workspaces: ${error.message}`);
      throw new Error(`Failed to clear all workspaces: ${error.message}. Check database permissions and try again.`);
    }
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