import { useCallback, useEffect } from 'react';

import { STORAGE_KEYS } from '../constants';
import { FileData, LineRange, SelectedFileWithLines } from '../types/file-types';

import useLocalStorage from './use-local-storage';

/**
 * Custom hook to manage file selection state
 * 
 * @param {FileData[]} allFiles - Array of all files
 * @returns {Object} File selection state and functions
 */
const useFileSelectionState = (allFiles: FileData[], currentWorkspacePath?: string | null) => {
  const [selectedFiles, setSelectedFiles] = useLocalStorage<SelectedFileWithLines[]>(
    STORAGE_KEYS.SELECTED_FILES,
    []
  );

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
  const updateSelectedFile = useCallback((updatedFile: SelectedFileWithLines): void => {
    setSelectedFiles(prev => {
      const existingIndex = prev.findIndex(f => f.path === updatedFile.path);
      
      if (existingIndex >= 0) {
        // Get the existing file to preserve line selections if not explicitly changed
        const existingFile = prev[existingIndex];
        
        // Update existing file, but preserve line selections if not explicitly changed
        const newSelection = [...prev];
        
        // If the update doesn't include line data but the existing file has line data,
        // and the update is setting isFullFile to true, preserve the line data
        if (!updatedFile.lines && existingFile.lines && updatedFile.isFullFile) {
          newSelection[existingIndex] = {
            ...updatedFile,
            lines: existingFile.lines,
            isFullFile: false  // Keep it as partial file selection
          };
        } else {
          newSelection[existingIndex] = updatedFile;
        }
        
        return newSelection;
      }
      
      // Prevent adding duplicates
      if (prev.some(f => f.path === updatedFile.path)) {
        return prev;
      }
      
      // Add new file
      return [...prev, updatedFile];
    });
  }, [setSelectedFiles]);

  // Function to find a selected file by path
  const findSelectedFile = useCallback((filePath: string): SelectedFileWithLines | undefined => {
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
      
      const newFile: SelectedFileWithLines = {
        path: filePath,
        isFullFile: true,
        isContentLoaded: fileData.isContentLoaded ?? false,
        content: fileData.content,
        tokenCount: fileData.tokenCount
      };
      
      return [...prev, newFile];
    });
  }, [allFiles, setSelectedFiles]);

  // Toggle selection for a specific line range within a file
  const toggleSelection = useCallback((filePath: string, lineRange?: LineRange) => {
    setSelectedFiles((prev: SelectedFileWithLines[]) => {
      // Find the file in the current selection
      const existingIndex = prev.findIndex(f => f.path === filePath);
      
      if (existingIndex < 0) {
        // File not found in selection, this should not happen
        return prev;
      }
      
      const selectedFile = prev[existingIndex];
      
      // If no line range is provided or the file is a full file selection, remove the entire file
      if (!lineRange || selectedFile.isFullFile) {
        return prev.filter((f: SelectedFileWithLines) => f.path !== filePath);
      }
      
      // If line range is provided, only remove that specific range
      const updatedLines = selectedFile.lines?.filter(
        range => !(range.start === lineRange.start && range.end === lineRange.end)
      ) || [];
      
      // If no more lines are selected, remove the entire file
      if (updatedLines.length === 0) {
        return prev.filter((f: SelectedFileWithLines) => f.path !== filePath);
      }
      
      // Otherwise, update the file with the remaining line ranges
      const newSelection = [...prev];
      newSelection[existingIndex] = {
        ...selectedFile,
        lines: updatedLines
      };
      
      return newSelection;
    });
  }, [setSelectedFiles]);

  // Toggle folder selection (select/deselect all files in folder)
  const toggleFolderSelection = useCallback((folderPath: string, isSelected: boolean) => {
    const filesInFolder = allFiles.filter(
      (file: FileData) =>
        file.path.startsWith(folderPath) && !file.isBinary && !file.isSkipped,
    );

    if (isSelected) {
      // Add all files from this folder that aren't already selected
      setSelectedFiles((prev: SelectedFileWithLines[]) => {
        // Convert to Map for faster lookups
        const prevMap = new Map(prev.map(f => [f.path, f]));
        
        // Add all files from folder that aren't already selected
        for (const file of filesInFolder) {
          if (!prevMap.has(file.path)) {
            prevMap.set(file.path, {
              path: file.path,
              content: file.content,
              tokenCount: file.tokenCount,
              isFullFile: true
            });
          }
        }
        
        // Convert back to array
        return [...prevMap.values()];
      });
    } else {
      // Remove all files from this folder
      setSelectedFiles((prev: SelectedFileWithLines[]) => {
        // Create a Set of paths to remove for faster lookups
        const folderPathsSet = new Set(filesInFolder.map((file: FileData) => file.path));
        
        // Keep only paths that are not in the folder
        return prev.filter(f => !folderPathsSet.has(f.path));
      });
    }
  }, [allFiles, setSelectedFiles]);

  // Handle select all files
  const selectAllFiles = useCallback((displayedFiles: FileData[]) => {
    const selectablePaths = displayedFiles
      .filter((file: FileData) => !file.isBinary && !file.isSkipped)
      .map((file: FileData) => ({
        path: file.path,
        content: file.content,
        tokenCount: file.tokenCount,
        isFullFile: true
      }));

    setSelectedFiles((prev: SelectedFileWithLines[]) => {
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
    
    setSelectedFiles((prev: SelectedFileWithLines[]) =>
      prev.filter((f: SelectedFileWithLines) => !displayedPathsSet.has(f.path))
    );
  }, [setSelectedFiles]);

  // Clear all selected files
  const clearSelectedFiles = useCallback(() => {
    setSelectedFiles([]);
  }, [setSelectedFiles]);

  // Get the current selection state for workspace saving
  const getSelectionState = () => selectedFiles;

  // Set the selection state from a workspace
  const setSelectionState = useCallback((files: SelectedFileWithLines[]): void => {
    // Deduplicate files by path before setting
    const uniqueFiles = [...new Map(files.map(file => [file.path, file])).values()];
    
    // Force a complete replacement by clearing localStorage first
    localStorage.removeItem(STORAGE_KEYS.SELECTED_FILES);
    
    // Then set the new files
    setSelectedFiles(uniqueFiles);
  }, [setSelectedFiles, selectedFiles]);

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
    cleanupStaleSelections
  };
};

export default useFileSelectionState;