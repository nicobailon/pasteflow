import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { STORAGE_KEYS } from '../constants';
import { FileData, LineRange, SelectedFileReference } from '../types/file-types';
import { buildFolderIndex, getFilesInFolder, type FolderIndex } from '../utils/folder-selection-index';
import { createDirectorySelectionCache, type DirectorySelectionCache } from '../utils/selection-cache';

import usePersistentState from './use-persistent-state';

/**
 * Custom hook to manage file selection state
 * 
 * @param {FileData[]} allFiles - Array of all files
 * @returns {Object} File selection state and functions
 */
const useFileSelectionState = (allFiles: FileData[], currentWorkspacePath?: string | null, providedFolderIndex?: FolderIndex) => {
  const [selectedFiles, setSelectedFiles] = usePersistentState<SelectedFileReference[]>(
    STORAGE_KEYS.SELECTED_FILES,
    []
  );
  
  // Build folder index if not provided
  const folderIndex = useMemo(() => {
    if (providedFolderIndex) {
      return providedFolderIndex;
    }
    return buildFolderIndex(allFiles);
  }, [allFiles, providedFolderIndex]);
  
  // Track optimistic folder updates separately with timestamps
  const [optimisticFolderStates, setOptimisticFolderStates] = useState<Map<string, 'full' | 'none'>>(new Map());
  const optimisticTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Build folder selection cache for instant UI updates
  const baseFolderSelectionCache = useMemo(() => {
    return createDirectorySelectionCache(allFiles, selectedFiles);
  }, [allFiles, selectedFiles]);
  
  // Create a wrapper cache that includes optimistic updates
  const folderSelectionCache = useMemo(() => {
    return {
      get(path: string): 'full' | 'partial' | 'none' {
        // Check optimistic updates first
        const optimisticState = optimisticFolderStates.get(path);
        if (optimisticState !== undefined) {
          return optimisticState;
        }
        // Fall back to base cache
        return baseFolderSelectionCache.get(path);
      },
      set: baseFolderSelectionCache.set,
      bulkUpdate: baseFolderSelectionCache.bulkUpdate,
      clear: baseFolderSelectionCache.clear
    };
  }, [baseFolderSelectionCache, optimisticFolderStates]);

  // Immediate cleanup on mount if workspace is provided
  useEffect(() => {
    if (currentWorkspacePath && selectedFiles.length > 0) {
      const validFiles = selectedFiles.filter(file => file.path.startsWith(currentWorkspacePath));
      if (validFiles.length < selectedFiles.length) {
        setSelectedFiles(validFiles);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount
  
  // Cleanup optimistic timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear all pending timeouts
      for (const timeout of optimisticTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      optimisticTimeoutsRef.current.clear();
    };
  }, []);

  // Clean up files outside current workspace
  const cleanupStaleSelections = useCallback(() => {
    if (currentWorkspacePath) {
      setSelectedFiles(prev => {
        const filtered = prev.filter(file => file.path.startsWith(currentWorkspacePath));
        return filtered;
      });
    }
  }, [currentWorkspacePath, setSelectedFiles]);

  // Function to update a selected file with line selections
  const updateSelectedFile = useCallback((path: string, lines?: LineRange[]): void => {
    setSelectedFiles(prev => {
      const existingIndex = prev.findIndex(f => f.path === path);
      
      if (existingIndex >= 0) {
        // Update existing file
        const newSelection = [...prev];
        newSelection[existingIndex] = { path, lines };
        return newSelection;
      }
      
      // Prevent adding duplicates
      if (prev.some(f => f.path === path)) {
        return prev;
      }
      
      // Add new file
      return [...prev, { path, lines }];
    });
  }, [setSelectedFiles]);

  // Function to find a selected file by path
  const findSelectedFile = useCallback((filePath: string): SelectedFileReference | undefined => {
    return selectedFiles.find(f => f.path === filePath);
  }, [selectedFiles]);

  // Toggle file selection
  const toggleFileSelection = useCallback((filePath: string): void => {
    setSelectedFiles((prev) => {
      // Use functional update to ensure we have latest state
      const existingIndex = prev.findIndex((f) => f.path === filePath);
      
      if (existingIndex >= 0) {
        // File exists - remove it
        return prev.filter((f) => f.path !== filePath);
      }
      
      // Double-check to prevent race condition duplicates
      if (prev.some(f => f.path === filePath)) {
        return prev;
      }
      
      const fileData = allFiles.find((f) => f.path === filePath);
      if (!fileData) return prev;
      
      const newFile: SelectedFileReference = {
        path: filePath
        // lines undefined means entire file
      };
      
      return [...prev, newFile];
    });
  }, [allFiles, setSelectedFiles]);

  // Toggle selection for a specific line range within a file
  const toggleSelection = useCallback((filePath: string, lineRange?: LineRange) => {
    setSelectedFiles((prev) => {
      const existingIndex = prev.findIndex((f) => f.path === filePath);

      if (!lineRange) {
        // If no line range, toggle the entire file
        if (existingIndex >= 0) {
          return prev.filter((f) => f.path !== filePath);
        } else {
          return [...prev, { path: filePath }];
        }
      }

      // With a line range
      if (existingIndex < 0) {
        // If file not selected, add it with the new line range
        return [...prev, { path: filePath, lines: [lineRange] }];
      } else {
        // File is already selected, modify its line ranges
        const newSelection = [...prev];
        const selectedFile = newSelection[existingIndex];
        const existingLines = selectedFile.lines || [];
        const lineIndex = existingLines.findIndex(
          (r) => r.start === lineRange.start && r.end === lineRange.end
        );

        if (lineIndex >= 0) {
          // Line range exists, remove it
          const updatedLines = existingLines.filter((_, i) => i !== lineIndex);
          if (updatedLines.length === 0) {
            // If no lines are left, remove the file from selection
            return prev.filter((f) => f.path !== filePath);
          } else {
            newSelection[existingIndex] = { ...selectedFile, lines: updatedLines };
            return newSelection;
          }
        } else {
          // Line range doesn't exist, add it
          newSelection[existingIndex] = {
            ...selectedFile,
            lines: [...existingLines, lineRange],
          };
          return newSelection;
        }
      }
    });
  }, [setSelectedFiles]);

  // Toggle folder selection (select/deselect all files in folder)
  const toggleFolderSelection = useCallback((folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }): void => {
    // Use folder index for O(1) lookup
    const filesInFolderPaths = getFilesInFolder(folderIndex, folderPath);
    
    // If no files in folder, bail early
    if (filesInFolderPaths.length === 0) {
      return;
    }
    
    // Filter to only selectable files
    const selectableFiles = filesInFolderPaths.filter((filePath) => {
      const file = allFiles.find(f => f.path === filePath);
      return file && !file.isBinary && !file.isSkipped;
    });
    
    if (selectableFiles.length === 0) {
      return;
    }
    
    // Check current selection state of folder
    const selectedFilesInFolder = selectedFiles.filter(
      (f: SelectedFileReference) => selectableFiles.includes(f.path)
    );
    
    // Early bailout conditions
    if (isSelected && selectedFilesInFolder.length === selectableFiles.length) {
      // All files in folder are already selected
      return;
    }
    
    if (!isSelected && selectedFilesInFolder.length === 0) {
      // No files from folder are selected
      return;
    }

    // Optimistically update the cache if requested
    if (opts?.optimistic !== false) {
      const newState = isSelected ? 'full' : 'none';
      
      // Clear any existing timeout for this path
      const existingTimeout = optimisticTimeoutsRef.current.get(folderPath);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      
      // Set optimistic state
      setOptimisticFolderStates(prev => {
        const next = new Map(prev);
        next.set(folderPath, newState);
        return next;
      });
      
      // Schedule cleanup with a longer timeout to ensure state has settled
      const timeout = setTimeout(() => {
        setOptimisticFolderStates(prev => {
          const next = new Map(prev);
          next.delete(folderPath);
          return next;
        });
        optimisticTimeoutsRef.current.delete(folderPath);
      }, 500); // Increased from 100ms to 500ms for better stability
      
      optimisticTimeoutsRef.current.set(folderPath, timeout);
    }
    
    // Perform the actual update
    if (isSelected) {
      // Add all files from this folder that aren't already selected
      setSelectedFiles((prev: SelectedFileReference[]) => {
        // Convert to Map for faster lookups
        const prevMap = new Map(prev.map(f => [f.path, f]));
        
        // Add all files from folder that aren't already selected
        for (const filePath of selectableFiles) {
          if (!prevMap.has(filePath)) {
            prevMap.set(filePath, {
              path: filePath
              // lines undefined means entire file
            });
          }
        }
        
        // Convert back to array
        return [...prevMap.values()];
      });
    } else {
      // Remove all files from this folder
      setSelectedFiles((prev: SelectedFileReference[]) => {
        // Create a Set of paths to remove for faster lookups
        const folderPathsSet = new Set(selectableFiles);
        
        // Keep only paths that are not in the folder
        return prev.filter(f => !folderPathsSet.has(f.path));
      });
    }
  }, [allFiles, selectedFiles, setSelectedFiles, folderIndex, folderSelectionCache]);

  // Handle select all files
  const selectAllFiles = useCallback((displayedFiles: FileData[]) => {
    const selectablePaths = displayedFiles
      .filter((file: FileData) => !file.isBinary && !file.isSkipped)
      .map((file: FileData) => ({
        path: file.path
        // lines undefined means entire file
      }));

    setSelectedFiles((prev: SelectedFileReference[]) => {
      // Convert to Map for faster lookups
      const prevMap = new Map(prev.map(f => [f.path, f]));
      
      // Add each new file if not already in selection
      for (const file of selectablePaths) {
        if (!prevMap.has(file.path)) {
          prevMap.set(file.path, file);
        }
      }
      
      // Convert back to array
      return [...prevMap.values()];
    });
  }, [setSelectedFiles]);

  // Handle deselect all files
  const deselectAllFiles = useCallback((displayedFiles: FileData[]) => {
    // Convert displayed paths to a Set for faster lookups
    const displayedPathsSet = new Set(displayedFiles.map((file: FileData) => file.path));
    
    setSelectedFiles((prev: SelectedFileReference[]) =>
      prev.filter((f: SelectedFileReference) => !displayedPathsSet.has(f.path))
    );
  }, [setSelectedFiles]);

  // Clear all selected files
  const clearSelectedFiles = useCallback(() => {
    setSelectedFiles([]);
  }, [setSelectedFiles]);

  // Get the current selection state for workspace saving
  const getSelectionState = () => selectedFiles;

  // Set the selection state from a workspace
  const setSelectionState = useCallback((files: SelectedFileReference[]): void => {
    // Deduplicate files by path before setting
    const uniqueFiles = [...new Map(files.map(file => [file.path, file])).values()];

    // Direct replacement - no need to clear first as this causes React batching issues
    setSelectedFiles(uniqueFiles);
  }, [setSelectedFiles]);

  return {
    selectedFiles,
    setSelectedFiles,
    updateSelectedFile,
    findSelectedFile,
    toggleFileSelection,
    toggleSelection,
    toggleFolderSelection,
    selectAllFiles,
    deselectAllFiles,
    clearSelectedFiles,
    getSelectionState,
    setSelectionState,
    cleanupStaleSelections,
    folderSelectionCache
  };
};

export default useFileSelectionState;