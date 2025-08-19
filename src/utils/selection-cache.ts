import { FileData, SelectedFileReference } from '../types/file-types';
import { BoundedLRUCache } from './bounded-lru-cache';
import { getGlobalPerformanceMonitor } from './performance-monitor';

export type SelectionState = 'full' | 'partial' | 'none';

export interface DirectorySelectionCache {
  get(path: string): SelectionState;
  set(path: string, state: SelectionState): void;
  bulkUpdate(updates: Map<string, SelectionState>): void;
  clear(): void;

  // Progressive/Incremental overlay computation (optional for backwards compatibility)
  isComputing?(): boolean;
  getProgress?(): number; // 0..1
  startProgressiveRecompute?(
    opts: {
      selectedPaths: Set<string>;
      priorityPaths?: readonly string[];
      batchSize?: number;
    }
  ): { cancel: () => void };
  cancel?(): void;
  setSelectedPaths?(paths: Set<string>): void;
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

// Idle scheduler with robust fallback (Electron/Node-safe)
type IdleCallbackDeadline = { didTimeout: boolean; timeRemaining: () => number };
type IdleCallback = (deadline: IdleCallbackDeadline) => void;

function scheduleIdle(cb: IdleCallback): { cancel: () => void } {
  let cancelled = false;
  const hasWindow = typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function';
  if (hasWindow) {
    const handle = (window as any).requestIdleCallback((deadline: IdleCallbackDeadline) => {
      if (!cancelled) cb(deadline);
    });
    return { cancel: () => { cancelled = true; (window as any).cancelIdleCallback?.(handle); } };
  } else {
    const handle = setTimeout(() => {
      if (!cancelled) cb({ didTimeout: true, timeRemaining: () => 0 });
    }, 0);
    return { cancel: () => { cancelled = true; clearTimeout(handle); } };
  }
}

// Compute a simple path depth metric for prioritization (shallow = more likely visible)
function pathDepth(p: string): number {
  if (!p) return 0;
  const parts = p.split('/').filter(Boolean);
  return parts.length;
}

// For very large directory counts, avoid synchronous full overlay computation
const PROGRESSIVE_DIR_THRESHOLD = 5000 as const;

// ------ Optional off-thread overlay worker integration ------
function canUseOverlayWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

let overlayWorkerInstance: Worker | null = null;

function getOverlayWorker(): Worker | null {
  if (!canUseOverlayWorker()) return null;
  if (overlayWorkerInstance) return overlayWorkerInstance;
  try {
    // Use import.meta.url when available (guarded via eval for test compilers)
    const metaUrl = (0, eval)('import.meta.url');
    const workerUrl = new URL('../workers/selection-overlay-worker.ts', metaUrl);
    overlayWorkerInstance = new Worker(workerUrl, { type: 'module' });
    return overlayWorkerInstance;
  } catch {
    // Fallback dev path (served by Vite)
    try {
      overlayWorkerInstance = new Worker('/src/workers/selection-overlay-worker.ts', { type: 'module' });
      return overlayWorkerInstance;
    } catch {
      return null;
    }
  }
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
function createDirectorySelectionCacheInterface(params: {
  cache: Map<string, SelectionState>;
  directoryMap: Map<string, Set<string>>;
  allDirectories: Set<string>;
  selectedPaths: Set<string>;
  onBatchApplied?: (batchSize: number, totalApplied: number) => void;
}): DirectorySelectionCache {
  const monitor = getGlobalPerformanceMonitor();
  const cache = params.cache;

  // Mutable state for progressive recomputation
  let selectedPathsRef = params.selectedPaths;
  let computing = false;
  let progress = 1;
  let currentTaskId = 0;
  let cancelIdle: (() => void) | null = null;
  // Honor legacy semantics: after clear(), do NOT on-demand compute in .get()
  // Allow on-demand only when we are in progressive mode (initial empty cache or after startProgressiveRecompute)
  let allowOnDemandCompute = cache.size === 0;

  // Track active overlay worker bindings so we can clean them up on restart
  let workerListener: ((ev: MessageEvent) => void) | null = null;
  let workerRef: Worker | null = null;

  const isValidSelectionState = (state: unknown): state is SelectionState => {
    return state === 'full' || state === 'partial' || state === 'none';
  };

  const computeStateForDir = (dirPath: string): SelectionState => {
    return calculateDirectorySelectionState(dirPath, params.directoryMap, selectedPathsRef);
  };

  const startProgressiveRecompute = (opts: {
    selectedPaths: Set<string>;
    priorityPaths?: readonly string[];
    batchSize?: number;
  }): { cancel: () => void } => {
    // Cancel previous task (if any)
    currentTaskId++;
    const taskId = currentTaskId;
    if (cancelIdle) {
      cancelIdle();
      cancelIdle = null;
    }

    selectedPathsRef = opts.selectedPaths;
    const allDirs = [...params.allDirectories];

    // Derive priority ordering (visible/expanded-first approximation by path depth)
    const prioritySet = new Set<string>(opts.priorityPaths || []);
    const prioritized = [
      ...allDirs.filter(p => prioritySet.has(p)),
      ...allDirs.filter(p => !prioritySet.has(p)).sort((a, b) => pathDepth(a) - pathDepth(b))
    ];

    const total = prioritized.length;
    if (total === 0) {
      computing = false;
      progress = 1;
      return { cancel: () => { /* no-op */ } };
    }

    const BATCH = Math.max(200, Math.min(opts.batchSize ?? 1000, 4000));
    const endMeasure = monitor.startMeasure('overlay.compute.progressive.ms');

    computing = true;
    progress = 0;
    allowOnDemandCompute = true;

    // Dev-only: record visible-first coverage ratio (0..1)
    const coverage = (opts.priorityPaths?.length ?? 0) / Math.max(1, total);
    monitor.recordMetric('overlay.visibleFirst.coverage', coverage);

    // Heuristic: offload to worker for very large graphs when available
    const useWorker = total > 8000 && canUseOverlayWorker();
    if (useWorker) {
      const worker = getOverlayWorker();
      if (worker) {
        // If there was a previous listener, remove and cancel previous task to avoid leaks
        if (workerRef && workerListener) {
          try {
            workerRef.postMessage({ type: 'CANCEL' });
          } catch {
            // ignore
          }
          workerRef.removeEventListener('message', workerListener);
          workerListener = null;
        }
        workerRef = worker;

        // Initialize worker with static directory structure
        const dirMapArray: [string, string[]][] = [];
        for (const [dir, files] of params.directoryMap.entries()) {
          dirMapArray.push([dir, Array.from(files)]);
        }
        const allDirsArray = Array.from(params.allDirectories.values());

        try {
          worker.postMessage({ type: 'INIT', payload: { directoryMap: dirMapArray, allDirectories: allDirsArray } });
        } catch {
          // Fallback to main-thread path if INIT fails
        }

        let applied = 0;
        const onMessage = (ev: MessageEvent) => {
          if (taskId !== currentTaskId) return; // stale
          const data = ev.data as { type: string; payload?: any };
          if (!data || typeof data.type !== 'string') return;

          if (data.type === 'BATCH' && data.payload && Array.isArray(data.payload.updates)) {
            let batchSizeApplied = 0;
            for (const [dir, code] of data.payload.updates as [string, 'f' | 'p' | 'n'][]) {
              const state: SelectionState = code === 'f' ? 'full' : code === 'p' ? 'partial' : 'none';
              cache.set(dir, state);
              // Mirror alt path for leading slash normalization
              const altPath = dir.startsWith('/') ? dir.slice(1) : ('/' + dir);
              cache.set(altPath, state);
              batchSizeApplied++;
            }
            applied += batchSizeApplied;
            progress = Math.min(1, applied / total);
            params.onBatchApplied?.(batchSizeApplied, applied);
          } else if (data.type === 'DONE') {
            worker.removeEventListener('message', onMessage);
            workerListener = null;
            if (taskId === currentTaskId) {
              computing = false;
              progress = 1;
              endMeasure();
              // Record dev metric (batch.count not known precisely from worker)
              monitor.recordMetric('overlay.batch.count', 1);
            }
          }
        };

        worker.addEventListener('message', onMessage);
        workerListener = onMessage;

        try {
          worker.postMessage({
            type: 'COMPUTE',
            payload: {
              selectedPaths: Array.from(selectedPathsRef.values()),
              priorityPaths: Array.from(prioritySet.values()),
              batchSize: BATCH
            }
          });
        } catch {
          worker.removeEventListener('message', onMessage);
          workerListener = null;
          // fall through to main-thread computation
        }

        return {
          cancel: () => {
            if (taskId === currentTaskId) {
              currentTaskId++;
              try {
                worker.postMessage({ type: 'CANCEL' });
              } catch {
                // ignore
              }
              if (workerListener) {
                worker.removeEventListener('message', workerListener);
                workerListener = null;
              }
              computing = false;
              progress = 1;
            }
          }
        };
      }
    }

    // ---- Main-thread progressive batching (fallback/default) ----
    let index = 0;
    let batchCount = 0;
    let totalApplied = 0;

    const runBatch = () => {
      if (taskId !== currentTaskId) {
        // Cancelled
        return;
      }

      const start = index;
      const end = Math.min(index + BATCH, total);

      const endBatch = monitor.startMeasure('overlay.compute.batch.ms');

      // Compute batch
      let appliedThisBatch = 0;
      for (let i = start; i < end; i++) {
        const dir = prioritized[i];
        const state = computeStateForDir(dir);
        cache.set(dir, state);
        // Mirror alt path for leading slash normalization
        const altPath = dir.startsWith('/') ? dir.slice(1) : ('/' + dir);
        cache.set(altPath, state);
        appliedThisBatch++;
      }

      endBatch();

      index = end;
      batchCount++;
      totalApplied += appliedThisBatch;
      // Notify UI to re-render progressively
      params.onBatchApplied?.(appliedThisBatch, totalApplied);
      progress = index / total;

      if (index < total) {
        const sched = scheduleIdle((_deadline) => runBatch());
        cancelIdle = sched.cancel;
      } else {
        computing = false;
        progress = 1;
        endMeasure();
        // Record dev metrics
        monitor.recordMetric('overlay.batch.count', batchCount);
        monitor.recordMetric('overlay.batch.size.avg', totalApplied / Math.max(1, batchCount));
      }
    };

    // Kick off first batch synchronously to reflect intent quickly
    runBatch();

    return {
      cancel: () => {
        if (taskId === currentTaskId) {
          currentTaskId++;
          if (cancelIdle) {
            cancelIdle();
            cancelIdle = null;
          }
          computing = false;
          progress = 1;
        }
      }
    };
  };

  return {
    get(path: string): SelectionState {
      if (typeof path !== 'string') {
        console.warn('Invalid path provided to cache.get:', path);
        return 'none';
      }

      // Explicitly return none for empty string to match test expectations
      if (path === '') {
        return 'none';
      }

      const altPath = path.startsWith('/') ? path.slice(1) : ('/' + path);

      const direct = cache.get(path);
      if (direct !== undefined) return direct;

      const alternate = cache.get(altPath);
      if (alternate !== undefined) return alternate;

      // Respect legacy semantics: after clear(), do not recompute on-demand
      if (!allowOnDemandCompute) {
        return 'none';
      }

      // On-demand compute for missing entries (visible-first path)
      const canonical = params.allDirectories.has(path)
        ? path
        : (params.allDirectories.has(altPath) ? altPath : null);

      if (!canonical) {
        return 'none';
      }

      const state = computeStateForDir(canonical);
      cache.set(canonical, state);
      // Mirror leading-slash variant except when empty string (shouldn't be here but safe)
      const mirror = canonical.startsWith('/') ? canonical.slice(1) : '/' + canonical;
      if (mirror !== '') {
        cache.set(mirror, state);
      }

      // Notify minimal update for single path
      params.onBatchApplied?.(1, 0);
      return state;
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
      // Mirror leading-slash variant except when empty string
      if (path !== '') {
        const altPath = path.startsWith('/') ? path.slice(1) : ('/' + path);
        cache.set(altPath, state);
      }
      params.onBatchApplied?.(1, 0);
    },

    bulkUpdate(updates: Map<string, SelectionState>): void {
      if (!(updates instanceof Map)) {
        console.warn('Invalid updates provided to cache.bulkUpdate:', updates);
        return;
      }
      let applied = 0;
      for (const [path, state] of updates) {
        if (typeof path === 'string' && isValidSelectionState(state)) {
          cache.set(path, state);
          // Mirror leading-slash variant except when empty string
          if (path !== '') {
            const altPath = path.startsWith('/') ? path.slice(1) : ('/' + path);
            cache.set(altPath, state);
          }
          applied += 1;
        } else {
          console.warn('Skipping invalid update:', { path, state });
        }
      }
      if (applied > 0) {
        params.onBatchApplied?.(applied, 0);
      }
    },

    clear(): void {
      cache.clear();
      // Reset progressive state and disable on-demand compute until recompute starts
      computing = false;
      progress = 1;
      allowOnDemandCompute = false;
      params.onBatchApplied?.(0, 0);
    },

    // Progressive API (optional to consumers)
    isComputing(): boolean {
      return computing;
    },

    getProgress(): number {
      return progress;
    },

    startProgressiveRecompute(opts: { selectedPaths: Set<string>; priorityPaths?: readonly string[]; batchSize?: number }) {
      return startProgressiveRecompute(opts);
    },

    cancel(): void {
      currentTaskId++;
      if (cancelIdle) {
        cancelIdle();
        cancelIdle = null;
      }
      // If a worker is active, cancel and remove the message listener
      if (workerRef && workerListener) {
        try {
          workerRef.postMessage({ type: 'CANCEL' });
        } catch {
          // ignore
        }
        workerRef.removeEventListener('message', workerListener);
        workerListener = null;
      }
      computing = false;
      progress = 1;
    },

    setSelectedPaths(paths: Set<string>): void {
      selectedPathsRef = paths;
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