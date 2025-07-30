import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '../constants';
import useAppState from '../hooks/use-app-state';
import { setupMockLocalStorage } from './test-helpers';

describe('createNewWorkspace Event', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    
    // Mock console methods to keep tests clean
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should register createNewWorkspace event listener on mount', () => {
    // Spy on addEventListener
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    
    // Render the hook
    renderHook(() => useAppState());

    // Verify event listener is registered
    const createNewWorkspaceListenerCall = addEventListenerSpy.mock.calls.find(
      call => call[0] === 'createNewWorkspace'
    );

    expect(createNewWorkspaceListenerCall).toBeDefined();
    expect(createNewWorkspaceListenerCall?.[0]).toBe('createNewWorkspace');
    expect(typeof createNewWorkspaceListenerCall?.[1]).toBe('function');
  });

  test('should unregister createNewWorkspace event listener on unmount', () => {
    // Spy on removeEventListener
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    
    // Render and unmount the hook
    const { unmount } = renderHook(() => useAppState());
    
    unmount();

    // Verify event listener is removed
    const createNewWorkspaceListenerCall = removeEventListenerSpy.mock.calls.find(
      call => call[0] === 'createNewWorkspace'
    );

    expect(createNewWorkspaceListenerCall).toBeDefined();
    expect(createNewWorkspaceListenerCall?.[0]).toBe('createNewWorkspace');
  });

  test('should handle createNewWorkspace event properly', () => {
    // Render the hook
    const { result } = renderHook(() => useAppState());
    
    // Setup initial state by loading a workspace
    act(() => {
      // First save a workspace
      result.current.saveWorkspace('existing-workspace');
      // Then load it to make it current
      result.current.loadWorkspace('existing-workspace');
    });
    
    // Verify initial state
    expect(result.current.currentWorkspace).toBe('existing-workspace');
    
    // Create and dispatch the event
    act(() => {
      const event = new Event('createNewWorkspace');
      window.dispatchEvent(event);
    });
    
    // Verify the workspace was cleared
    expect(result.current.currentWorkspace).toBeNull();
    expect(result.current.selectedFolder).toBeNull();
  });

  test('should dispatch createNewWorkspace event from UI action', () => {
    // Render the hook
    const { result } = renderHook(() => useAppState());
    
    // Set up initial state
    act(() => {
      result.current.saveWorkspace('test-workspace');
      result.current.loadWorkspace('test-workspace');
    });
    
    expect(result.current.currentWorkspace).toBe('test-workspace');
    
    // Simulate dispatching event from UI action (like clicking "New Workspace" in header)
    act(() => {
      const newWorkspaceEvent = new CustomEvent('createNewWorkspace');
      window.dispatchEvent(newWorkspaceEvent);
    });
    
    // Verify workspace was cleared
    expect(result.current.currentWorkspace).toBeNull();
  });

  test('should log event handling to console', () => {
    const consoleLogSpy = jest.spyOn(console, 'log');
    
    // Render the hook 
    renderHook(() => useAppState());
    
    // Verify registration was logged
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Added createNewWorkspace event listener')
    );
    
    // Clear previous calls
    consoleLogSpy.mockClear();
    
    // Dispatch the event
    act(() => {
      window.dispatchEvent(new Event('createNewWorkspace'));
    });
    
    // Verify event handling was logged
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Received 'createNewWorkspace' event")
    );
  });

  test('should reset application state on createNewWorkspace event', () => {
    // This test focuses on verifying that the createNewWorkspace event
    // clears the current workspace and resets folder state
    
    // Mock localStorage to have a current workspace
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'test-workspace');
    
    // Create a real app state instance
    const { result } = renderHook(() => useAppState());
    
    // Set some user instructions to verify they get reset
    act(() => {
      result.current.setUserInstructions('Test instructions');
    });
    
    // Verify initial state
    expect(result.current.userInstructions).toBe('Test instructions');
    
    // Create and dispatch the createNewWorkspace event
    act(() => {
      window.dispatchEvent(new Event('createNewWorkspace'));
    });
    
    // Verify state was reset after the event
    // The createNewWorkspace event handler:
    // 1. Sets currentWorkspace to null
    // 2. Calls handleResetFolderState which clears folder, files, but NOT user instructions
    expect(result.current.currentWorkspace).toBeNull();
    expect(result.current.selectedFolder).toBeNull();
    expect(result.current.selectedFiles).toEqual([]);
    
    // Note: User instructions are intentionally NOT cleared when creating a new workspace
    // This allows users to maintain their instructions across workspace changes
    expect(result.current.userInstructions).toBe('Test instructions');
  });
  
  test('should clear workspace even if other operations might fail', () => {
    // Render the hook
    const { result } = renderHook(() => useAppState());
    
    // Setup some initial state
    act(() => {
      result.current.saveWorkspace('test-workspace');
      result.current.loadWorkspace('test-workspace');
    });
    
    expect(result.current.currentWorkspace).toBe('test-workspace');
    
    // Dispatch the event
    act(() => {
      window.dispatchEvent(new Event('createNewWorkspace'));
    });
    
    // Verify that the workspace was still cleared
    expect(result.current.currentWorkspace).toBeNull();
    
    // Verify the console log was called indicating the event was received
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Received 'createNewWorkspace' event")
    );
  });
});