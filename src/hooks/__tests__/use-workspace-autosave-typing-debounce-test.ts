import { renderHook, act } from '@testing-library/react';

import { useWorkspaceAutoSave } from '../use-workspace-autosave';
import type { FileTreeMode, SelectedFileReference, SystemPrompt, RolePrompt } from '../../types/file-types';

// Mock the persistent state hook to avoid external storage
jest.mock('../use-persistent-state', () => ({
  usePersistentState: jest.fn((_key: string, defaultValue: unknown) => {
    const [value, setValue] = jest.requireActual('react').useState(defaultValue);
    return [value, setValue];
  })
}));

describe('useWorkspaceAutoSave typing debounce behavior', () => {
  const mockOnAutoSave = jest.fn();

  const baseOptions = {
    currentWorkspace: 'w',
    selectedFolder: '/x',
    selectedFiles: [] as SelectedFileReference[],
    expandedNodes: {},
    sortOrder: 'name',
    searchTerm: '',
    fileTreeMode: 'none' as FileTreeMode,
    exclusionPatterns: [],
    selectedInstructions: [],
    customPrompts: { systemPrompts: [] as SystemPrompt[], rolePrompts: [] as RolePrompt[] },
    userInstructions: '',
    isApplyingWorkspaceData: false,
    isProcessing: false,
    onAutoSave: mockOnAutoSave
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockOnAutoSave.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces typing changes ~4s before saving', () => {
    const { result, rerender } = renderHook((props) => useWorkspaceAutoSave(props), {
      initialProps: baseOptions
    });
    act(() => { result.current.setAutoSaveEnabled(true); });

    // Simulate continuous typing updates within 4s window
    rerender({ ...baseOptions, userInstructions: 'h' });
    rerender({ ...baseOptions, userInstructions: 'he' });
    rerender({ ...baseOptions, userInstructions: 'hel' });

    // Advance just shy of 4s -> should not have saved yet
    act(() => { jest.advanceTimersByTime(3999); });
    expect(mockOnAutoSave).not.toHaveBeenCalled();

    // Cross 4s boundary -> should save once
    act(() => { jest.advanceTimersByTime(1); });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
  });

  it('uses fast debounce for non-instruction changes', () => {
    const { result, rerender } = renderHook((props) => useWorkspaceAutoSave(props), {
      initialProps: baseOptions
    });
    act(() => { result.current.setAutoSaveEnabled(true); });

    // Change a non-instructions field (searchTerm) -> should schedule autosave without waiting for 4s typing delay
    rerender({ ...baseOptions, searchTerm: 'q' });
    // Flush effects so debounce timer is registered before advancing timers
    act(() => {});
    // Advance enough time to allow any debounce to fire
    act(() => { jest.advanceTimersByTime(4001); });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
  });
});
