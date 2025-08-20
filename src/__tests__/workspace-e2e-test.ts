import { act, renderHook } from '@testing-library/react';
import { STORAGE_KEYS } from '@constants';
import useAppState from '../hooks/use-app-state';
import { setupMockLocalStorage, mockDateNow } from './test-helpers';
import { MockAppState, setupWorkspaceTestEnv } from './test-helpers/workspace-mocks';

describe('Workspace End-to-End Tests', () => {
  const originalDispatchEvent = window.dispatchEvent;
  const originalConsoleLog = console.log;
  let testEnv: { cleanup: () => void };

  beforeEach(() => {
    setupMockLocalStorage();
    
    // Mock console.log to reduce test noise
    console.log = jest.fn();
    
    // Setup test environment
    testEnv = setupWorkspaceTestEnv();
    
    // Add event listeners for custom events
    document.addEventListener('workspacesChanged', () => {
      // This is needed to simulate event propagation without the real DOM
    });
    document.addEventListener('createNewWorkspace', () => {
      // This is needed to simulate event propagation without the real DOM
    });
  });

  afterEach(() => {
    testEnv.cleanup();
    window.dispatchEvent = originalDispatchEvent;
    console.log = originalConsoleLog;
    jest.clearAllMocks();
  });

  // Helper to create an app with test state
  const setupAppWithTestState = () => {
    const { result, rerender } = renderHook(() => useAppState());
    
    // Cast to proper type instead of any
    const appState = result.current as unknown as MockAppState;
    
    return { result, rerender, appState };
  };

  describe('Workspace Creation', () => {
    test('should create and save a new workspace', () => {
      // Setup
      const { appState } = setupAppWithTestState();
      
      // Step 1: Set up workspace data
      act(() => {
        appState.setSelectedFolder('/test/project');
        
        // Add and select some files
        const mockFiles = [
          { path: 'src/index.ts', content: 'console.log("Hello")' }
        ];
        
        appState.fileSelection.setSelectedFiles(mockFiles);
        appState.setUserInstructions('Test instructions');
      });
      
      // Step 2: Save the workspace
      act(() => {
        appState.saveWorkspace('test-workspace-1');
      });
      
      // Verify workspace was saved
      expect(appState.currentWorkspace).toBe('test-workspace-1');
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('test-workspace-1');
      
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(workspaces)).toContain('test-workspace-1');
    });
    
    test('should create a new workspace when createNewWorkspace event is dispatched', () => {
      // Setup 
      const { appState } = setupAppWithTestState();
      
      // First save a workspace
      act(() => {
        appState.setSelectedFolder('/some/folder');
        appState.saveWorkspace('existing-workspace');
      });
      
      // Verify workspace was saved
      expect(appState.currentWorkspace).toBe('existing-workspace');
      
      // Dispatch createNewWorkspace event
      act(() => {
        document.dispatchEvent(new Event('createNewWorkspace'));
      });
      
      // Verify workspace was cleared
      expect(appState.currentWorkspace).toBeNull();
      expect(appState.handleResetFolderState).toHaveBeenCalled();
    });
  });

  describe('Workspace Loading', () => {
    test('should load an existing workspace', () => {
      // Setup
      const { appState, rerender } = setupAppWithTestState();
      
      // First save a workspace
      act(() => {
        appState.setSelectedFolder('/test/project');
        appState.fileSelection.setSelectedFiles([
          { path: 'src/index.ts', content: 'console.log("Hello")' }
        ]);
        appState.setUserInstructions('Test instructions');
        appState.saveWorkspace('test-workspace');
      });
      
      // Create a second workspace
      act(() => {
        appState.setSelectedFolder('/different/project');
        appState.fileSelection.setSelectedFiles([
          { path: 'app/main.js', content: 'alert("Different")' }
        ]);
        appState.setUserInstructions('Different instructions');
        appState.saveWorkspace('different-workspace');
      });
      
      // Load the first workspace
      act(() => {
        appState.loadWorkspace('test-workspace');
      });
      
      rerender(); // Force rerender to apply state changes
      
      // Verify first workspace is loaded
      expect(appState.currentWorkspace).toBe('test-workspace');
      expect(appState.selectedFolder).toBe('/test/project');
      expect(appState.userInstructions).toBe('Test instructions');
    });
    
    test('should handle corrupted workspace data', () => {
      // Setup - manually create corrupted workspace data
      const workspaces = {
        'valid-workspace': JSON.stringify({ 
          fileTreeState: {}, 
          selectedFiles: [], 
          selectedFolder: '/test', 
          userInstructions: 'valid', 
          tokenCounts: { total: 0 },
          customPrompts: {
            systemPrompts: [],
            rolePrompts: []
          },
          savedAt: Date.now() 
        }),
        'corrupted-workspace': '{ invalid json' // Invalid JSON
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'corrupted-workspace');
      
      // Try to load the corrupted workspace
      const { appState } = setupAppWithTestState();
      
      act(() => {
        appState.loadWorkspace('corrupted-workspace');
      });
      
      // Verify corrupted workspace was deleted
      const updatedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(updatedWorkspaces)).not.toContain('corrupted-workspace');
      
      // Verify current workspace was cleared
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBeNull();
    });
  });

  describe('Workspace Management', () => {
    test('should rename a workspace', () => {
      // Setup
      const { result } = renderHook(() => useAppState());
      
      // First save a workspace
      act(() => {
        result.current.saveWorkspace('old-name');
      });
      
      // Import the real workspace state hook
      const { useWorkspaceState } = require('../hooks/use-workspace-state');
      const { result: workspaceHookResult } = renderHook(() => useWorkspaceState());
      
      // Rename the workspace
      act(() => {
        const success = workspaceHookResult.current.renameWorkspace(
          'old-name', 
          'renamed-workspace'
        );
        expect(success).toBe(true);
      });
      
      // Verify workspace was renamed
      const workspacesAfterRename = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(workspacesAfterRename)).not.toContain('old-name');
      expect(Object.keys(workspacesAfterRename)).toContain('renamed-workspace');
      
      // Verify current workspace is updated
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('renamed-workspace');
    });
    
    test('should delete a workspace', () => {
      // Setup
      const { result } = renderHook(() => useAppState());
      
      // First save a workspace
      act(() => {
        result.current.saveWorkspace('to-delete');
      });
      
      // Get the workspace state hook
      const { useWorkspaceState } = require('../hooks/use-workspace-state');
      const { result: workspaceHookResult } = renderHook(() => useWorkspaceState());
      
      // Delete the workspace
      act(() => {
        workspaceHookResult.current.deleteWorkspace('to-delete');
      });
      
      // Verify workspace was deleted
      const workspacesAfterDelete = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(workspacesAfterDelete)).not.toContain('to-delete');
    });
    
    test('should order workspaces by timestamp (newest first)', () => {
      // Setup
      const { useWorkspaceState } = require('../hooks/use-workspace-state');
      const { result: workspaceHookResult } = renderHook(() => useWorkspaceState());
      const { result } = renderHook(() => useAppState());
      
      // Create workspaces with different timestamps
      act(() => {
        // Set oldest timestamp
        const cleanupDateMock1 = mockDateNow(Date.now());
        result.current.saveWorkspace('oldest-workspace');
        cleanupDateMock1();
        
        // Set middle timestamp
        const cleanupDateMock2 = mockDateNow(Date.now() + 5000);
        result.current.saveWorkspace('middle-workspace');
        cleanupDateMock2();
        
        // Set newest timestamp
        const cleanupDateMock3 = mockDateNow(Date.now() + 10000);
        result.current.saveWorkspace('newest-workspace');
        cleanupDateMock3();
      });
      
      // Get workspace names in sorted order
      let sortedNames: string[] = [];
      act(() => {
        sortedNames = workspaceHookResult.current.getWorkspaceNames();
      });
      
      // Verify order (newest first)
      expect(sortedNames[0]).toBe('newest-workspace');
      expect(sortedNames[1]).toBe('middle-workspace');
      expect(sortedNames[2]).toBe('oldest-workspace');
    });
  });

  describe('Workspace Persistence', () => {
    test('should persist workspace state across app reloads', async () => {
      // Setup - save a workspace first
      const { result: initialResult } = renderHook(() => useAppState());
      
      // Configure the workspace
      act(() => {
        // Type assertion with proper interface instead of any
        const appState = initialResult.current as unknown as MockAppState;
        
        appState.setSelectedFolder('/persistence/test');
        appState.fileSelection.setSelectedFiles([
          { path: 'persistence.ts', content: 'test content' }
        ]);
        appState.setUserInstructions('Persistence instructions');
        
        // Save the workspace
        appState.saveWorkspace('persistence-test');
      });
      
      // Verify current workspace is set
      expect(initialResult.current.currentWorkspace).toBe('persistence-test');
      
      // Simulate app reload by creating new hook instance
      const { result: reloadedResult } = renderHook(() => useAppState());
      const reloadedAppState = reloadedResult.current as unknown as MockAppState;
      
      // Verify state restored correctly
      expect(reloadedAppState.currentWorkspace).toBe('persistence-test');
      expect(reloadedAppState.selectedFolder).toBe('/persistence/test');
      expect(reloadedAppState.fileSelection.selectedFiles[0].path).toBe('persistence.ts');
    });
    
    test('should handle missing current workspace gracefully', () => {
      // Setup - save a workspace but set current to non-existent
      const { result: initialResult } = renderHook(() => useAppState());
      
      act(() => {
        initialResult.current.saveWorkspace('existing-workspace');
        // Set current workspace to non-existent
        localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'non-existent');
      });
      
      // Reload app
      const { result: reloadedResult } = renderHook(() => useAppState());
      
      // Expect current workspace to be restored but state to be fresh
      expect(reloadedResult.current.currentWorkspace).toBe('non-existent');
      expect(reloadedResult.current.selectedFolder).toBeNull();
    });
  });
}); 