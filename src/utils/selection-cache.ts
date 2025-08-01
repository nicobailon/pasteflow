import { FileData, SelectedFileReference } from '../types/file-types';

export type SelectionState = 'full' | 'partial' | 'none';

export interface DirectorySelectionCache {
  get(path: string): SelectionState;
  set(path: string, state: SelectionState): void;
  bulkUpdate(updates: Map<string, SelectionState>): void;
  clear(): void;
}

/**
 * Creates a cache for directory selection states to enable O(1) lookups
 * in the tree view. This replaces the expensive recursive calculations
 * that were causing UI lag.
 */
export function createDirectorySelectionCache(
  allFiles: FileData[],
  selectedFiles: SelectedFileReference[]
): DirectorySelectionCache {
  const cache = new Map<string, SelectionState>();
  
  // Build a set of selected file paths for O(1) lookups
  const selectedPaths = new Set(selectedFiles.map(f => f.path));
  
  // Build directory structure - we'll store both with and without leading slash
  const directoryMap = new Map<string, Set<string>>();
  const allDirectories = new Set<string>();
  
  // First pass: identify all directories from the file paths
  const directoryPaths = new Set<string>();
  
  for (const file of allFiles) {
    const parts = file.path.split('/').filter(Boolean);
    let currentPath = '';
    
    // Add all parent directories
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      directoryPaths.add(currentPath);
      allDirectories.add(currentPath);
    }
  }
  
  // Second pass: process files and build directory map
  for (const file of allFiles) {
    if (file.isBinary || file.isSkipped) continue;
    
    const parts = file.path.split('/').filter(Boolean);
    let currentPath = '';
    
    // Build up each parent directory path
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      
      if (!directoryMap.has(currentPath)) {
        directoryMap.set(currentPath, new Set());
      }
      directoryMap.get(currentPath)!.add(file.path);
    }
    
    // Handle root files
    if (parts.length === 1) {
      const rootPath = '/';
      allDirectories.add(rootPath);
      if (!directoryMap.has(rootPath)) {
        directoryMap.set(rootPath, new Set());
      }
      directoryMap.get(rootPath)!.add(file.path);
    }
  }
  
  // Ensure all directories are in the cache, even empty ones
  for (const dirPath of directoryPaths) {
    if (!directoryMap.has(dirPath)) {
      directoryMap.set(dirPath, new Set());
    }
  }
  
  // Calculate selection state for each directory
  for (const dirPath of allDirectories) {
    const filesInDir = directoryMap.get(dirPath) || new Set();
    
    if (filesInDir.size === 0) {
      cache.set(dirPath, 'none');
      continue;
    }
    
    let selectedCount = 0;
    for (const filePath of filesInDir) {
      if (selectedPaths.has(filePath)) {
        selectedCount++;
      }
    }
    
    let state: SelectionState;
    if (selectedCount === 0) {
      state = 'none';
    } else if (selectedCount === filesInDir.size) {
      state = 'full';
    } else {
      state = 'partial';
    }
    
    // Store the state for the directory path
    cache.set(dirPath, state);
  }
  
  return {
    get(path: string): SelectionState {
      // Handle both with and without leading slash
      const result = cache.get(path);
      if (result) return result;
      
      // Try with leading slash if not found
      if (!path.startsWith('/')) {
        const withSlash = `/${path}`;
        const slashResult = cache.get(withSlash);
        if (slashResult) return slashResult;
      }
      
      // Try without leading slash if not found
      if (path.startsWith('/')) {
        const withoutSlash = path.substring(1);
        const noSlashResult = cache.get(withoutSlash);
        if (noSlashResult) return noSlashResult;
      }
      
      return 'none';
    },
    
    set(path: string, state: SelectionState): void {
      // Normalize the path before setting
      cache.set(path, state);
      
      // Also set the alternative format for consistency
      if (path.startsWith('/')) {
        cache.set(path.substring(1), state);
      } else {
        cache.set(`/${path}`, state);
      }
    },
    
    bulkUpdate(updates: Map<string, SelectionState>): void {
      for (const [path, state] of updates) {
        cache.set(path, state);
      }
    },
    
    clear(): void {
      cache.clear();
    }
  };
}

/**
 * Updates the selection cache after a folder selection change.
 * This only updates the specific folder state, not parent directories,
 * to avoid complex recalculation during optimistic updates.
 */
export function updateSelectionCacheForFolder(
  cache: DirectorySelectionCache,
  folderPath: string,
  newState: SelectionState,
  _allFiles: FileData[]
): void {
  cache.set(folderPath, newState);
  
  // Note: We intentionally don't update parent directories here
  // to keep the optimistic update simple and fast.
  // Parent states will be recalculated when the full cache is rebuilt
  // after the actual file selection update completes.
}