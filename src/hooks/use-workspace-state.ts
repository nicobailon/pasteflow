import { STORAGE_KEYS } from '../constants';
import { WorkspaceState } from '../types/file-types';
import { useCallback } from 'react';

export const useWorkspaceState = () => {
  const saveWorkspace = useCallback((name: string, workspace: WorkspaceState) => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    workspaces[name] = JSON.stringify(workspace);
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    
    // Set as current workspace
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
  }, []);

  const loadWorkspace = useCallback((name: string) => {
    const workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES);
    
    try {
      const workspaces = JSON.parse(workspacesString || '{}');
      
      if (!workspaces[name]) {
        console.error(`Workspace "${name}" not found`);
        return null;
      }
      
      // Set current workspace name
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      
      const specificWorkspaceString = workspaces[name];
      
      // If it's already an object, return it directly
      if (typeof specificWorkspaceString === 'object' && specificWorkspaceString !== null) {
        return specificWorkspaceString;
      }
      
      try {
        return JSON.parse(specificWorkspaceString);
      } catch (parseError) {
        console.error(`Failed to parse data for workspace "${name}". Data may be corrupted.`, { storedValue: specificWorkspaceString, error: parseError });
        return null;
      }
    } catch (error) {
      console.error("Failed to parse the main workspaces object from localStorage.", { error });
      return null;
    }
  }, []);

  const deleteWorkspace = useCallback((name: string) => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    delete workspaces[name];
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
  }, []);

  const getWorkspaceNames = useCallback(() => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    return Object.keys(workspaces);
  }, []);

  return { saveWorkspace, loadWorkspace, deleteWorkspace, getWorkspaceNames };
};
