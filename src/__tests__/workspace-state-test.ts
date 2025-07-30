import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '../constants';
import { useWorkspaceState } from '../hooks/use-workspace-state';
import { setupMockLocalStorage, mockDateNow } from './test-helpers';
import { WorkspaceState } from '../types/file-types';

describe('useWorkspaceState hook', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    // Mock window.dispatchEvent
    window.dispatchEvent = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('saveWorkspace', () => {
    test('should save workspace data with timestamp', () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: { 'src': true },
        selectedFiles: [{ path: 'src/file.ts', content: 'test' }],
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
      act(() => {
        result.current.saveWorkspace('test-workspace', workspaceData);
      });

      // Verify
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      const savedWorkspace = workspaces['test-workspace'];
      
      expect(savedWorkspace.savedAt).toBe(mockTime);
      expect(savedWorkspace.selectedFolder).toBe('/test/folder');
      expect(savedWorkspace.userInstructions).toBe('test instructions');

      // Cleanup
      cleanupDateMock();
    });

    test('should set current workspace', () => {
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
        savedAt: 0
      };

      // Execute
      act(() => {
        result.current.saveWorkspace('current-test', workspaceData);
      });

      // Verify current workspace is set
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('current-test');
    });

    test('should dispatch workspacesChanged event', () => {
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
        savedAt: 0
      };

      // Execute
      act(() => {
        result.current.saveWorkspace('event-test', workspaceData);
      });

      // Verify event was dispatched
      expect(window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('loadWorkspace', () => {
    test('should return workspace data when valid', () => {
      // Setup - save a workspace first
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        expandedNodes: { 'src': true },
        selectedFiles: [{ path: 'src/file.ts', content: 'test' }],
        selectedFolder: '/valid/test',
        userInstructions: 'valid test',
        tokenCounts: { 'src/file.ts': 200 },
        customPrompts: {
          systemPrompts: [{ id: '1', title: 'Test Prompt', content: 'Test Content' }],
          rolePrompts: []
        },
        savedAt: 1617235200000
      };

      act(() => {
        result.current.saveWorkspace('valid-workspace', workspaceData);
      });

      // Execute
      let loadedWorkspace: WorkspaceState | null = null;
      act(() => {
        loadedWorkspace = result.current.loadWorkspace('valid-workspace');
      });

      // Verify
      expect(loadedWorkspace).not.toBeNull();
      expect(loadedWorkspace?.selectedFolder).toBe('/valid/test');
      expect(loadedWorkspace?.userInstructions).toBe('valid test');
      expect(loadedWorkspace?.tokenCounts['src/file.ts']).toBe(200);
      expect(loadedWorkspace?.customPrompts.systemPrompts).toHaveLength(1);
      expect(loadedWorkspace?.customPrompts.systemPrompts[0].title).toBe('Test Prompt');
    });

    test('should return null when workspace not found', () => {
      // Setup
      const { result } = renderHook(() => useWorkspaceState());

      // Execute
      let loadedWorkspace: WorkspaceState | null = null;
      act(() => {
        loadedWorkspace = result.current.loadWorkspace('non-existent-workspace');
      });

      // Verify
      expect(loadedWorkspace).toBeNull();
    });

    test('should handle corrupted workspace data', () => {
      // Setup - manually create corrupted workspace data
      const workspaces = { 'corrupted-workspace': '{ invalid json' };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'corrupted-workspace');

      const { result } = renderHook(() => useWorkspaceState());

      // Execute
      let loadedWorkspace: WorkspaceState | null = null;
      act(() => {
        loadedWorkspace = result.current.loadWorkspace('corrupted-workspace');
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
    test('should delete workspace from storage', () => {
      // Setup - save a workspace first
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
        savedAt: 0
      };

      act(() => {
        result.current.saveWorkspace('to-delete', workspaceData);
      });

      // Verify it exists
      const workspacesBeforeDelete = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(workspacesBeforeDelete['to-delete']).toBeDefined();

      // Execute
      act(() => {
        result.current.deleteWorkspace('to-delete');
      });

      // Verify
      const workspacesAfterDelete = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(workspacesAfterDelete['to-delete']).toBeUndefined();
    });

    test('should clear current workspace if deleted was current', () => {
      // Setup - save a workspace and set as current
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
        savedAt: 0
      };

      act(() => {
        result.current.saveWorkspace('current-to-delete', workspaceData);
      });

      // Verify it's set as current
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('current-to-delete');

      // Execute
      act(() => {
        result.current.deleteWorkspace('current-to-delete');
      });

      // Verify current is cleared
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBeNull();
    });

    test('should dispatch event with correct details when deleting current workspace', () => {
      // Setup - save a workspace and set as current
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
        savedAt: 0
      };

      act(() => {
        result.current.saveWorkspace('event-delete-test', workspaceData);
      });

      // Clear previous calls
      (window.dispatchEvent as jest.Mock).mockClear();

      // Execute
      act(() => {
        result.current.deleteWorkspace('event-delete-test');
      });

      // Verify event was dispatched with correct details
      expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
      const eventCall = (window.dispatchEvent as jest.Mock).mock.calls[0][0];
      expect(eventCall.type).toBe('workspacesChanged');
      expect(eventCall.detail).toEqual({
        deleted: 'event-delete-test',
        wasCurrent: true
      });
    });
  });

  describe('renameWorkspace', () => {
    test('should rename workspace successfully', () => {
      // Setup - save a workspace first
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        fileTreeState: {},
        selectedFiles: [],
        selectedFolder: '/rename-test',
        userInstructions: 'rename test',
        tokenCounts: { '/rename-test/file.ts': 50 },
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        savedAt: 0
      };

      act(() => {
        result.current.saveWorkspace('old-name', workspaceData);
      });

      // Execute
      let renameSuccess = false;
      act(() => {
        renameSuccess = result.current.renameWorkspace('old-name', 'new-name');
      });

      // Verify
      expect(renameSuccess).toBe(true);
      
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(workspaces['old-name']).toBeUndefined();
      expect(workspaces['new-name']).toBeDefined();
      
      // Load and verify data preserved
      let loadedWorkspace: WorkspaceState | null = null;
      act(() => {
        loadedWorkspace = result.current.loadWorkspace('new-name');
      });
      
      expect(loadedWorkspace?.selectedFolder).toBe('/rename-test');
      expect(loadedWorkspace?.userInstructions).toBe('rename test');
    });
    
    test('should update current workspace if renamed was current', () => {
      // Setup - save a workspace and set as current
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
        savedAt: 0
      };

      act(() => {
        result.current.saveWorkspace('current-rename', workspaceData);
      });

      // Verify it's set as current
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('current-rename');

      // Execute
      act(() => {
        result.current.renameWorkspace('current-rename', 'renamed-current');
      });

      // Verify current is updated
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('renamed-current');
    });
    
    test('should reject when new name already exists', () => {
      // Setup - save two workspaces
      const { result } = renderHook(() => useWorkspaceState());
      const workspaceData: WorkspaceState = {
        fileTreeState: {},
        selectedFiles: [],
        selectedFolder: '/test1',
        userInstructions: '',
        tokenCounts: { total: 0 },
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        savedAt: 0
      };

      act(() => {
        result.current.saveWorkspace('workspace1', workspaceData);
        result.current.saveWorkspace('workspace2', {...workspaceData, selectedFolder: '/test2'});
      });

      // Execute - try to rename workspace1 to workspace2
      let renameSuccess = true;
      act(() => {
        renameSuccess = result.current.renameWorkspace('workspace1', 'workspace2');
      });

      // Verify
      expect(renameSuccess).toBe(false);
      
      // Both original workspaces should still exist
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(workspaces['workspace1']).toBeDefined();
      expect(workspaces['workspace2']).toBeDefined();
    });
  });
  
  describe('getWorkspaceNames', () => {
    test('should return names sorted by timestamp (newest first)', () => {
      // Setup - save workspaces with different timestamps
      const { result } = renderHook(() => useWorkspaceState());
      
      // Create workspaces with different timestamps
      const baseWorkspace: WorkspaceState = {
        fileTreeState: {},
        selectedFiles: [],
        selectedFolder: '/test',
        userInstructions: '',
        tokenCounts: { total: 0 },
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        savedAt: 0
      };
      
      // Oldest
      const cleanupMock1 = mockDateNow(1000);
      act(() => {
        result.current.saveWorkspace('oldest', baseWorkspace);
      });
      cleanupMock1();
      
      // Middle
      const cleanupMock2 = mockDateNow(2000);
      act(() => {
        result.current.saveWorkspace('middle', baseWorkspace);
      });
      cleanupMock2();
      
      // Newest
      const cleanupMock3 = mockDateNow(3000);
      act(() => {
        result.current.saveWorkspace('newest', baseWorkspace);
      });
      cleanupMock3();

      // Execute
      let workspaceNames: string[] = [];
      act(() => {
        workspaceNames = result.current.getWorkspaceNames();
      });

      // Verify - should be sorted newest first
      expect(workspaceNames).toEqual(['newest', 'middle', 'oldest']);
    });
    
    test('should handle corrupt data in individual workspaces', () => {
      // Setup - save valid workspace and manually add corrupted one
      const { result } = renderHook(() => useWorkspaceState());
      
      const workspaceData: WorkspaceState = {
        fileTreeState: {},
        selectedFiles: [],
        selectedFolder: '/test',
        userInstructions: '',
        tokenCounts: { total: 0 },
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        savedAt: 1000
      };
      
      act(() => {
        result.current.saveWorkspace('valid', workspaceData);
      });
      
      // Add corrupted workspace manually
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      workspaces['corrupted'] = '{ invalid json';
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));

      // Execute
      let workspaceNames: string[] = [];
      act(() => {
        workspaceNames = result.current.getWorkspaceNames();
      });

      // Verify - should include both, with corrupted treated as oldest
      expect(workspaceNames).toContain('valid');
      expect(workspaceNames).toContain('corrupted');
      expect(workspaceNames[0]).toBe('valid'); // Valid should be first (newer)
    });
  });
}); 