import { FileData } from '../types/file-types';
import { requestFileList } from './electron-handlers';

/**
 * Applies filters and sorting to files
 * 
 * @param {FileData[]} files - Array of all files
 * @param {string} sort - Sort order 
 * @param {string} filter - Search filter
 * @param {Function} setDisplayedFiles - Setter for displayed files
 * @returns {FileData[]} Filtered and sorted files
 */
export const applyFiltersAndSort = (
  files: FileData[],
  sort: string,
  filter: string,
  setDisplayedFiles: (files: FileData[]) => void
): FileData[] => {
  let filtered = files;

  // Apply filter
  if (filter) {
    const searchLower = filter.toLowerCase();
    filtered = files.filter(
      (file) =>
        file.path.toLowerCase().includes(searchLower) ||
        file.name.toLowerCase().includes(searchLower),
    );
  }

  // Apply sort
  switch (sort) {
    case "name-asc":
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name-desc":
      filtered.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "tokens-asc":
      filtered.sort((a, b) => (a.tokenCount || 0) - (b.tokenCount || 0));
      break;
    case "tokens-desc":
      filtered.sort((a, b) => (b.tokenCount || 0) - (a.tokenCount || 0));
      break;
    default:
      // No sorting
      break;
  }

  // Update displayed files
  setDisplayedFiles(filtered);
  
  return filtered;
};

/**
 * Saves exclusion patterns and optionally refreshes file list
 * 
 * @param {string[]} patterns - Exclusion patterns
 * @param {boolean} refreshFiles - Whether to refresh files
 * @param {Function} setExclusionPatterns - Setter for exclusion patterns
 * @param {string | null} selectedFolder - Selected folder path
 * @param {boolean} isElectron - Whether running in Electron
 * @param {Function} setProcessingStatus - Setter for processing status
 * @param {Function} clearSelectedFiles - Function to clear selected files
 */
export const saveFilters = (
  patterns: string[],
  refreshFiles: boolean,
  setExclusionPatterns: (patterns: string[]) => void,
  selectedFolder: string | null,
  isElectron: boolean,
  setProcessingStatus: (status: any) => void,
  clearSelectedFiles: () => void
): void => {
  setExclusionPatterns(patterns);
  
  if (refreshFiles && selectedFolder && isElectron) {
    setProcessingStatus({
      status: "processing",
      message: "Refreshing file list with new filters...",
    });
    
    // Clear selected files to avoid issues with files that might be filtered out
    clearSelectedFiles();
    
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
 * @param {Function} clearSelectedFiles - Function to clear selected files
 */
export const refreshFileTree = (
  isElectron: boolean,
  selectedFolder: string | null,
  exclusionPatterns: string[],
  setProcessingStatus: (status: any) => void,
  clearSelectedFiles: () => void
): void => {
  if (isElectron && selectedFolder) {
    console.log("Refreshing file tree with filters:", exclusionPatterns);
    setProcessingStatus({
      status: "processing",
      message: "Refreshing file list...",
    });
    
    // Clear selected files to avoid issues with files that might be filtered out
    clearSelectedFiles();
    
    // Request file list with current exclusion patterns
    requestFileList(isElectron, selectedFolder, exclusionPatterns, setProcessingStatus);
  }
};