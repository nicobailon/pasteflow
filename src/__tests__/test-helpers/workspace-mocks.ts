import { STORAGE_KEYS } from '@constants';
import { WorkspaceState, SelectedFileWithLines } from '../../types/file-types';

// Mock useWorkspaceState hook
export const mockUseWorkspaceState = () => {
  return {
    saveWorkspace: jest.fn().mockImplementation((name, data: WorkspaceState) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      workspaces[name] = JSON.stringify({ ...data, savedAt: Date.now() });
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      return true;
    }),
    loadWorkspace: jest.fn().mockImplementation((name) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      if (!workspaces[name]) return null;
      try {
        return JSON.parse(workspaces[name]);
      } catch (e) {
        // Handle corrupt data
        const updatedWorkspaces = { ...workspaces };
        delete updatedWorkspaces[name];
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
        return null;
      }
    }),
    deleteWorkspace: jest.fn().mockImplementation((name) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      const wasCurrent = localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE) === name;
      
      delete workspaces[name];
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      
      if (wasCurrent) {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
      }
      
      window.dispatchEvent(new CustomEvent('workspacesChanged', {
        detail: { deleted: name, wasCurrent }
      }));
      
      return true;
    }),
    renameWorkspace: jest.fn().mockImplementation((oldName, newName) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      if (workspaces[newName]) return false;
      
      workspaces[newName] = workspaces[oldName];
      delete workspaces[oldName];
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      
      if (localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE) === oldName) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, newName);
      }
      
      return true;
    }),
    getWorkspaceNames: jest.fn().mockImplementation(() => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      return Object.keys(workspaces);
    })
  };
};

// Mock useAppState hook with properly typed return
export interface MockAppState {
  selectedFolder: string | null;
  fileSelection: {
    selectedFiles: SelectedFileWithLines[];
    setSelectedFiles: jest.Mock;
  };
  expandedNodes: Record<string, boolean>;
  userInstructions: string;
  currentWorkspace: string | null;
  setCurrentWorkspace: jest.Mock;
  loadWorkspace: jest.Mock;
  saveWorkspace: jest.Mock;
  handleResetFolderState: jest.Mock;
  setHeaderSaveState: jest.Mock;
  headerSaveState: 'idle' | 'saving' | 'success' | 'error';
  setSelectedFolder: jest.Mock;
  setUserInstructions: jest.Mock;
  appInitialized: boolean;
  setAppInitialized: jest.Mock;
  setPendingWorkspaceData: jest.Mock;
}

export const mockUseAppState = (): MockAppState => {
  return {
    selectedFolder: '/test/folder',
    fileSelection: {
      selectedFiles: [{ path: 'test.ts', content: 'test content' }] as SelectedFileWithLines[],
      setSelectedFiles: jest.fn()
    },
    expandedNodes: { 'src': true },
    userInstructions: 'test instructions',
    currentWorkspace: localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE),
    setCurrentWorkspace: jest.fn().mockImplementation((name) => {
      if (name === null) {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE);
      } else {
        localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      }
    }),
    loadWorkspace: jest.fn().mockImplementation((name) => {
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    }),
    saveWorkspace: jest.fn().mockImplementation((name) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      workspaces[name] = JSON.stringify({ name, savedAt: Date.now() });
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
    }),
    handleResetFolderState: jest.fn(),
    setHeaderSaveState: jest.fn(),
    headerSaveState: 'idle',
    setSelectedFolder: jest.fn(),
    setUserInstructions: jest.fn(),
    appInitialized: true,
    setAppInitialized: jest.fn(),
    setPendingWorkspaceData: jest.fn()
  };
};

// Setup common test environment
export const setupWorkspaceTestEnv = () => {
  // Mock event methods
  const originalDispatchEvent = window.dispatchEvent;
  window.dispatchEvent = jest.fn().mockImplementation((event) => {
    // Simulate event propagation for specific events
    if (event.type === 'createNewWorkspace' || event.type === 'workspacesChanged') {
      document.dispatchEvent(event);
    }
    return true;
  });
  
  // Mock CustomEvent constructor
  window.CustomEvent = jest.fn().mockImplementation((type, options) => ({
    type,
    detail: options?.detail
  }));
  
  return {
    cleanup: () => {
      window.dispatchEvent = originalDispatchEvent;
    }
  };
}; 