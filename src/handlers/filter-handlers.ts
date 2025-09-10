import { FileData } from '../types/file-types';

import { requestFileList } from './electron-handlers';

export const getFilteredAndSortedFiles = (
  files: FileData[],
  sort: string,
  filter: string
): FileData[] => {
  // Work with a copy to avoid mutating callers
  let filtered = files;

  if (filter) {
    const searchLower = filter.toLowerCase();
    filtered = files.filter(
      (file) =>
        file.path.toLowerCase().includes(searchLower) ||
        file.name.toLowerCase().includes(searchLower),
    );
  }

  // Make a shallow copy before sorting to avoid mutating the filtered array reference
  const result = [...filtered];

  switch (sort) {
    case "name-asc": {
      result.sort((a, b) => a.name.localeCompare(b.name));
      break;
    }
    case "name-desc": {
      result.sort((a, b) => b.name.localeCompare(a.name));
      break;
    }
    case "tokens-asc": {
      result.sort((a, b) => (a.tokenCount || 0) - (b.tokenCount || 0));
      break;
    }
    case "tokens-desc": {
      result.sort((a, b) => (b.tokenCount || 0) - (a.tokenCount || 0));
      break;
    }
    default: {
      // No sorting
      break;
    }
  }

  return result;
};

// Note: imperative API removed; use getFilteredAndSortedFiles and derive via useMemo in components/hooks.

/**
 * Saves exclusion patterns and optionally refreshes file list
 *
 * @param {string[]} patterns - Exclusion patterns
 * @param {boolean} refreshFiles - Whether to refresh files
 * @param {Function} setExclusionPatterns - Setter for exclusion patterns
 * @param {string | null} selectedFolder - Selected folder path
 * @param {boolean} isElectron - Whether running in Electron
 * @param {Function} setProcessingStatus - Setter for processing status
 */
export const saveFilters = (
  patterns: string[],
  refreshFiles: boolean,
  setExclusionPatterns: (patterns: string[]) => void,
  selectedFolder: string | null,
  isElectron: boolean,
  setProcessingStatus: (status: any) => void
): void => {
  setExclusionPatterns(patterns);
  
  if (refreshFiles && selectedFolder && isElectron) {
    setProcessingStatus({
      status: "processing",
      message: "Refreshing file list with new filters...",
    });
    
    // Request file list with updated exclusion patterns
    requestFileList(isElectron, selectedFolder, patterns, setProcessingStatus);
  }
};

/**
 * Refreshes the file tree with current filters
 *
 * @param {boolean} isElectron - Whether running in Electron
 * @param {string | null} selectedFolder - Selected folder path
 * @param {string[]} exclusionPatterns - Exclusion patterns
 * @param {Function} setProcessingStatus - Setter for processing status
 */
export const refreshFileTree = (
  isElectron: boolean,
  selectedFolder: string | null,
  exclusionPatterns: string[],
  setProcessingStatus: (status: any) => void
): void => {
  if (isElectron && selectedFolder) {
    setProcessingStatus({
      status: "processing",
      message: "Refreshing file list...",
    });
    
    // Request file list with current exclusion patterns
    requestFileList(isElectron, selectedFolder, exclusionPatterns, setProcessingStatus);
  }
};
