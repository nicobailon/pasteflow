import { useCallback } from 'react';

import { STORAGE_KEYS } from '../constants';
import { WorkspaceState } from '../types/file-types';
import { getPathValidator } from '../security/path-validator';
import { safeJsonParse } from '../utils/local-storage-utils';

type WorkspacesRecord = Record<string, WorkspaceState | string>;

export const useWorkspaceState = () => {
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
      
      const workspaces = safeJsonParse<WorkspacesRecord>(localStorage.getItem(STORAGE_KEYS.WORKSPACES), {});
      // Add timestamp before saving
      const workspaceWithTimestamp = { ...workspace, savedAt: Date.now() };
      workspaces[name] = workspaceWithTimestamp;
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      throw error;
    }
  }, []);

  const loadWorkspace = useCallback((name: string): WorkspaceState | null => {
    try {
      let workspacesString;
      try {
        workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES);
      } catch (error) {
        return null;
      }

      const workspaces = safeJsonParse<WorkspacesRecord>(workspacesString, {});
      if (!workspaces[name]) {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        return null;
      }

      // REMOVED: localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      // The application state (useAppState) should manage which workspace is currently active in the UI.
      // This hook is only responsible for retrieving the data from storage.

      const workspaceData = workspaces[name];
      try {
        if (typeof workspaceData === 'string') {
          // Handle legacy double-serialized data
          const parsedWorkspace = safeJsonParse(workspaceData, null);
          return parsedWorkspace;
        } else if (typeof workspaceData === 'object' && workspaceData !== null) {
          // Handle new direct object storage
          return workspaceData;
        } else {
             delete workspaces[name];
             localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
             localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
             window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { deleted: name, wasCurrent: true, wasCorrupted: true } }));
             return null;
        }
      } catch (parseError) {
        delete workspaces[name];
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { deleted: name, wasCurrent: true, wasCorrupted: true } }));
        return null;
      }
    } catch (error) {
      return null;
    }
  }, []);

  const deleteWorkspace = useCallback((name: string) => {
    try {
      const workspaces = safeJsonParse<WorkspacesRecord>(localStorage.getItem(STORAGE_KEYS.WORKSPACES), {});
      let wasCurrent = false;

      if (workspaces[name]) {
        delete workspaces[name];
        const currentWorkspace = localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        if (currentWorkspace === name) {
          localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
          wasCurrent = true;
        }
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
        window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { deleted: name, wasCurrent } }));
      }
    } catch (error) {
      // Silent fail
    }
  }, []);

  const renameWorkspace = useCallback((oldName: string, newName: string): boolean => {
    if (!newName || oldName === newName) {
      return false;
    }
    try {
      const workspaces = safeJsonParse<WorkspacesRecord>(localStorage.getItem(STORAGE_KEYS.WORKSPACES), {});

      if (!workspaces[oldName]) {
        return false;
      }
      if (workspaces[newName]) {
        // Optionally, prompt user or handle differently
        return false;
      }

      // Copy data and delete old entry
      workspaces[newName] = workspaces[oldName];
      delete workspaces[oldName];

      // Update current workspace if it was the one renamed
      const currentWorkspace = localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE);
      let wasCurrent = false;
      if (currentWorkspace === oldName) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, newName);
        wasCurrent = true;
      }

      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { renamed: { oldName, newName }, wasCurrent } }));
      return true;
    } catch (error) {
      return false;
    }
  }, []);

  const getWorkspaceNames = useCallback((): string[] => {
    try {
      const workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}';
      const workspaces = safeJsonParse<WorkspacesRecord>(workspacesString, {});

      // Get entries, parse data, sort by savedAt (descending), return names
      // Extract just the names
      return Object.entries(workspaces)
        .map(([name, dataValue]) => {
          try {
            let data: WorkspaceState | null;
            if (typeof dataValue === 'string') {
              // Handle legacy double-serialized data
              data = safeJsonParse<WorkspaceState | null>(dataValue, null);
            } else if (typeof dataValue === 'object' && dataValue !== null) {
              // Handle new direct object storage
              data = dataValue as WorkspaceState;
            } else {
              return { name, savedAt: 0 }; // Treat as oldest if invalid
            }
            
            if (!data) {
              return { name, savedAt: 0 }; // Treat as oldest if data is null
            }
            
            // Use savedAt, default to 0 if missing for older workspaces
            return { name, savedAt: data.savedAt || 0 }; 
          } catch (parseError) {
            return { name, savedAt: 0 }; // Treat as oldest if parsing fails
          }
        })
        .sort((a, b) => b.savedAt - a.savedAt) // Sort descending (newest first)
        .map(item => item.name);
    } catch (error) {
      return [];
    }
  }, []);

  return { saveWorkspace, loadWorkspace, deleteWorkspace, renameWorkspace, getWorkspaceNames };
};
