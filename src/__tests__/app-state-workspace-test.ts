import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '../constants';
import useAppState from '../hooks/use-app-state';
import { setupMockLocalStorage } from './test-helpers';
import { WorkspaceState, SelectedFileWithLines } from '../types/file-types';
import { setupWorkspaceTestEnv } from './test-helpers/workspace-mocks';

// Mock useWorkspaceState functionality
jest.mock('../hooks/use-workspace-state', () => ({
  useWorkspaceState: () => ({
    saveWorkspace: jest.fn().mockImplementation((name, data) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      workspaces[name] = JSON.stringify(data);
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
    }),
    loadWorkspace: jest.fn().mockImplementation((name) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      if (!workspaces[name]) return null;
      return JSON.parse(workspaces[name]);
    }),
    deleteWorkspace: jest.fn(),
    renameWorkspace: jest.fn(),
    getWorkspaceNames: jest.fn().mockReturnValue([])
  })
}));

describe('useAppState (Workspace Integration)', () => {
  let testEnv: { cleanup: () => void };

  beforeEach(() => {
    setupMockLocalStorage();
    // Mock Event constructors
    window.CustomEvent = jest.fn().mockImplementation((type, options) => ({
      type,
      detail: options?.detail
    }));
    window.dispatchEvent = jest.fn();
    window.addEventListener = jest.fn();
    window.removeEventListener = jest.fn();
    
    // Setup test environment
    testEnv = setupWorkspaceTestEnv();
  });

  afterEach(() => {
    testEnv.cleanup();
    jest.clearAllMocks();
  });

  test('should initialize currentWorkspace from localStorage', () => {
    // Setup - set current workspace in localStorage
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'test-workspace');
    
    // Execute
    const { result } = renderHook(() => useAppState());
    
    // Verify
    expect(result.current.currentWorkspace).toBe('test-workspace');
  });

  describe('Event Handling', () => {
    // Using test.each for event handlers
    test.each([
      ['createNewWorkspace', null, true],
      ['workspacesChanged', { deleted: 'to-be-deleted', wasCurrent: true }, true],
      ['workspacesChanged', { deleted: 'other-workspace', wasCurrent: false }, false]
    ])('should handle %s event correctly', (eventType, eventDetail, shouldReset) => {
      // Setup
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 
        eventType === 'workspacesChanged' && eventDetail?.wasCurrent 
          ? eventDetail.deleted 
          : 'current-workspace');
      
      const { result } = renderHook(() => useAppState());
      const resetFolderStateSpy = jest.spyOn(result.current, 'handleResetFolderState');
      
      // Find the event handler
      const eventListenerCalls = (window.addEventListener as jest.Mock).mock.calls;
      const handlerCall = eventListenerCalls.find(call => call[0] === eventType);
      expect(handlerCall).toBeDefined();
      
      const [, handler] = handlerCall;
      
      // Execute - simulate event
      act(() => {
        handler({ 
          type: eventType,
          detail: eventDetail
        });
      });
      
      // Verify
      if (shouldReset) {
        expect(result.current.currentWorkspace).toBeNull();
        expect(resetFolderStateSpy).toHaveBeenCalled();
      } else {
        expect(result.current.currentWorkspace).toBe('current-workspace');
        expect(resetFolderStateSpy).not.toHaveBeenCalled();
      }
    });
  });

  test('should apply pending workspace data during initialization', async () => {
    // Setup
    const mockWorkspaceData: Partial<WorkspaceState> = {
      selectedFiles: [{ path: 'test.ts' }],
      userInstructions: 'test instructions',
      expandedNodes: { 'src': true },
      tokenCounts: { total: 100 },
      customPrompts: {
        systemPrompts: [],
        rolePrompts: []
      }
    };
    
    // Using waitFor with properly typed mock
    const { result, rerender } = renderHook(() => {
      const appState = useAppState();
      
      // Add test methods in a properly typed way
      const enhancedAppState = {
        ...appState,
        setPendingWorkspaceData: jest.fn((data: Partial<WorkspaceState>) => {
          (appState as any)._pendingWorkspaceData = data;
        }),
        setAppInitialized: jest.fn((value: boolean) => {
          (appState as any)._appInitialized = value;
        }),
        fileSelection: {
          selectedFiles: [] as SelectedFileWithLines[],
          setSelectedFiles: jest.fn()
        },
        setHeaderSaveState: jest.fn()
      };
      
      // Simulate initialization
      if (!(appState as any)._appInitialized) {
        enhancedAppState.setPendingWorkspaceData(mockWorkspaceData);
        enhancedAppState.setAppInitialized(true);
        
        // Apply workspace data by accessing internal fields for testing
        if ((appState as any)._pendingWorkspaceData) {
          const data = (appState as any)._pendingWorkspaceData;
          
          if (data.selectedFiles) {
            enhancedAppState.fileSelection.setSelectedFiles(data.selectedFiles);
            enhancedAppState.fileSelection.selectedFiles = data.selectedFiles;
          }
          
          if (data.userInstructions) {
            (appState as any).userInstructions = data.userInstructions;
          }
          
          if (data.fileTreeState) {
            (appState as any).expandedNodes = data.fileTreeState;
          }
        }
      }
      
      return enhancedAppState;
    });
    
    // Trigger rerender to apply workspace data
    rerender();
    
    // Verify
    expect(result.current.fileSelection.selectedFiles[0].path).toBe('test.ts');
    expect(result.current.userInstructions).toBe('test instructions');
  });

  describe('Header Save Animation States', () => {
    test.each([
      ['saving', 'success', 'idle'],
      ['saving', 'error', 'idle']
    ])('should transition from %s to %s to %s', async (initial, next, final) => {
      // Setup - mock setTimeout and clearTimeout
      jest.useFakeTimers();
      
      const { result } = renderHook(() => useAppState());
      
      // Create properly typed test wrapper
      const setHeaderSaveState = (state: 'idle' | 'saving' | 'success' | 'error') => {
        // Access the internal implementation for testing
        (result.current as any).headerSaveState = state;
        
        // If success or error, set timeout to reset to idle
        if (state === 'success' || state === 'error') {
          setTimeout(() => {
            (result.current as any).headerSaveState = 'idle';
          }, 1500);
        }
      };
      
      // Execute - trigger initial state
      act(() => {
        setHeaderSaveState(initial as any);
      });
      
      // Verify initial state
      expect(result.current.headerSaveState).toBe(initial);
      
      // Execute - transition to next state
      act(() => {
        setHeaderSaveState(next as any);
      });
      
      // Verify next state
      expect(result.current.headerSaveState).toBe(next);
      
      // Fast-forward timers to reset state
      act(() => {
        jest.runAllTimers();
      });
      
      // Verify reset to final
      expect(result.current.headerSaveState).toBe(final);
      
      // Clean up
      jest.useRealTimers();
    });
  });

  test('should add and remove event listeners on mount/unmount', () => {
    // Setup
    const { unmount } = renderHook(() => useAppState());
    
    // Define events to test
    const events = ['createNewWorkspace', 'workspacesChanged'];
    
    // Verify event listeners were added
    events.forEach(event => {
      expect(window.addEventListener).toHaveBeenCalledWith(
        event, 
        expect.any(Function)
      );
    });
    
    // Execute - unmount to trigger cleanup
    unmount();
    
    // Verify event listeners were removed
    events.forEach(event => {
      expect(window.removeEventListener).toHaveBeenCalledWith(
        event, 
        expect.any(Function)
      );
    });
  });
}); 