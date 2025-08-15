import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '../constants';
import { useWorkspaceState } from '../hooks/use-workspace-state';
import { setupMockLocalStorage, mockDateNow } from './test-helpers';
import { WorkspaceState } from '../types/file-types';

describe('useWorkspaceState hook', () => {
  beforeEach(() => {
    setupMockLocalStorage();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('saveWorkspace', () => {
    test('should save workspace data with timestamp', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: { 'src': true },
        selectedFiles: [{ path: 'src/file.ts' }],
        selectedFolder: '/test/folder',
        userInstructions: 'test instructions',
        tokenCounts: { 'src/file.ts': 100 },
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        allFiles: [],
        sortOrder: 'name-asc',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        savedAt: 0 // Will be overwritten
      };

      // Mock current time
      const mockTime = 1617235200000; // April 1, 2021
      const cleanupDateMock = mockDateNow(mockTime);

      // Execute
      await act(async () => {
        await result.current.saveWorkspace('test-workspace', workspaceData);
      });

      // Verify
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      const savedWorkspace = workspaces['test-workspace'];
      
      expect(savedWorkspace).toBeDefined();
      expect(savedWorkspace.selectedFolder).toBe('/test/folder');
      expect(savedWorkspace.userInstructions).toBe('test instructions');
      expect(savedWorkspace.tokenCounts['src/file.ts']).toBe(100);
      expect(savedWorkspace.savedAt).toBe(mockTime);

      // Cleanup
      cleanupDateMock();
    });

    test('should update workspace names list', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: {},
        selectedFiles: [],
        selectedFolder: '/test',
        userInstructions: '',
        tokenCounts: {},
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        allFiles: [],
        sortOrder: 'name-asc',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        savedAt: Date.now()
      };

      // Execute
      await act(async () => {
        await result.current.saveWorkspace('workspace1', workspaceData);
        await result.current.saveWorkspace('workspace2', {...workspaceData, selectedFolder: '/test2'});
      });

      // Verify
      const workspaceNames = await result.current.getWorkspaceNames();
      expect(workspaceNames).toContain('workspace1');
      expect(workspaceNames).toContain('workspace2');
    });
  });

  describe('loadWorkspace', () => {
    test('should return workspace data when valid', async () => {
      // Setup - save a workspace first
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: { 'src': true },
        selectedFiles: [{ path: 'src/file.ts' }],
        selectedFolder: '/valid/test',
        allFiles: [],
        sortOrder: 'alphabetical',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        userInstructions: 'valid test',
        tokenCounts: { 'src/file.ts': 200 },
        customPrompts: {
          systemPrompts: [{ id: '1', name: 'Test Prompt', content: 'Test Content' }],
          rolePrompts: []
        },
        savedAt: 1617235200000
      };

      await act(async () => {
        await result.current.saveWorkspace('valid-workspace', workspaceData);
      });

      // Execute
      let loadedWorkspace: WorkspaceState | null = null;
      await act(async () => {
        loadedWorkspace = await result.current.loadWorkspace('valid-workspace');
      });

      // Verify
      expect(loadedWorkspace).not.toBeNull();
      if (loadedWorkspace) {
        const workspace = loadedWorkspace as WorkspaceState;
        expect(workspace.selectedFolder).toBe('/valid/test');
        expect(workspace.userInstructions).toBe('valid test');
        expect(workspace.tokenCounts['src/file.ts']).toBe(200);
        expect(workspace.customPrompts.systemPrompts).toHaveLength(1);
        expect(workspace.customPrompts.systemPrompts[0].name).toBe('Test Prompt');
      }
    });

    test('should return null when workspace not found', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());

      // Execute
      let loadedWorkspace: WorkspaceState | null = null;
      await act(async () => {
        loadedWorkspace = await result.current.loadWorkspace('non-existent-workspace');
      });

      // Verify
      expect(loadedWorkspace).toBeNull();
    });

    test('should handle corrupted workspace data', async () => {
      // Setup - manually create corrupted workspace data
      const workspaces = { 'corrupted-workspace': '{ invalid json' };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'corrupted-workspace');

      const { result } = renderHook(() => useWorkspaceState());

      // Execute
      let loadedWorkspace: WorkspaceState | null = null;
      await act(async () => {
        loadedWorkspace = await result.current.loadWorkspace('corrupted-workspace');
      });

      // Verify
      expect(loadedWorkspace).toBeNull();
      // Should auto-delete the corrupted workspace
      const remainingWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(remainingWorkspaces['corrupted-workspace']).toBeUndefined();
      // Current workspace setting should be cleared
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBeNull();
    });
  });

  describe('deleteWorkspace', () => {
    test('should delete workspace and update list', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: {},
        selectedFiles: [],
        selectedFolder: '/delete-test',
        userInstructions: '',
        tokenCounts: {},
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        allFiles: [],
        sortOrder: 'name-asc',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        savedAt: Date.now()
      };

      await act(async () => {
        await result.current.saveWorkspace('to-delete', workspaceData);
      });

      // Verify workspace exists
      let exists = await result.current.doesWorkspaceExist('to-delete');
      expect(exists).toBe(true);

      // Execute
      await act(async () => {
        await result.current.deleteWorkspace('to-delete');
      });

      // Verify
      exists = await result.current.doesWorkspaceExist('to-delete');
      expect(exists).toBe(false);
      const workspaceNames = await result.current.getWorkspaceNames();
      expect(workspaceNames).not.toContain('to-delete');
    });
  });

  describe('doesWorkspaceExist', () => {
    test('should return true for existing workspace', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: {},
        selectedFiles: [],
        selectedFolder: '/test',
        userInstructions: '',
        tokenCounts: {},
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        allFiles: [],
        sortOrder: 'name-asc',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        savedAt: Date.now()
      };

      await act(async () => {
        await result.current.saveWorkspace('existing-workspace', workspaceData);
      });

      // Execute
      let exists = false;
      await act(async () => {
        exists = await result.current.doesWorkspaceExist('existing-workspace');
      });

      // Verify
      expect(exists).toBe(true);
    });

    test('should return false for non-existing workspace', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());

      // Execute
      let exists = true;
      await act(async () => {
        exists = await result.current.doesWorkspaceExist('non-existing');
      });

      // Verify
      expect(exists).toBe(false);
    });
  });

  describe('getWorkspaceNames', () => {
    test('should return sorted workspace names', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());
      const baseWorkspace: WorkspaceState = {
        expandedNodes: {},
        selectedFiles: [],
        selectedFolder: '/test',
        userInstructions: '',
        tokenCounts: {},
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        allFiles: [],
        sortOrder: 'name-asc',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        savedAt: Date.now()
      };

      // Save workspaces with different timestamps
      await act(async () => {
        await result.current.saveWorkspace('workspace1', baseWorkspace);
        await result.current.saveWorkspace('workspace2', {...baseWorkspace, selectedFolder: '/test2'});
        await result.current.saveWorkspace('workspace3', {...baseWorkspace, selectedFolder: '/test3'});
      });

      // Execute
      let workspaceNames: string[] = [];
      await act(async () => {
        workspaceNames = await result.current.getWorkspaceNames();
      });

      // Verify
      expect(workspaceNames).toHaveLength(3);
      expect(workspaceNames).toContain('workspace1');
      expect(workspaceNames).toContain('workspace2');
      expect(workspaceNames).toContain('workspace3');
    });

    test('should return empty array when no workspaces', async () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());

      // Execute
      let workspaceNames: string[] = [];
      await act(async () => {
        workspaceNames = await result.current.getWorkspaceNames();
      });

      // Verify
      expect(workspaceNames).toEqual([]);
    });
  });
});