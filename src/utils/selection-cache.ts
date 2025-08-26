import { FileData, SelectedFileReference, DirectorySelectionCache } from '../types/file-types';

import { BoundedLRUCache } from './bounded-lru-cache';
import { getGlobalPerformanceMonitor } from './performance-monitor';
import { type CacheInterfaceParams, tryGetOverlayWorker } from './selection-cache-helpers';
import { createCacheInterface } from './selection-cache-interface';

export type SelectionState = 'full' | 'partial' | 'none';

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

// For very large directory counts, avoid synchronous full overlay computation
const PROGRESSIVE_DIR_THRESHOLD = 5000 as const;

// ------ Optional off-thread overlay worker integration ------
let overlayWorkerInstance: Worker | null = null;

function getOverlayWorker(): Worker | null {
  if (overlayWorkerInstance) return overlayWorkerInstance;
  overlayWorkerInstance = tryGetOverlayWorker();
  return overlayWorkerInstance;
}
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
  const monitor = getGlobalPerformanceMonitor();
  const cached = DIRECTORY_STRUCTURE_CACHE.get(key);
  if (cached) {
    // Dev-only cache metrics
    monitor.recordMetric('cache.directoryStructure.hit', 1);
    return cached;
  }

  monitor.recordMetric('cache.directoryStructure.miss', 1);
  const end = monitor.startMeasure('cache.directoryStructure.build.ms');
  const built = buildDirectoryStructure(allFiles);
  end();

  DIRECTORY_STRUCTURE_CACHE.set(key, built);
  // Track approximate directory count for memory footprint analysis
  monitor.recordMetric('cache.directoryStructure.entries', built.allDirectories.size);
  return built;
}

/**
 * Creates a cache for directory selection states to enable O(1) lookups
 * in the tree view. This replaces the expensive recursive calculations
 * that were causing UI lag.
 */
export function createDirectorySelectionCache(
  allFiles: FileData[],
  selectedFiles: SelectedFileReference[],
  options?: { onBatchApplied?: (batchSize: number, totalApplied: number) => void }
): DirectorySelectionCache {
  // Runtime validation
  if (!Array.isArray(allFiles)) {
    throw new TypeError('allFiles must be an array');
  }
  if (!Array.isArray(selectedFiles)) {
    throw new TypeError('selectedFiles must be an array');
  }

  // Build initial selected paths
  const selectedPaths = new Set(
    selectedFiles
      .map(f => {
        if (!f || typeof f.path !== 'string') {
          console.warn('Invalid selected file reference:', f);
          return '';
        }
        return f.path;
      })
      .filter(Boolean)
  );

  // Reuse static directory structure when possible
  const { directoryMap, allDirectories } = getOrBuildDirectoryStructure(allFiles);

  // Heuristic: for very large directory graphs, avoid synchronous full overlay compute
  const progressiveFirst = allDirectories.size > PROGRESSIVE_DIR_THRESHOLD;

  // Build initial cache
  const initialCache = progressiveFirst
    ? new Map<string, SelectionState>()
    : calculateDirectorySelectionStates(directoryMap, allDirectories, selectedPaths);

  // Create progressive-capable cache interface
  const iface = createDirectorySelectionCacheInterface({
    cache: initialCache,
    directoryMap,
    allDirectories,
    selectedPaths,
    onBatchApplied: options?.onBatchApplied
  });

  // If progressive-first, kick a background recompute immediately (no priority hints yet)
  if (progressiveFirst && iface.startProgressiveRecompute) {
    // Defer to next tick to keep creation non-blocking
    setTimeout(() => {
      iface.startProgressiveRecompute!({ selectedPaths });
    }, 0);
  }

  return iface;
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
function createDirectorySelectionCacheInterface(params: CacheInterfaceParams): DirectorySelectionCache {
  return createCacheInterface(params, params.cache, getOverlayWorker);
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