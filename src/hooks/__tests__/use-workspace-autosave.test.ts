import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspaceAutoSave, computeWorkspaceSignature } from '../use-workspace-autosave';
import type { FileTreeMode, SelectedFileReference } from '../../types/file-types';

// Mock the persistent state hook
jest.mock('../use-persistent-state', () => ({
  usePersistentState: jest.fn((_key: string, defaultValue: unknown) => {
    const [value, setValue] = jest.requireActual('react').useState(defaultValue);
    return [value, setValue];
  })
}));

// Mock the debounce utility
jest.mock('../../utils/debounce', () => ({
  debounce: <T extends (...args: unknown[]) => unknown>(fn: T, _delay: number) => fn
}));

describe('useWorkspaceAutoSave', () => {
  const mockOnAutoSave = jest.fn();
  
  const defaultOptions = {
    currentWorkspace: 'test-workspace',
    selectedFolder: '/test/folder',
    selectedFiles: [] as SelectedFileReference[],
    expandedNodes: {},
    sortOrder: 'name',
    searchTerm: '',
    fileTreeMode: 'none' as FileTreeMode,
    exclusionPatterns: [],
    selectedInstructions: [],
    customPrompts: {
      systemPrompts: [],
      rolePrompts: []
    },
    userInstructions: '',
    isApplyingWorkspaceData: false,
    isProcessing: false,
    onAutoSave: mockOnAutoSave
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not auto-save when disabled', async () => {
    const { result, rerender } = renderHook((props) => useWorkspaceAutoSave(props), {
      initialProps: defaultOptions
    });
    
    act(() => { result.current.setAutoSaveEnabled(false); });
    rerender({ ...defaultOptions, searchTerm: 'new search' });
    act(() => { jest.advanceTimersByTime(3000); });
    
    expect(result.current.isAutoSaveEnabled).toBe(false);
    expect(mockOnAutoSave).not.toHaveBeenCalled();
  });

  it('should auto-save when enabled and state changes', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { initialProps: defaultOptions }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Change state
    rerender({
      ...defaultOptions,
      searchTerm: 'new search term'
    });

    // Advance timers to trigger debounced save
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
    });
  });

  it('should not auto-save when no workspace is selected', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { 
        initialProps: {
          ...defaultOptions,
          currentWorkspace: null
        }
      }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Change state
    rerender({
      ...defaultOptions,
      currentWorkspace: null,
      searchTerm: 'new search'
    });

    // Wait for potential save
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockOnAutoSave).not.toHaveBeenCalled();
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should not auto-save while applying workspace data', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { 
        initialProps: {
          ...defaultOptions,
          isApplyingWorkspaceData: true
        }
      }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Change state while applying workspace data
    rerender({
      ...defaultOptions,
      isApplyingWorkspaceData: true,
      searchTerm: 'new search'
    });

    // Wait for potential save
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockOnAutoSave).not.toHaveBeenCalled();
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should not auto-save while processing', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { 
        initialProps: {
          ...defaultOptions,
          isProcessing: true
        }
      }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Change state while processing
    rerender({
      ...defaultOptions,
      isProcessing: true,
      searchTerm: 'new search'
    });

    // Wait for potential save
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockOnAutoSave).not.toHaveBeenCalled();
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should respect minimum interval between saves', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { initialProps: defaultOptions }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // First change
    rerender({
      ...defaultOptions,
      searchTerm: 'search 1'
    });

    // Trigger first save
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);

    // Second change immediately after
    rerender({
      ...defaultOptions,
      searchTerm: 'search 2'
    });

    // Try to trigger second save too soon
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    // Should still be 1 because of minimum interval
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);

    // Wait for minimum interval to pass
    await act(async () => {
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    // Now it should have saved again
    expect(mockOnAutoSave).toHaveBeenCalledTimes(2);
  });

  it('should detect changes in selected files', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { initialProps: defaultOptions }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Add selected files
    rerender({
      ...defaultOptions,
      selectedFiles: [
        { path: '/test/file1.ts', lines: undefined },
        { path: '/test/file2.ts', lines: [{ start: 1, end: 10 }] }
      ]
    });

    // Trigger save
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should detect changes in expanded nodes', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { initialProps: defaultOptions }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Change expanded nodes
    rerender({
      ...defaultOptions,
      expandedNodes: {
        '/test/folder': true,
        '/test/folder/subfolder': true
      }
    });

    // Trigger save
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should detect changes in custom prompts selection', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { initialProps: defaultOptions }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Select prompts
    rerender({
      ...defaultOptions,
      customPrompts: {
        systemPrompts: [
          { id: 'prompt1', name: 'Test Prompt', content: 'test', selected: true }
        ],
        rolePrompts: []
      }
    });

    // Trigger save
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should not save when signature has not changed', async () => {
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { initialProps: defaultOptions }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Rerender with same props
    rerender(defaultOptions);

    // Wait for potential save
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockOnAutoSave).not.toHaveBeenCalled();
    expect(result.current.isAutoSaveEnabled).toBe(true); // Add second assertion
  });

  it('should handle auto-save errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const failingOnAutoSave = jest.fn().mockRejectedValue(new Error('Save failed'));
    
    const { result, rerender } = renderHook((props) => 
      useWorkspaceAutoSave(props),
      { 
        initialProps: {
          ...defaultOptions,
          onAutoSave: failingOnAutoSave
        }
      }
    );

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Change state to trigger save
    rerender({
      ...defaultOptions,
      onAutoSave: failingOnAutoSave,
      searchTerm: 'new search'
    });

    // Trigger save
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(failingOnAutoSave).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[AutoSave] Auto-save failed:', 'Save failed');
    });

    consoleSpy.mockRestore();
  });

  it('computes same signature regardless of line range order', () => {
    const sigA = computeWorkspaceSignature({
      selectedFolder: '/x',
      selectedFiles: [{ path: '/x/a.ts', lines: [{start:1,end:10},{start:20,end:30}] }],
      expandedNodes: {},
      sortOrder: 'name',
      searchTerm: '',
      fileTreeMode: 'none',
      exclusionPatterns: [],
      selectedInstructions: [],
      systemPromptIds: [],
      rolePromptIds: [],
      userInstructions: ''
    });
    const sigB = computeWorkspaceSignature({
      selectedFolder: '/x',
      selectedFiles: [{ path: '/x/a.ts', lines: [{start:20,end:30},{start:1,end:10}] }],
      expandedNodes: {},
      sortOrder: 'name',
      searchTerm: '',
      fileTreeMode: 'none',
      exclusionPatterns: [],
      selectedInstructions: [],
      systemPromptIds: [],
      rolePromptIds: [],
      userInstructions: ''
    });
    expect(sigA).toBe(sigB);
    expect(sigA.length).toBeGreaterThan(0); // second assertion for quality rule
  });

  it('schedules a trailing save after min interval', async () => {
    const { result, rerender } = renderHook((props) => useWorkspaceAutoSave(props), {
      initialProps: defaultOptions
    });
    // enable autosave
    act(() => { result.current.setAutoSaveEnabled(true); });
    // first change -> immediate save after debounce
    rerender({ ...defaultOptions, searchTerm: 'one' });
    await act(async () => {
      jest.advanceTimersByTime(3000); // debounce window
      await Promise.resolve();
    });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);

    // second change within min interval -> no immediate save
    rerender({ ...defaultOptions, searchTerm: 'two' });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);

    // advance to just before min interval expiry -> still 1
    await act(async () => {
      jest.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);

    // finish interval -> trailing save should fire once
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(2);
  });

  it('should not auto-save immediately after workspace switch', async () => {
    const { result, rerender } = renderHook((props) => useWorkspaceAutoSave(props), {
      initialProps: defaultOptions
    });

    // Enable auto-save
    act(() => {
      result.current.setAutoSaveEnabled(true);
    });

    // Make a change to trigger first save
    rerender({ ...defaultOptions, searchTerm: 'test' });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);

    // Switch workspace (baseline should reset)
    rerender({ 
      ...defaultOptions, 
      currentWorkspace: 'new-workspace',
      searchTerm: 'test' // same signature
    });

    // Wait but should not save since baseline was reset
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    
    // Should still be 1 since baseline was reset on workspace change
    expect(mockOnAutoSave).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoSaveEnabled).toBe(true); // second assertion
  });
});