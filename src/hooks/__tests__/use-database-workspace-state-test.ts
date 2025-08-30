import { renderHook, act, waitFor } from '@testing-library/react';

import { useDatabaseWorkspaceState } from '../use-database-workspace-state';
import { WorkspaceState } from '../../types/file-types';

// Test constants
const TEST_WORKSPACE_NAME = 'Test Workspace';
const NON_EXISTENT_WORKSPACE = 'Non-existent';

// Mock electron IPC
const mockInvoke = jest.fn<Promise<unknown>, [string, ...unknown[]]>();
const mockOn = jest.fn<void, [string, (...args: unknown[]) => void]>();
const mockRemoveListener = jest.fn<void, [string, (...args: unknown[]) => void]>();
const mockDispatchEvent = jest.fn<boolean, [Event]>();
const mockAddEventListener = jest.fn<void, [string, EventListener]>();
const mockRemoveEventListener = jest.fn<void, [string, EventListener]>();

// Setup window mocks
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
      removeListener: mockRemoveListener
    }
  },
  writable: true
});

Object.defineProperty(window, 'dispatchEvent', {
  value: mockDispatchEvent,
  writable: true
});

Object.defineProperty(window, 'addEventListener', {
  value: mockAddEventListener,
  writable: true
});

Object.defineProperty(window, 'removeEventListener', {
  value: mockRemoveEventListener,
  writable: true
});

describe('useDatabaseWorkspaceState', () => {
  // Set a reasonable timeout for all tests in this suite
  jest.setTimeout(30000); // 30 seconds should be more than enough

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    mockInvoke.mockResolvedValue([]);
    mockOn.mockImplementation(() => {});
    mockRemoveListener.mockImplementation(() => {});
  });

  const mockWorkspaceState: WorkspaceState = {
    selectedFiles: [{ path: 'file1.txt' }],
    selectedFolder: '/test/folder',
    expandedNodes: { '/test': true },
    sortOrder: 'name',
    searchTerm: '',
    fileTreeMode: 'selected',
    exclusionPatterns: [],
    userInstructions: 'Test instructions',
    tokenCounts: {},
    systemPrompts: [],
    rolePrompts: [],
    savedAt: Date.now()
  };

  const mockDatabaseWorkspace = {
    id: '1',
    name: TEST_WORKSPACE_NAME,
    folderPath: '/test/folder',
    state: mockWorkspaceState,
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 5000,
    lastAccessed: Date.now() - 1000
  };

  describe('Initial State and Setup', () => {
    it('should initialize with empty workspaces list', () => {
      const { result } = renderHook(() => useDatabaseWorkspaceState());

      expect(result.current.workspacesList).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should refresh workspaces list on mount', async () => {
      mockInvoke.mockResolvedValueOnce([mockDatabaseWorkspace]);

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('/workspace/list', {});
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(result.current.workspacesList).toEqual([mockDatabaseWorkspace]);
      }, { timeout: 5000 });
    });

    it('should set up event listener for workspaces changes', () => {
      renderHook(() => useDatabaseWorkspaceState());

      expect(mockAddEventListener).toHaveBeenCalledWith(
        'workspacesChanged',
        expect.objectContaining({}) as EventListener
      );
    });

    it('should clean up event listener on unmount', () => {
      const { unmount } = renderHook(() => useDatabaseWorkspaceState());

      unmount();

      expect(mockRemoveEventListener).toHaveBeenCalledWith(
        'workspacesChanged',
        expect.objectContaining({}) as EventListener
      );
    });
  });

  describe('Workspace Operations', () => {
    it('should save new workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(null) // findWorkspaceByName
        .mockResolvedValueOnce(mockDatabaseWorkspace); // create workspace

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.saveWorkspace('New Workspace', mockWorkspaceState);
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/create', {
        name: 'New Workspace',
        folderPath: '/test/folder',
        state: mockWorkspaceState
      });

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        new CustomEvent('workspacesChanged')
      );
    });

    it('should update existing workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace) // findWorkspaceByName
        .mockResolvedValueOnce(true); // update workspace

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.saveWorkspace('Existing Workspace', mockWorkspaceState);
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/update', {
        id: mockDatabaseWorkspace.id,
        state: mockWorkspaceState
      });
    });

    it('should handle save workspace error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockRejectedValueOnce(new Error('Save failed')); // findWorkspaceByName fails

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        try {
          await result.current.saveWorkspace('Failed Workspace', mockWorkspaceState);
        } catch {
          // Error handling is graceful - hook logs and continues
        }
      });

      // Should have logged the error
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should load workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace) // load workspace
        .mockResolvedValueOnce(true); // touch workspace

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let loadedState: WorkspaceState | null = null;
      await act(async () => {
        loadedState = await result.current.loadWorkspace(TEST_WORKSPACE_NAME);
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/load', {
        id: TEST_WORKSPACE_NAME
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/touch', {
        id: TEST_WORKSPACE_NAME
      });

      expect(loadedState).toEqual(mockWorkspaceState);
    });

    it('should return null when loading non-existent workspace', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(null); // load workspace returns null

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let loadedState: WorkspaceState | null = null;
      await act(async () => {
        loadedState = await result.current.loadWorkspace(NON_EXISTENT_WORKSPACE);
      });

      expect(loadedState).toBeNull();
    });

    it('should handle load workspace error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockRejectedValueOnce(new Error('Load failed')); // load workspace fails

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let loadedState: WorkspaceState | null = null;
      await act(async () => {
        loadedState = await result.current.loadWorkspace('Failed Workspace');
      });

      expect(loadedState).toBeNull();
      expect(result.current.error).toContain('Failed to load workspace');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should delete workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace) // findWorkspaceByName
        .mockResolvedValueOnce(true); // delete workspace

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.deleteWorkspace(TEST_WORKSPACE_NAME);
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/delete', {
        id: mockDatabaseWorkspace.id
      });

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        new CustomEvent('workspacesChanged')
      );
    });

    it('should handle delete non-existent workspace gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(null); // findWorkspaceByName returns null

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.deleteWorkspace(NON_EXISTENT_WORKSPACE);
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workspace')
      );
      
      consoleSpy.mockRestore();
    });

    it('should rename workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace) // findWorkspaceByName
        .mockResolvedValueOnce(true); // rename workspace

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.renameWorkspace('Old Name', 'New Name');
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/rename', {
        id: mockDatabaseWorkspace.id,
        newName: 'New Name'
      });

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        new CustomEvent('workspacesChanged')
      );
    });

    it('should handle rename non-existent workspace error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(null); // findWorkspaceByName returns null

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await expect(
          result.current.renameWorkspace(NON_EXISTENT_WORKSPACE, 'New Name')
        ).rejects.toThrow();
      });

      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Utility Functions', () => {
    it('should get workspace names successfully', async () => {
      const workspaces = [
        { ...mockDatabaseWorkspace, name: 'Workspace 1' },
        { ...mockDatabaseWorkspace, name: 'Workspace 2' }
      ];

      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(workspaces); // getWorkspaceNames

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let names: string[] = [];
      await act(async () => {
        names = await result.current.getWorkspaceNames();
      });

      expect(names).toEqual(['Workspace 1', 'Workspace 2']);
    });

    it('should check if workspace exists', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace); // findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let exists = false;
      await act(async () => {
        exists = await result.current.doesWorkspaceExist(TEST_WORKSPACE_NAME);
      });

      expect(exists).toBe(true);
    });

    it('should check if workspace does not exist', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(null); // findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let exists = true;
      await act(async () => {
        exists = await result.current.doesWorkspaceExist(NON_EXISTENT_WORKSPACE);
      });

      expect(exists).toBe(false);
    });

    it('should get workspace created time', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace); // findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let createdTime: number | null = null;
      await act(async () => {
        createdTime = await result.current.getWorkspaceCreatedTime(TEST_WORKSPACE_NAME);
      });

      expect(createdTime).toBe(mockDatabaseWorkspace.createdAt);
    });

    it('should get workspace last accessed time', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace); // findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let lastAccessed: number | null = null;
      await act(async () => {
        lastAccessed = await result.current.getWorkspaceLastAccessedTime(TEST_WORKSPACE_NAME);
      });

      expect(lastAccessed).toBe(mockDatabaseWorkspace.lastAccessed);
    });
  });

  describe('Import/Export Operations', () => {
    it('should import workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace); // create workspace

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.importWorkspace('Imported Workspace', mockWorkspaceState);
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/create', {
        name: 'Imported Workspace',
        folderPath: '/test/folder',
        state: mockWorkspaceState
      });

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        new CustomEvent('workspacesChanged')
      );
    });

    it('should export workspace successfully', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(mockDatabaseWorkspace); // findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let exportedState: WorkspaceState | null = null;
      await act(async () => {
        exportedState = await result.current.exportWorkspace(TEST_WORKSPACE_NAME);
      });

      expect(exportedState).toEqual(mockWorkspaceState);
    });

    it('should return null when exporting non-existent workspace', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(null); // findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let exportedState: WorkspaceState | null = null;
      await act(async () => {
        exportedState = await result.current.exportWorkspace(NON_EXISTENT_WORKSPACE);
      });

      expect(exportedState).toBeNull();
    });
  });

  describe('Bulk Operations', () => {
    it('should clear all workspaces successfully', async () => {
      const workspaces = [
        { ...mockDatabaseWorkspace, id: '1', name: 'Workspace 1' },
        { ...mockDatabaseWorkspace, id: '2', name: 'Workspace 2' }
      ];

      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockResolvedValueOnce(workspaces) // list workspaces
        .mockResolvedValueOnce(true) // delete workspace 1
        .mockResolvedValueOnce(true); // delete workspace 2

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await act(async () => {
        await result.current.clearAllWorkspaces();
      });

      expect(mockInvoke).toHaveBeenCalledWith('/workspace/delete', { id: '1' });
      expect(mockInvoke).toHaveBeenCalledWith('/workspace/delete', { id: '2' });
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        new CustomEvent('workspacesChanged')
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing electron IPC gracefully', async () => {
      const originalElectron = window.electron;
      // @ts-expect-error - Testing missing electron IPC
      delete window.electron;

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      let names: string[] = [];
      await act(async () => {
        names = await result.current.getWorkspaceNames();
      });

      expect(names).toEqual([]);

      // Restore electron
      window.electron = originalElectron;
    });

    it('should handle IPC errors during refresh', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockInvoke.mockRejectedValueOnce(new Error('IPC Error'));

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      await waitFor(() => {
        expect(result.current.error).toContain('Failed to load workspaces');
      });

      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle concurrent operations gracefully', async () => {
      // Set up mock responses for concurrent operations
      mockInvoke
        .mockResolvedValueOnce([]) // Initial refreshWorkspacesList  
        .mockResolvedValueOnce(null) // findWorkspaceByName for Workspace 1
        .mockResolvedValueOnce(null) // findWorkspaceByName for Workspace 2
        .mockResolvedValueOnce(null) // findWorkspaceByName for Workspace 3
        .mockResolvedValueOnce(mockDatabaseWorkspace) // create Workspace 1
        .mockResolvedValueOnce(mockDatabaseWorkspace) // create Workspace 2
        .mockResolvedValueOnce(mockDatabaseWorkspace); // create Workspace 3

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      // Wait for initial refresh to complete
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('/workspace/list', {});
      }, { timeout: 2000 });

      // Start multiple save operations concurrently
      const promises = [
        result.current.saveWorkspace('Workspace 1', mockWorkspaceState),
        result.current.saveWorkspace('Workspace 2', mockWorkspaceState),
        result.current.saveWorkspace('Workspace 3', mockWorkspaceState)
      ];

      await act(async () => {
        await Promise.all(promises);
      });

      // All operations should complete successfully
      expect(mockInvoke).toHaveBeenCalledTimes(7); // Initial refresh + 3 findWorkspaceByName + 3 create calls
    });
  });

  describe('Loading States', () => {
    it('should set loading state during operations', async () => {
      let resolvePromise: (value: unknown) => void;
      const delayedPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mockInvoke
        .mockResolvedValueOnce([]) // refreshWorkspacesList
        .mockReturnValueOnce(delayedPromise); // slow findWorkspaceByName

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      expect(result.current.isLoading).toBe(false);

      // Start operation
      act(() => {
        result.current.saveWorkspace('Test', mockWorkspaceState);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Complete operation
      act(() => {
        resolvePromise!(null);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Event Handling', () => {
    it('should refresh workspaces when workspacesChanged event is dispatched', async () => {
      mockInvoke
        .mockResolvedValueOnce([]) // initial refresh
        .mockResolvedValueOnce([mockDatabaseWorkspace]); // event triggered refresh

      const { result } = renderHook(() => useDatabaseWorkspaceState());

      // Wait for initial load to complete
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('/workspace/list', {});
      }, { timeout: 5000 });

      // Verify initial state
      expect(result.current.workspacesList).toEqual([]);

      // Get the event handler that was registered
      const eventHandler = mockAddEventListener.mock.calls
        .find(call => call[0] === 'workspacesChanged')?.[1];

      expect(eventHandler).toBeDefined();

      // Trigger the event to cause a refresh
      await act(async () => {
        if (eventHandler) {
          eventHandler(new CustomEvent('workspacesChanged'));
          // Give the async operation time to complete
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      });

      await waitFor(() => {
        expect(result.current.workspacesList).toEqual([mockDatabaseWorkspace]);
      }, { timeout: 5000 });

      expect(mockInvoke).toHaveBeenCalledTimes(2); // Initial + event triggered
    });
  });
});