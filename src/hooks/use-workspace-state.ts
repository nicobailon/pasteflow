import { useCallback } from 'react';

import { STORAGE_KEYS } from '../constants';
import { WorkspaceState } from '../types/file-types';
import { getPathValidator } from '../security/path-validator.ts';

export const useWorkspaceState = () => {
  const saveWorkspace = useCallback((name: string, workspace: WorkspaceState) => {
    try {
      console.log(`[useWorkspaceState.saveWorkspace] Attempting to save workspace: ${name}`);
      
      // Validate the workspace folder path if it exists
      if (workspace.selectedFolder) {
        const validator = getPathValidator();
        const validation = validator.validatePath(workspace.selectedFolder);
        
        if (!validation.valid) {
          console.error(`[useWorkspaceState.saveWorkspace] Invalid path in workspace: ${validation.reason}`);
          throw new Error(`Cannot save workspace with invalid path: ${validation.reason}`);
        }
        
        // Update workspace with sanitized path
        workspace = {
          ...workspace,
          selectedFolder: validation.sanitizedPath || workspace.selectedFolder
        };
      }
      
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      // Add timestamp before saving
      const workspaceWithTimestamp = { ...workspace, savedAt: Date.now() };
      workspaces[name] = workspaceWithTimestamp;
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      console.log(`[useWorkspaceState.saveWorkspace] Successfully saved workspace "${name}" and set as current.`);
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    } catch (error) {
      console.error(`[useWorkspaceState.saveWorkspace] Failed to save workspace "${name}":`, error);
    }
  }, []);

  const loadWorkspace = useCallback((name: string): WorkspaceState | null => {
    console.log(`[useWorkspaceState.loadWorkspace] Attempting to load workspace: ${name}`);
    try {
      let workspacesString;
      try {
        workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES);
      } catch (error) {
        console.error(`[useWorkspaceState.loadWorkspace] Failed to get workspaces string from localStorage:`, error);
        return null;
      }

      const workspaces = JSON.parse(workspacesString || '{}');
      if (!workspaces[name]) {
        console.error(`[useWorkspaceState.loadWorkspace] Workspace "${name}" not found in stored workspaces.`);
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        return null;
      }

      // REMOVED: localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      // The application state (useAppState) should manage which workspace is currently active in the UI.
      // This hook is only responsible for retrieving the data from storage.
      console.log(`[useWorkspaceState.loadWorkspace] Found workspace data for "${name}" in localStorage.`);

      const workspaceData = workspaces[name];
      try {
        if (typeof workspaceData === 'string') {
          // Handle legacy double-serialized data
          const parsedWorkspace = JSON.parse(workspaceData);
          console.log(`[useWorkspaceState.loadWorkspace] Successfully parsed legacy workspace "${name}".`);
          return parsedWorkspace;
        } else if (typeof workspaceData === 'object' && workspaceData !== null) {
          // Handle new direct object storage
          console.log(`[useWorkspaceState.loadWorkspace] Successfully loaded workspace "${name}".`);
          return workspaceData;
        } else {
             console.error(`[useWorkspaceState.loadWorkspace] Workspace data for "${name}" has invalid type:`, workspaceData);
             console.log(`[useWorkspaceState.loadWorkspace] Auto-deleting corrupted workspace: "${name}"`);
             delete workspaces[name];
             localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
             localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
             window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { deleted: name, wasCurrent: true, wasCorrupted: true } }));
             return null;
        }
      } catch (parseError) {
        console.error(`[useWorkspaceState.loadWorkspace] Failed to parse workspace data for "${name}":`, parseError, { storedValue: workspaceData });
        console.log(`[useWorkspaceState.loadWorkspace] Auto-deleting corrupted workspace: "${name}"`);
        delete workspaces[name];
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { deleted: name, wasCurrent: true, wasCorrupted: true } }));
        return null;
      }
    } catch (error) {
      console.error(`[useWorkspaceState.loadWorkspace] General error loading workspace "${name}":`, error);
      return null;
    }
  }, []);

  const deleteWorkspace = useCallback((name: string) => {
    try {
      console.log(`[useWorkspaceState.deleteWorkspace] Attempting to delete workspace: ${name}`);
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      let wasCurrent = false;

      if (workspaces[name]) {
        delete workspaces[name];
        const currentWorkspace = localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        if (currentWorkspace === name) {
          localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
          wasCurrent = true;
          console.log(`[useWorkspaceState.deleteWorkspace] Removed current workspace setting for deleted workspace "${name}".`);
        }
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
        console.log(`[useWorkspaceState.deleteWorkspace] Successfully deleted workspace "${name}".`);
        window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { deleted: name, wasCurrent } }));
      } else {
        console.warn(`[useWorkspaceState.deleteWorkspace] Workspace "${name}" not found for deletion.`);
      }
    } catch (error) {
      console.error(`[useWorkspaceState.deleteWorkspace] Failed to delete workspace "${name}":`, error);
    }
  }, []);

  const renameWorkspace = useCallback((oldName: string, newName: string): boolean => {
    if (!newName || oldName === newName) {
      console.warn(`[useWorkspaceState.renameWorkspace] Invalid new name or names are the same: "${oldName}" -> "${newName}"`);
      return false;
    }
    try {
      console.log(`[useWorkspaceState.renameWorkspace] Attempting to rename workspace: "${oldName}" to "${newName}"`);
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');

      if (!workspaces[oldName]) {
        console.error(`[useWorkspaceState.renameWorkspace] Workspace "${oldName}" not found for renaming.`);
        return false;
      }
      if (workspaces[newName]) {
        console.error(`[useWorkspaceState.renameWorkspace] Workspace name "${newName}" already exists.`);
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
        console.log(`[useWorkspaceState.renameWorkspace] Updated current workspace from "${oldName}" to "${newName}".`);
      }

      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      console.log(`[useWorkspaceState.renameWorkspace] Successfully renamed workspace "${oldName}" to "${newName}".`);
      window.dispatchEvent(new CustomEvent('workspacesChanged', { detail: { renamed: { oldName, newName }, wasCurrent } }));
      return true;
    } catch (error) {
      console.error(`[useWorkspaceState.renameWorkspace] Failed to rename workspace "${oldName}" to "${newName}":`, error);
      return false;
    }
  }, []);

  const getWorkspaceNames = useCallback((): string[] => {
    try {
      const workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}';
      const workspaces = JSON.parse(workspacesString);

      // Get entries, parse data, sort by savedAt (descending), return names
      // Extract just the names
      return Object.entries(workspaces)
        .map(([name, dataValue]) => {
          try {
            let data: WorkspaceState;
            if (typeof dataValue === 'string') {
              // Handle legacy double-serialized data
              data = JSON.parse(dataValue);
            } else if (typeof dataValue === 'object' && dataValue !== null) {
              // Handle new direct object storage
              data = dataValue as WorkspaceState;
            } else {
              console.warn(`[useWorkspaceState.getWorkspaceNames] Invalid data type for workspace "${name}", skipping.`);
              return { name, savedAt: 0 }; // Treat as oldest if invalid
            }
            // Use savedAt, default to 0 if missing for older workspaces
            return { name, savedAt: data.savedAt || 0 }; 
          } catch (parseError) {
            console.error(`[useWorkspaceState.getWorkspaceNames] Failed to parse data for workspace "${name}", treating as oldest:`, parseError);
            return { name, savedAt: 0 }; // Treat as oldest if parsing fails
          }
        })
        .sort((a, b) => b.savedAt - a.savedAt) // Sort descending (newest first)
        .map(item => item.name);
    } catch (error) {
      console.error(`[useWorkspaceState.getWorkspaceNames] Failed to get and sort workspace names:`, error);
      return [];
    }
  }, []);

  return { saveWorkspace, loadWorkspace, deleteWorkspace, renameWorkspace, getWorkspaceNames };
};
