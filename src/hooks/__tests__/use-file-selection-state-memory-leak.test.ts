import { renderHook, act } from '@testing-library/react';
import useFileSelectionState from '../use-file-selection-state';
import { FileData } from '../../types/file-types';

// Mock the persistent state hook
jest.mock('../use-persistent-state', () => ({
  __esModule: true,
  default: jest.fn((_key, initialValue) => {
    const [state, setState] = require('react').useState(initialValue);
    return [state, setState];
  })
}));

describe('useFileSelectionState - Memory Leak Prevention', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });
  const createMockFile = (path: string): FileData => ({
    name: path.split('/').pop() || '',
    path,
    isDirectory: false,
    size: 100,
    isBinary: false,
    content: 'test content',
    isContentLoaded: true,
    tokenCount: 10,
    children: [],
    isSkipped: false
  });

  it('should remove selected files that no longer exist in allFiles', () => {
    // Start with 3 files
    const initialFiles = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file2.txt'),
      createMockFile('/test/file3.txt')
    ];

    const { result, rerender } = renderHook(
      ({ files }) => useFileSelectionState(files, '/test'),
      {
        initialProps: { files: initialFiles }
      }
    );

    // Select all files
    act(() => {
      result.current.toggleFileSelection('/test/file1.txt');
      result.current.toggleFileSelection('/test/file2.txt');
      result.current.toggleFileSelection('/test/file3.txt');
    });

    expect(result.current.selectedFiles).toHaveLength(3);

    // Simulate file removal - file2.txt is removed from the filesystem
    const updatedFiles = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file3.txt')
    ];

    // Re-render with updated files (simulating file list refresh)
    rerender({ files: updatedFiles });

    // Wait for the cleanup effect to run
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // Verify that the stale selection was removed
    expect(result.current.selectedFiles).toHaveLength(2);
    expect(result.current.selectedFiles.map(f => f.path)).toEqual([
      '/test/file1.txt',
      '/test/file3.txt'
    ]);
  });

  it('should not update state if no stale selections exist', () => {
    const files = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file2.txt')
    ];

    const { result, rerender } = renderHook(
      ({ files }) => useFileSelectionState(files, '/test'),
      {
        initialProps: { files }
      }
    );

    // Select only file1
    act(() => {
      result.current.toggleFileSelection('/test/file1.txt');
    });

    const initialSelectedFiles = result.current.selectedFiles;

    // Re-render with the same files
    rerender({ files });

    // Verify that selectedFiles reference hasn't changed unnecessarily
    expect(result.current.selectedFiles).toBe(initialSelectedFiles);
  });

  it('should handle multiple files being removed at once', () => {
    const initialFiles = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file2.txt'),
      createMockFile('/test/file3.txt'),
      createMockFile('/test/file4.txt')
    ];

    const { result, rerender } = renderHook(
      ({ files }) => useFileSelectionState(files, '/test'),
      {
        initialProps: { files: initialFiles }
      }
    );

    // Select all files
    act(() => {
      result.current.selectAllFiles(initialFiles);
    });

    expect(result.current.selectedFiles).toHaveLength(4);

    // Remove multiple files
    const updatedFiles = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file4.txt')
    ];

    rerender({ files: updatedFiles });

    // Wait for cleanup
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // Verify cleanup
    expect(result.current.selectedFiles).toHaveLength(2);
    expect(result.current.selectedFiles.map(f => f.path).sort()).toEqual([
      '/test/file1.txt',
      '/test/file4.txt'
    ]);
  });

  it('should handle empty allFiles without errors', () => {
    const initialFiles = [createMockFile('/test/file1.txt')];

    const { result, rerender } = renderHook(
      ({ files }) => useFileSelectionState(files, '/test'),
      {
        initialProps: { files: initialFiles }
      }
    );

    // Select the file
    act(() => {
      result.current.toggleFileSelection('/test/file1.txt');
    });

    expect(result.current.selectedFiles).toHaveLength(1);

    // Clear all files (simulating folder change or error)
    rerender({ files: [] });

    // Should not throw any errors
    expect(() => {
      act(() => {
        jest.advanceTimersByTime(150);
      });
    }).not.toThrow();
  });

  it('should validate selections when validateSelectedFilesExist is called', () => {
    const initialFiles = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file2.txt'),
      createMockFile('/test/file3.txt')
    ];

    const { result, rerender } = renderHook(
      ({ files }) => useFileSelectionState(files, '/test'),
      {
        initialProps: { files: initialFiles }
      }
    );

    // Select all files
    act(() => {
      result.current.selectAllFiles(initialFiles);
    });

    // Remove a file
    const updatedFiles = [
      createMockFile('/test/file1.txt'),
      createMockFile('/test/file3.txt')
    ];

    rerender({ files: updatedFiles });

    // Manually call validation
    act(() => {
      result.current.validateSelectedFilesExist();
    });

    // Verify cleanup happened immediately
    expect(result.current.selectedFiles).toHaveLength(2);
    expect(result.current.selectedFiles.map(f => f.path)).not.toContain('/test/file2.txt');
  });
});