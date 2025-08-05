import type { FileData } from '../types/file-types';

export type FolderIndex = Map<string, string[]>;

/**
 * Builds an index mapping folder paths to the file paths they contain.
 * This enables O(1) lookups for folder selection operations.
 * 
 * @param allFiles - Array of all files in the workspace
 * @returns Map where keys are folder paths and values are arrays of file paths
 */
export function buildFolderIndex(allFiles: FileData[]): FolderIndex {
  const index: FolderIndex = new Map();
  
  
  // Process each file to build the folder index
  for (const file of allFiles) {
    if (!file.path || file.isBinary || file.isSkipped) {
      continue; // Skip non-selectable files
    }
    
    // Split path and keep the absolute path structure
    const isAbsolute = file.path.startsWith('/');
    const parts = file.path.split('/').filter(Boolean);
    
    // Build up each parent folder path maintaining absolute/relative nature
    for (let i = 0; i < parts.length - 1; i++) {
      const pathParts = parts.slice(0, i + 1);
      const currentPath = isAbsolute ? '/' + pathParts.join('/') : pathParts.join('/');
      
      // Add this file to the folder's file list
      if (!index.has(currentPath)) {
        index.set(currentPath, []);
      }
      index.get(currentPath)!.push(file.path);
    }
    
    // Also handle files directly in the root
    if (isAbsolute && parts.length === 1) {
      const rootPath = '/';
      if (!index.has(rootPath)) {
        index.set(rootPath, []);
      }
      index.get(rootPath)!.push(file.path);
    }
  }
  
  return index;
}

/**
 * Gets all file paths within a folder from the index.
 * 
 * @param index - The folder index
 * @param folderPath - The folder path to look up
 * @returns Array of file paths in the folder, or empty array if not found
 */
export function getFilesInFolder(index: FolderIndex, folderPath: string): string[] {
  return index.get(folderPath) || [];
}

/**
 * Updates the folder index when files are added or removed.
 * More efficient than rebuilding the entire index.
 * 
 * @param index - The existing folder index
 * @param addedFiles - Files that were added
 * @param removedFiles - Files that were removed
 */
export function updateFolderIndex(
  index: FolderIndex,
  addedFiles: FileData[],
  removedFiles: FileData[]
): void {
  // Remove files from index
  for (const file of removedFiles) {
    if (!file.path || file.isBinary || file.isSkipped) continue;
    
    const parts = file.path.split('/').filter(Boolean);
    let currentPath = '';
    
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : `/${parts[i]}`;
      const filesInFolder = index.get(currentPath);
      if (filesInFolder) {
        const fileIndex = filesInFolder.indexOf(file.path);
        if (fileIndex !== -1) {
          filesInFolder.splice(fileIndex, 1);
        }
        // Remove empty folders from index
        if (filesInFolder.length === 0) {
          index.delete(currentPath);
        }
      }
    }
    
    // Handle root files
    if (parts.length === 1) {
      const rootFiles = index.get('/');
      if (rootFiles) {
        const fileIndex = rootFiles.indexOf(file.path);
        if (fileIndex !== -1) {
          rootFiles.splice(fileIndex, 1);
        }
        if (rootFiles.length === 0) {
          index.delete('/');
        }
      }
    }
  }
  
  // Add new files to index
  for (const file of addedFiles) {
    if (!file.path || file.isBinary || file.isSkipped) continue;
    
    const parts = file.path.split('/').filter(Boolean);
    let currentPath = '';
    
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : `/${parts[i]}`;
      if (!index.has(currentPath)) {
        index.set(currentPath, []);
      }
      index.get(currentPath)!.push(file.path);
    }
    
    // Handle root files
    if (parts.length === 1) {
      if (!index.has('/')) {
        index.set('/', []);
      }
      index.get('/')!.push(file.path);
    }
  }
}