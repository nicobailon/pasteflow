import { FileData, SelectedFileReference } from '../types/file-types';
import { BoundedLRUCache } from './bounded-lru-cache';

export type SelectionState = 'full' | 'partial' | 'none';

export interface DirectorySelectionCache {
  get(path: string): SelectionState;
  set(path: string, state: SelectionState): void;
  bulkUpdate(updates: Map<string, SelectionState>): void;
  clear(): void;
}

/**
 * Lightweight structure cache to avoid rebuilding static directory maps
 * on every selection change for large workspaces.
 * Keyed by a canonicalized, sorted list of file paths.
 * TTL keeps memory bounded and allows eventual consistency after file structure changes.
 */
const DIRECTORY_STRUCTURE_CACHE = new BoundedLRUCache<
  string,
  { directoryMap: Map<string, Set<string>>; allDirectories: Set<string> }
>(8, 5 * 60 * 1000); // 8 entries, 5 minutes TTL

function computeFilesKey(files: FileData[]): string {
  try {
    // Canonical key based on sorted absolute paths
    return files.map(f => f.path).sort().join('|');
  } catch {
    // Fallback to length-only key if something unexpected happens
    return String(files.length);
  }
}

function getOrBuildDirectoryStructure(allFiles: FileData[]): {
  directoryMap: Map<string, Set<string>>;
  allDirectories: Set<string>;
} {
  const key = computeFilesKey(allFiles);
  const cached = DIRECTORY_STRUCTURE_CACHE.get(key);
  if (cached) return cached;

  const built = buildDirectoryStructure(allFiles);
  DIRECTORY_STRUCTURE_CACHE.set(key, built);
  return built;
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
  // Runtime validation
  if (!Array.isArray(allFiles)) {
    throw new TypeError('allFiles must be an array');
  }
  if (!Array.isArray(selectedFiles)) {
    throw new TypeError('selectedFiles must be an array');
  }
  
  const selectedPaths = new Set(selectedFiles.map(f => {
    if (!f || typeof f.path !== 'string') {
      console.warn('Invalid selected file reference:', f);
      return '';
    }
    return f.path;
  }).filter(Boolean));
  
  // Reuse static directory structure when possible
  const { directoryMap, allDirectories } = getOrBuildDirectoryStructure(allFiles);
  const cache = calculateDirectorySelectionStates(directoryMap, allDirectories, selectedPaths);
  
  return createDirectorySelectionCacheInterface(cache);
}

/**
 * Build directory structure from file paths
 */
function buildDirectoryStructure(allFiles: FileData[]): {
  directoryMap: Map<string, Set<string>>;
  allDirectories: Set<string>;
} {
  const directoryMap = new Map<string, Set<string>>();
  const allDirectories = new Set<string>();
  const directoryPaths = identifyAllDirectories(allFiles);
  
  // Add all identified directories to the set with validation
  for (const dirPath of directoryPaths) {
    if (typeof dirPath === 'string' && dirPath.length > 0) {
      allDirectories.add(dirPath);
    }
  }
  
  buildDirectoryToFilesMapping(allFiles, directoryMap, allDirectories);
  ensureAllDirectoriesExist(directoryPaths, directoryMap);
  
  return { directoryMap, allDirectories };
}

/**
 * Identify all directories from file paths
 */
function identifyAllDirectories(allFiles: FileData[]): Set<string> {
  const directoryPaths = new Set<string>();
  
  for (const file of allFiles) {
    const directories = extractDirectoriesFromFilePath(file.path);
    for (const dir of directories) {
      directoryPaths.add(dir);
    }
  }
  
  return directoryPaths;
}

/**
 * Extract all parent directories from a file path
 */
function extractDirectoriesFromFilePath(filePath: string): string[] {
  // Runtime validation
  if (typeof filePath !== 'string') {
    console.warn('Invalid file path provided:', filePath);
    return [];
  }
  
  const isAbsolute = filePath.startsWith('/');
  const parts = filePath.split('/').filter(Boolean);
  const directories: string[] = [];
  
  for (let i = 0; i < parts.length - 1; i++) {
    const pathParts = parts.slice(0, i + 1);
    const currentPath = isAbsolute ? '/' + pathParts.join('/') : pathParts.join('/');
    directories.push(currentPath);
  }
  
  return directories;
}

/**
 * Build mapping from directories to their contained files
 */
function buildDirectoryToFilesMapping(
  allFiles: FileData[],
  directoryMap: Map<string, Set<string>>,
  allDirectories: Set<string>
): void {
  for (const file of allFiles) {
    if (file.isBinary || file.isSkipped) continue;
    
    const parentDirectories = extractDirectoriesFromFilePath(file.path);
    addFileToDirectories(file.path, parentDirectories, directoryMap);
    
    handleRootFiles(file, directoryMap, allDirectories);
  }
}

/**
 * Add file to all its parent directories
 */
function addFileToDirectories(
  filePath: string,
  directories: string[],
  directoryMap: Map<string, Set<string>>
): void {
  for (const dirPath of directories) {
    if (!directoryMap.has(dirPath)) {
      directoryMap.set(dirPath, new Set());
    }
    directoryMap.get(dirPath)!.add(filePath);
  }
}

/**
 * Handle files that are directly in the root
 */
function handleRootFiles(
  file: FileData,
  directoryMap: Map<string, Set<string>>,
  allDirectories: Set<string>
): void {
  const isAbsolute = file.path.startsWith('/');
  const parts = file.path.split('/').filter(Boolean);
  
  if (isAbsolute && parts.length === 1) {
    const rootPath = '/';
    allDirectories.add(rootPath);
    if (!directoryMap.has(rootPath)) {
      directoryMap.set(rootPath, new Set());
    }
    directoryMap.get(rootPath)!.add(file.path);
  }
}

/**
 * Ensure all directories exist in the map, even empty ones
 */
function ensureAllDirectoriesExist(
  directoryPaths: Set<string>,
  directoryMap: Map<string, Set<string>>
): void {
  for (const dirPath of directoryPaths) {
    if (!directoryMap.has(dirPath)) {
      directoryMap.set(dirPath, new Set());
    }
  }
}

/**
 * Calculate selection states for all directories
 */
function calculateDirectorySelectionStates(
  directoryMap: Map<string, Set<string>>,
  allDirectories: Set<string>,
  selectedPaths: Set<string>
): Map<string, SelectionState> {
  const cache = new Map<string, SelectionState>();
  
  for (const dirPath of allDirectories) {
    const state = calculateDirectorySelectionState(dirPath, directoryMap, selectedPaths);
    cache.set(dirPath, state);
  }
  
  return cache;
}

/**
 * Calculate selection state for a single directory
 */
function calculateDirectorySelectionState(
  dirPath: string,
  directoryMap: Map<string, Set<string>>,
  selectedPaths: Set<string>
): SelectionState {
  const filesInDir = directoryMap.get(dirPath) || new Set();
  
  if (filesInDir.size === 0) {
    return 'none';
  }
  
  const selectedCount = countSelectedFilesInDirectory(filesInDir, selectedPaths);
  
  if (selectedCount === 0) {
    return 'none';
  } else if (selectedCount === filesInDir.size) {
    return 'full';
  } else {
    return 'partial';
  }
}

/**
 * Count how many files in directory are selected
 */
function countSelectedFilesInDirectory(
  filesInDir: Set<string>,
  selectedPaths: Set<string>
): number {
  let count = 0;
  for (const filePath of filesInDir) {
    if (selectedPaths.has(filePath)) {
      count++;
    }
  }
  return count;
}

/**
 * Create the cache interface
 */
function createDirectorySelectionCacheInterface(
  cache: Map<string, SelectionState>
): DirectorySelectionCache {
  const isValidSelectionState = (state: unknown): state is SelectionState => {
    return state === 'full' || state === 'partial' || state === 'none';
  };
  
  return {
    get(path: string): SelectionState {
      if (typeof path !== 'string') {
        console.warn('Invalid path provided to cache.get:', path);
        return 'none';
      }
      return cache.get(path) || 'none';
    },
    
    set(path: string, state: SelectionState): void {
      if (typeof path !== 'string') {
        console.warn('Invalid path provided to cache.set:', path);
        return;
      }
      if (!isValidSelectionState(state)) {
        console.warn('Invalid selection state provided to cache.set:', state);
        return;
      }
      cache.set(path, state);
    },
    
    bulkUpdate(updates: Map<string, SelectionState>): void {
      if (!(updates instanceof Map)) {
        console.warn('Invalid updates provided to cache.bulkUpdate:', updates);
        return;
      }
      for (const [path, state] of updates) {
        if (typeof path === 'string' && isValidSelectionState(state)) {
          cache.set(path, state);
        } else {
          console.warn('Skipping invalid update:', { path, state });
        }
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