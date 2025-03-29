import { renderHook, act } from '@testing-library/react-hooks';
import useAppState from '../hooks/useAppState';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { STORAGE_KEYS } from '../constants';

describe('Workspace Feature', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('saves and loads workspace', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.saveWorkspace('test');
    });
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    expect(workspaces['test']).toBeDefined();

    act(() => {
      result.current.loadWorkspace('test');
    });
    expect(result.current.userInstructions).toBe('');
  });

  test('deletes workspace', () => {
    const { result } = renderHook(() => useWorkspaceState());
    act(() => {
      result.current.saveWorkspace('test');
      result.current.deleteWorkspace('test');
    });
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    expect(workspaces['test']).toBeUndefined();
  });

  test('gets workspace names', () => {
    const { result } = renderHook(() => useWorkspaceState());
    act(() => {
      result.current.saveWorkspace('test1');
      result.current.saveWorkspace('test2');
    });
    const names = result.current.getWorkspaceNames();
    expect(names).toContain('test1');
    expect(names).toContain('test2');
    expect(names.length).toBe(2);
  });

  test('handles workspace serialization and deserialization', () => {
    const { result: appResult } = renderHook(() => useAppState());
    
    // Prepare a test workspace
    act(() => {
      appResult.current.saveWorkspace('testWorkspace');
    });
    
    // Get the workspace data
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    const workspaceData = workspaces['testWorkspace'];
    
    // Verify it's a valid JSON string that can be parsed back
    expect(() => JSON.parse(workspaceData)).not.toThrow();
    
    // Verify the workspace structure
    const workspace = JSON.parse(workspaceData);
    expect(workspace).toHaveProperty('fileTreeState');
    expect(workspace).toHaveProperty('selectedFiles');
    expect(workspace).toHaveProperty('userInstructions');
    expect(workspace).toHaveProperty('tokenCounts');
    expect(workspace).toHaveProperty('customPrompts');
  });
}); 