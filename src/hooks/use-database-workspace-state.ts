import { useCallback, useEffect, useState, useMemo, useRef } from 'react';

import { WorkspaceState } from '../types/file-types';

import { useCancellableOperation } from './use-cancellable-operation';

// Event name for workspace changes notification
const WORKSPACES_CHANGED_EVENT = 'workspacesChanged';
// Error message for missing Electron IPC
const ELECTRON_IPC_NOT_AVAILABLE = 'Electron IPC not available';

/**
 * Database workspace object with metadata and state.
 * Represents a complete workspace record from the SQLite database.
 */
interface DatabaseWorkspace {
  /** Unique workspace identifier (string representation of database ID) */
  id: string;
  /** Human-readable workspace name (unique) */
  name: string;
  /** Associated folder path for this workspace */
  folderPath: string;
  /** Complete workspace state (file selections, UI state, etc.) */
  state: WorkspaceState;
  /** Creation timestamp (Unix milliseconds) */
  createdAt: number;
  /** Last modification timestamp (Unix milliseconds) */
  updatedAt: number;
  /** Last access timestamp (Unix milliseconds) */
  lastAccessed: number;
}
 
// IPC envelope unwrap helper for main responses.
// Accepts both new { success, data|error } envelope or legacy raw values during transition.
function unwrapIpc<T>(res: any): T {
  if (res && typeof res === 'object' && 'success' in res) {
    if ((res as any).success !== true) {
      throw new Error((res as any).error || 'IPC request failed');
    }
    return (res as any).data as T;
  }
  return res as T;
}

/**
 * React hook for managing workspace state through SQLite database operations.
 * Provides CRUD operations for workspaces with automatic UI synchronization and loading states.
 * 
 * @returns {Object} Workspace management interface with methods and state:
 *   - saveWorkspace: Save or update workspace state
 *   - loadWorkspace: Load workspace state by name
 *   - deleteWorkspace: Remove workspace permanently
 *   - renameWorkspace: Change workspace name
 *   - importWorkspace: Import workspace from external data
 *   - exportWorkspace: Export workspace state
 *   - getWorkspaceNames: Get list of workspace names
 *   - workspacesList: Current list of all workspaces
 *   - isLoading: Loading state indicator
 *   - error: Error message if operation fails
 * 
 * @example
 * const {
 *   saveWorkspace,
 *   loadWorkspace,
 *   workspacesList,
 *   isLoading
 * } = useDatabaseWorkspaceState();
 * 
 * // Save current state
 * await saveWorkspace('my-project', currentWorkspaceState);
 * 
 * // Load saved state
 * const state = await loadWorkspace('my-project');
 */
export const useDatabaseWorkspaceState = () => {
  const [workspacesList, setWorkspacesList] = useState<DatabaseWorkspace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { runCancellableOperation } = useCancellableOperation();
  const isMountedRef = useRef(true);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Safe state setters that check if component is still mounted
  const safeSetIsLoading = useCallback((loading: boolean) => {
    if (isMountedRef.current) {
      setIsLoading(loading);
    }
  }, []);

  const safeSetError = useCallback((error: string | null) => {
    if (isMountedRef.current) {
      setError(error);
    }
  }, []);

  const safeSetWorkspacesList = useCallback((workspaces: DatabaseWorkspace[]) => {
    if (isMountedRef.current) {
      setWorkspacesList(workspaces);
    }
  }, []);

  /**
   * Refreshes the local workspaces list from the database.
   * Called automatically on mount and when workspaces change.
   * 
   * @returns {Promise<void>} Promise that resolves when refresh completes
   */
  const refreshWorkspacesList = useCallback(async () => {
    await runCancellableOperation(async (token) => {
      try {
        if (!window.electron) return;
        
        const workspaces = unwrapIpc<DatabaseWorkspace[]>(await window.electron.ipcRenderer.invoke('/workspace/list', {}));
        
        // Check if cancelled before updating state
        if (token.cancelled) {
          return;
        }
        
        safeSetWorkspacesList(workspaces);
      } catch (error) {
        console.error(`Failed to refresh workspaces list: ${(error as Error).message}`);
        safeSetError(`Failed to load workspaces: ${(error as Error).message}. Check database connection and retry.`);
      }
    });
  }, [runCancellableOperation, safeSetWorkspacesList, safeSetError]);

  // Listen for external workspace list updates (e.g., CLI create/rename/delete via HTTP API)
  useEffect(() => {
    const onUpdated = () => { void refreshWorkspacesList(); };
    try {
      if (window.electron?.ipcRenderer?.on) {
        window.electron.ipcRenderer.on('workspaces-updated', onUpdated as unknown as (...args: unknown[]) => void);
      }
    } catch {
      // ignore subscription errors
    }
    return () => {
      try {
        if (window.electron?.ipcRenderer?.removeListener) {
          window.electron.ipcRenderer.removeListener('workspaces-updated', onUpdated as unknown as (...args: unknown[]) => void);
        }
      } catch {
        // ignore cleanup errors
      }
    };
  }, [refreshWorkspacesList]);

  useEffect(() => {
    refreshWorkspacesList();

    const handleWorkspacesChanged = () => {
      refreshWorkspacesList();
    };

    window.addEventListener(WORKSPACES_CHANGED_EVENT, handleWorkspacesChanged);
    return () => {
      window.removeEventListener(WORKSPACES_CHANGED_EVENT, handleWorkspacesChanged);
    };
  }, [refreshWorkspacesList]);

  /**
   * Finds a workspace by name using direct database lookup.
   * More efficient than filtering the workspaces list for single workspace operations.
   * 
   * @param {string} name - Workspace name to find
   * @returns {Promise<DatabaseWorkspace | null>} Promise resolving to workspace object or null
   * @example
   * const workspace = await findWorkspaceByName('my-project');
   * if (workspace) {
   *   console.log('Found:', workspace.folderPath);
   * }
   */
  const findWorkspaceByName = useCallback(async (name: string): Promise<DatabaseWorkspace | null> => {
    try {
      if (!window.electron) return null;
      
      // Try to load the workspace - it may not exist yet which is fine
      const workspace = unwrapIpc<DatabaseWorkspace | null>(await window.electron.ipcRenderer.invoke('/workspace/load', { id: name }));
      return workspace || null;
    } catch (error) {
      // Log unexpected errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to find workspace '${name}': ${errorMessage}`);
      return null;
    }
  }, []);

  /**
   * Saves or updates a workspace with the given state.
   * Creates new workspace if it doesn't exist, updates if it does.
   * Automatically triggers UI refresh on completion.
   * 
   * @param {string} name - Workspace name (must be unique)
   * @param {WorkspaceState} workspace - Complete workspace state to save
   * @returns {Promise<void>} Promise that resolves when save completes
   * @throws {Error} If Electron IPC unavailable or database operation fails
   * @example
   * await saveWorkspace('my-project', {
   *   selectedFolder: '/path/to/project',
   *   selectedFiles: [{ path: 'src/main.js' }],
   *   expandedNodes: { 'src': true }
   * });
   */
  const saveWorkspace = useCallback(async (name: string, workspace: WorkspaceState): Promise<void> => {
    await runCancellableOperation(async (token) => {
      try {
        safeSetIsLoading(true);
        safeSetError(null);
        
        if (!window.electron) {
          throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
        }

        const existing = await findWorkspaceByName(name);
        
        // Check if cancelled before proceeding
        if (token.cancelled) {
          console.log(`[useDatabaseWorkspaceState] Workspace save cancelled for "${name}"`);
          return;
        }
        
        await (existing
          ? unwrapIpc(await window.electron.ipcRenderer.invoke('/workspace/update', {
              id: existing.id,
              state: workspace
            }))
          : unwrapIpc(await window.electron.ipcRenderer.invoke('/workspace/create', {
              name,
              folderPath: workspace.selectedFolder || '',
              state: workspace
            }))
        );
        
        // Check if cancelled before dispatching event
        if (token.cancelled) {
          console.log(`[useDatabaseWorkspaceState] Workspace save cancelled before dispatch for "${name}"`);
          return;
        }
        
        window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT));
      } catch (error) {
        console.error(`Failed to save workspace '${name}': ${(error as Error).message}`);
        safeSetError(`Failed to save workspace '${name}': ${(error as Error).message}. Check workspace data and database permissions.`);
        throw error;
      } finally {
        safeSetIsLoading(false);
      }
    });
  }, [runCancellableOperation, findWorkspaceByName, safeSetIsLoading, safeSetError]);

  /**
   * Loads workspace state by name and updates last accessed time.
   * Returns null if workspace doesn't exist.
   * 
   * @param {string} name - Workspace name to load
   * @returns {Promise<WorkspaceState | null>} Promise resolving to workspace state or null
   * @throws {Error} If Electron IPC unavailable
   * @example
   * const state = await loadWorkspace('my-project');
   * if (state) {
   *   // Apply state to UI
   *   setSelectedFolder(state.selectedFolder);
   * }
   */
  const loadWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    return await runCancellableOperation(async (token) => {
      try {
        safeSetIsLoading(true);
        safeSetError(null);
        
        if (!window.electron) {
          throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
        }

        // Load the workspace directly - no need to check existence first
        const workspace = unwrapIpc<DatabaseWorkspace | null>(await window.electron.ipcRenderer.invoke('/workspace/load', {
          id: name
        }));
        
        // Check if cancelled before continuing
        if (token.cancelled) {
          console.log(`[useDatabaseWorkspaceState] Workspace load cancelled for "${name}"`);
          return null;
        }
        
        if (!workspace) return null;
        
        // Best-effort: don't surface console errors if touching fails immediately after creation.
        // Try with the incoming id (may be a name), then fall back to the canonical DB id.
        void window.electron.ipcRenderer
          .invoke('/workspace/touch', { id: name }).then(unwrapIpc).catch(() =>
            workspace?.id
              ? window.electron.ipcRenderer.invoke('/workspace/touch', { id: workspace.id }).then(unwrapIpc).catch(() => {
                  // Intentionally empty - best effort workspace touch
                })
              : undefined
          );
        
        // Check again if cancelled before returning
        if (token.cancelled) {
          console.log(`[useDatabaseWorkspaceState] Workspace load cancelled after touch for "${name}"`);
          return null;
        }
        
        // Handle state being either a string or an object
        const state =
          typeof workspace.state === 'string'
            ? JSON.parse(workspace.state)
            : (workspace.state as WorkspaceState);
        
        return state ?? null;
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(`Failed to load workspace '${name}': ${errorMessage}`);
        safeSetError(`Failed to load workspace '${name}': ${errorMessage}. Verify workspace exists and database is accessible.`);
        return null;
      } finally {
        safeSetIsLoading(false);
      }
    });
  }, [runCancellableOperation, safeSetIsLoading, safeSetError]);

  /**
   * Permanently deletes a workspace and all associated data.
   * Triggers UI refresh and emits workspacesChanged event.
   * 
   * @param {string} name - Workspace name to delete
   * @returns {Promise<void>} Promise that resolves when deletion completes
   * @throws {Error} If Electron IPC unavailable or database operation fails
   * @example
   * await deleteWorkspace('old-project');
   * // Workspace is permanently removed
   */
  const deleteWorkspace = useCallback(async (name: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
      }

      const workspace = await findWorkspaceByName(name);
      if (!workspace) {
        console.warn(`Workspace '${name}' not found during delete operation`);
        return;
      }
      
      await unwrapIpc(await window.electron.ipcRenderer.invoke('/workspace/delete', {
        id: workspace.id
      }));
      
      window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to delete workspace '${name}': ${errorMessage}`);
      setError(`Failed to delete workspace '${name}': ${errorMessage}. Check database permissions and workspace references.`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  /**
   * Renames a workspace with validation and conflict detection.
   * New name must be unique across all workspaces.
   * 
   * @param {string} oldName - Current workspace name
   * @param {string} newName - Desired new name (must be unique)
   * @returns {Promise<void>} Promise that resolves when rename completes
   * @throws {Error} If old workspace not found, new name exists, or operation fails
   * @example
   * await renameWorkspace('old-project-name', 'new-project-name');
   */
  const renameWorkspace = useCallback(async (oldName: string, newName: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
      }

      const workspace = await findWorkspaceByName(oldName);
      if (!workspace) {
        throw new Error(`Workspace '${oldName}' not found during rename operation. Verify workspace exists before renaming.`);
      }
      
      await unwrapIpc(await window.electron.ipcRenderer.invoke('/workspace/rename', {
        id: workspace.id,
        newName
      }));
      
      window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to rename workspace '${oldName}' to '${newName}': ${errorMessage}`);
      setError(`Failed to rename workspace '${oldName}' to '${newName}': ${errorMessage}. Check for name conflicts and database permissions.`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  /**
   * Retrieves all workspace names ordered by last access time.
   * Optimized for performance when only names are needed.
   * 
   * @returns {Promise<string[]>} Promise resolving to array of workspace names
   * @example
   * const names = await getWorkspaceNames();
   * // ['recent-project', 'older-project', ...]
   */
  const getWorkspaceNames = useCallback(async (): Promise<string[]> => {
    try {
      if (!window.electron) return [];
      
      const workspaces = unwrapIpc<DatabaseWorkspace[]>(await window.electron.ipcRenderer.invoke('/workspace/list', {}));
      return workspaces.map((w: DatabaseWorkspace) => w.name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to get workspace names: ${errorMessage}`);
      return [];
    }
  }, []);

  /**
   * Imports workspace data from external source (file, backup, etc.).
   * Creates a new workspace with the imported state.
   * 
   * @param {string} name - Name for the imported workspace
   * @param {WorkspaceState} workspaceData - Workspace state to import
   * @returns {Promise<void>} Promise that resolves when import completes
   * @throws {Error} If name conflicts or import operation fails
   * @example
   * const importedData = JSON.parse(backupFileContent);
   * await importWorkspace('imported-project', importedData);
   */
  const importWorkspace = useCallback(async (name: string, workspaceData: WorkspaceState): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
      }

      await unwrapIpc(await window.electron.ipcRenderer.invoke('/workspace/create', {
        name,
        folderPath: workspaceData.selectedFolder || '',
        state: workspaceData
      }));
      
      window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to import workspace '${name}': ${errorMessage}`);
      setError(`Failed to import workspace '${name}': ${errorMessage}. Check workspace data format and database permissions.`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Exports workspace state for backup or sharing purposes.
   * Returns the complete workspace state object.
   * 
   * @param {string} name - Workspace name to export
   * @returns {Promise<WorkspaceState | null>} Promise resolving to workspace state or null
   * @example
   * const exportData = await exportWorkspace('my-project');
   * if (exportData) {
   *   const json = JSON.stringify(exportData, null, 2);
   *   // Save to file or share
   * }
   */
  const exportWorkspace = useCallback(async (name: string): Promise<WorkspaceState | null> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
      }

      const workspace = await findWorkspaceByName(name);
      if (!workspace) return null;
      
      return workspace.state;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to export workspace '${name}': ${errorMessage}`);
      setError(`Failed to export workspace '${name}': ${errorMessage}. Verify workspace exists and is accessible.`);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [findWorkspaceByName]);

  /**
   * Checks if a workspace exists without loading its full data.
   * Efficient method for existence validation.
   * 
   * @param {string} name - Workspace name to check
   * @returns {Promise<boolean>} Promise resolving to true if workspace exists
   * @example
   * if (await doesWorkspaceExist('my-project')) {
   *   console.log('Workspace exists');
   * }
   */
  const doesWorkspaceExist = useCallback(async (name: string): Promise<boolean> => {
    const workspace = await findWorkspaceByName(name);
    return workspace !== null;
  }, [findWorkspaceByName]);

  /**
   * Retrieves workspace creation timestamp.
   * 
   * @param {string} name - Workspace name
   * @returns {Promise<number | null>} Promise resolving to Unix timestamp or null
   * @example
   * const created = await getWorkspaceCreatedTime('my-project');
   * if (created) {
   *   console.log('Created:', new Date(created));
   * }
   */
  const getWorkspaceCreatedTime = useCallback(async (name: string): Promise<number | null> => {
    const workspace = await findWorkspaceByName(name);
    return workspace ? workspace.createdAt : null;
  }, [findWorkspaceByName]);

  /**
   * Retrieves workspace last access timestamp.
   * 
   * @param {string} name - Workspace name
   * @returns {Promise<number | null>} Promise resolving to Unix timestamp or null
   * @example
   * const accessed = await getWorkspaceLastAccessedTime('my-project');
   * console.log('Last used:', new Date(accessed));
   */
  const getWorkspaceLastAccessedTime = useCallback(async (name: string): Promise<number | null> => {
    const workspace = await findWorkspaceByName(name);
    return workspace ? workspace.lastAccessed : null;
  }, [findWorkspaceByName]);

  /**
   * Permanently deletes all workspaces from the database.
   * This operation cannot be undone - use with extreme caution.
   * 
   * @returns {Promise<void>} Promise that resolves when all workspaces are deleted
   * @throws {Error} If database operations fail
   * @example
   * // WARNING: This deletes ALL workspaces permanently
   * await clearAllWorkspaces();
   */
  const clearAllWorkspaces = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!window.electron) {
        throw new Error(ELECTRON_IPC_NOT_AVAILABLE);
      }

      const workspaces = unwrapIpc<DatabaseWorkspace[]>(await window.electron.ipcRenderer.invoke('/workspace/list', {}));
      
      for (const workspace of workspaces) {
        await unwrapIpc(await window.electron.ipcRenderer.invoke('/workspace/delete', {
          id: workspace.id
        }));
      }
      
      window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to clear all workspaces: ${errorMessage}`);
      setError(`Failed to clear all workspaces: ${errorMessage}. Check database permissions and try again.`);
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
