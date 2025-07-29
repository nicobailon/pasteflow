import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '../constants';
import useAppState from '../hooks/use-app-state';
import { setupMockLocalStorage } from './test-helpers';
import { MockAppState, setupWorkspaceTestEnv } from './test-helpers/workspace-mocks';

describe('createNewWorkspace Event', () => {
  let mockAddEventListener: jest.Mock;
  let mockRemoveEventListener: jest.Mock;
  let mockDispatchEvent: jest.Mock;
  let testEnv: { cleanup: () => void };

  // Save original implementations
  const originalAddEventListener = window.addEventListener;
  const originalRemoveEventListener = window.removeEventListener;
  const originalDispatchEvent = window.dispatchEvent;

  beforeEach(() => {
    setupMockLocalStorage();
    
    // Mock window event methods
    mockAddEventListener = jest.fn();
    mockRemoveEventListener = jest.fn();
    mockDispatchEvent = jest.fn();
    
    window.addEventListener = mockAddEventListener;
    window.removeEventListener = mockRemoveEventListener;
    window.dispatchEvent = mockDispatchEvent;
    
    // Setup test environment
    testEnv = setupWorkspaceTestEnv();
  });

  afterEach(() => {
    // Restore original implementations
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    window.dispatchEvent = originalDispatchEvent;
    
    testEnv.cleanup();
  });

  test('should register createNewWorkspace event listener on mount', () => {
    // Render the hook
    renderHook(() => useAppState());

    // Verify event listener is registered
    const createNewWorkspaceListenerCall = mockAddEventListener.mock.calls.find(
      call => call[0] === 'createNewWorkspace'
    );

    expect(createNewWorkspaceListenerCall).toBeDefined();
    expect(typeof createNewWorkspaceListenerCall[1]).toBe('function');
  });

  test('should unregister createNewWorkspace event listener on unmount', () => {
    // Render the hook and capture unmount function
    const { unmount } = renderHook(() => useAppState());

    // Unmount to trigger cleanup
    unmount();

    // Verify event listener is removed
    const removeListenerCall = mockRemoveEventListener.mock.calls.find(
      call => call[0] === 'createNewWorkspace'
    );

    expect(removeListenerCall).toBeDefined();
    expect(typeof removeListenerCall[1]).toBe('function');
  });

  test('should handle createNewWorkspace event properly', () => {
    // Use the real addEventListener to capture the registered handler
    window.addEventListener = originalAddEventListener;
    
    // Create a properly typed mock
    const setCurrentWorkspace = jest.fn();
    const handleResetFolderState = jest.fn();
    
    // Create a custom hook with mocked functions for testing
    const useTestHook = () => {
      const appState = useAppState();
      
      // Override functions with properly typed mocks
      const enhancedAppState = {
        ...appState,
        setCurrentWorkspace: setCurrentWorkspace,
        handleResetFolderState: handleResetFolderState
      };
      
      return enhancedAppState;
    };
    
    // Render the hook
    renderHook(() => useTestHook());
    
    // Create and dispatch the event
    act(() => {
      const event = new Event('createNewWorkspace');
      window.dispatchEvent(event);
    });
    
    // Verify the event handler functions were called correctly
    expect(setCurrentWorkspace).toHaveBeenCalledWith(null);
    expect(handleResetFolderState).toHaveBeenCalled();
  });

  test('should dispatch createNewWorkspace event from UI action', () => {
    // Use real dispatchEvent to test full event flow
    window.dispatchEvent = originalDispatchEvent;
    
    // Create a spy on dispatchEvent to track calls
    jest.spyOn(window, 'dispatchEvent');
    
    // Set up initial state
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'test-workspace');
    
    // Render the hooks
    const { result } = renderHook(() => useAppState());
    
    // Verify initial state
    expect(result.current.currentWorkspace).toBe('test-workspace');
    
    // Simulate dispatching event from UI action (like clicking "New Workspace" in header)
    act(() => {
      window.dispatchEvent(new Event('createNewWorkspace'));
    });
    
    // Verify state was cleared
    expect(result.current.currentWorkspace).toBeNull();
  });

  test('should log event handling to console', () => {
    // Spy on console.log
    const originalConsoleLog = console.log;
    console.log = jest.fn();
    
    // Set up initial state
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'test-workspace');
    
    // Render the hook 
    renderHook(() => useAppState());
    
    // Get the event listener
    const eventListenerCall = mockAddEventListener.mock.calls.find(
      call => call[0] === 'createNewWorkspace'
    );
    const eventHandler = eventListenerCall[1];
    
    // Call the handler directly
    act(() => {
      eventHandler({ type: 'createNewWorkspace' });
    });
    
    // Verify logging
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Received 'createNewWorkspace' event")
    );
    
    // Restore console.log
    console.log = originalConsoleLog;
  });
  
  // New integration test
  test('should reset application state on createNewWorkspace event', () => {
    // Use the real window methods
    window.addEventListener = originalAddEventListener;
    window.dispatchEvent = originalDispatchEvent;
    
    // Create a mock for the existing app state
    const { result } = renderHook(() => useAppState());
    const appState = result.current as unknown as MockAppState;
    
    // Setup initial state with files and folder
    act(() => {
      appState.setSelectedFolder('/test/project');
      appState.fileSelection.setSelectedFiles([
        { path: 'file.ts', content: 'console.log("test")' }
      ]);
      appState.setUserInstructions('Test instructions');
      appState.saveWorkspace('existing-workspace');
    });
    
    // Verify the initial state
    expect(appState.currentWorkspace).toBe('existing-workspace');
    expect(appState.selectedFolder).toBe('/test/project');
    expect(appState.userInstructions).toBe('Test instructions');
    
    // Create and dispatch the createNewWorkspace event
    act(() => {
      window.dispatchEvent(new Event('createNewWorkspace'));
    });
    
    // Verify complete reset of state
    expect(appState.currentWorkspace).toBeNull();
    expect(appState.handleResetFolderState).toHaveBeenCalled();
  });
  
  // Error case test
  test('should handle errors during state reset gracefully', () => {
    // Use the real addEventListener to capture the registered handler
    window.addEventListener = originalAddEventListener;
    
    // Create a mock that will throw when reset is attempted
    const setCurrentWorkspace = jest.fn();
    const handleResetFolderState = jest.fn().mockImplementation(() => {
      throw new Error('Failed to reset state');
    });
    
    // Spy on console.error to check error handling
    const originalConsoleError = console.error;
    console.error = jest.fn();
    
    // Create a custom hook with mocked functions for testing
    const useTestHook = () => {
      const appState = useAppState();
      
      // Override functions with properly typed mocks
      const enhancedAppState = {
        ...appState,
        setCurrentWorkspace: setCurrentWorkspace,
        handleResetFolderState: handleResetFolderState
      };
      
      return enhancedAppState;
    };
    
    // Render the hook
    renderHook(() => useTestHook());
    
    // Create and dispatch the event - should not crash the test
    act(() => {
      const event = new Event('createNewWorkspace');
      window.dispatchEvent(event);
    });
    
    // Verify the event handler caught the error
    expect(handleResetFolderState).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.any(Error) // or more specifically look for 'Failed to reset state'
    );
    
    // The workspace should still be reset
    expect(setCurrentWorkspace).toHaveBeenCalledWith(null);
    
    // Restore console.error
    console.error = originalConsoleError;
  });
}); 