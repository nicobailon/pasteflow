import { SelectionState } from './selection-cache';
import { getGlobalPerformanceMonitor } from './performance-monitor';

export type WorkerMessageType = 'INIT' | 'COMPUTE' | 'CANCEL' | 'BATCH' | 'DONE';

export interface WorkerInitPayload {
  directoryMap: [string, string[]][];
  allDirectories: string[];
}

export interface WorkerComputePayload {
  selectedPaths: string[];
  priorityPaths: string[];
  batchSize: number;
}

export interface WorkerBatchPayload {
  updates: [string, 'f' | 'p' | 'n'][];
}

export type WorkerPayload = 
  | WorkerInitPayload 
  | WorkerComputePayload 
  | WorkerBatchPayload
  | undefined;

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: WorkerPayload;
}

export interface WorkerBatchUpdate {
  updates: [string, 'f' | 'p' | 'n'][];
}

export interface ProgressiveRecomputeOptions {
  selectedPaths: Set<string>;
  priorityPaths?: readonly string[];
  batchSize?: number;
}

export interface ProgressiveRecomputeState {
  computing: boolean;
  progress: number;
  currentTaskId: number;
  cancelIdle: (() => void) | null;
  allowOnDemandCompute: boolean;
  workerListener: ((ev: MessageEvent) => void) | null;
  workerRef: Worker | null;
}

export interface CacheInterfaceParams {
  cache: Map<string, SelectionState>;
  directoryMap: Map<string, Set<string>>;
  allDirectories: Set<string>;
  selectedPaths: Set<string>;
  onBatchApplied?: (batchSize: number, totalApplied: number) => void;
}

/**
 * Validate if a value is a valid selection state
 */
export function isValidSelectionState(state: unknown): state is SelectionState {
  return state === 'full' || state === 'partial' || state === 'none';
}

/**
 * Apply selection state to cache with mirroring for leading slash variants
 */
export function applyCacheUpdate(
  cache: Map<string, SelectionState>,
  path: string,
  state: SelectionState
): void {
  cache.set(path, state);
  // Mirror leading-slash variant except when empty string
  if (path !== '') {
    const altPath = path.startsWith('/') ? path.slice(1) : ('/' + path);
    cache.set(altPath, state);
  }
}

/**
 * Get selection state from cache with fallback to alternate path
 */
export function getCacheValue(
  cache: Map<string, SelectionState>,
  path: string
): SelectionState | undefined {
  const direct = cache.get(path);
  if (direct !== undefined) return direct;
  
  const altPath = path.startsWith('/') ? path.slice(1) : ('/' + path);
  return cache.get(altPath);
}

/**
 * Compute path depth for prioritization
 */
export function pathDepth(p: string): number {
  if (!p) return 0;
  const parts = p.split('/').filter(Boolean);
  return parts.length;
}

/**
 * Sort directories by priority (visible/expanded first, then by depth)
 */
export function prioritizeDirectories(
  allDirectories: Set<string>,
  priorityPaths?: readonly string[]
): string[] {
  const allDirs = [...allDirectories];
  const prioritySet = new Set<string>(priorityPaths || []);
  
  return [
    ...allDirs.filter(p => prioritySet.has(p)),
    ...allDirs.filter(p => !prioritySet.has(p)).sort((a, b) => pathDepth(a) - pathDepth(b))
  ];
}

/**
 * Initialize worker for offloaded computation
 */
export function initializeWorker(
  worker: Worker,
  directoryMap: Map<string, Set<string>>,
  allDirectories: Set<string>
): void {
  const dirMapArray: [string, string[]][] = [];
  for (const [dir, files] of directoryMap.entries()) {
    dirMapArray.push([dir, [...files]]);
  }
  const allDirsArray = [...allDirectories.values()];
  
  try {
    worker.postMessage({
      type: 'INIT',
      payload: { directoryMap: dirMapArray, allDirectories: allDirsArray }
    });
  } catch {
    // Fallback to main-thread path if INIT fails
  }
}

/**
 * Send compute request to worker
 */
export function sendComputeToWorker(
  worker: Worker,
  selectedPaths: Set<string>,
  prioritySet: Set<string>,
  batchSize: number
): void {
  worker.postMessage({
    type: 'COMPUTE',
    payload: {
      selectedPaths: [...selectedPaths.values()],
      priorityPaths: [...prioritySet.values()],
      batchSize
    }
  });
}

/**
 * Cancel worker computation
 */
export function cancelWorkerComputation(worker: Worker): void {
  try {
    worker.postMessage({ type: 'CANCEL' });
  } catch {
    // ignore
  }
}

/**
 * Process worker batch update
 */
export function processWorkerBatch(
  cache: Map<string, SelectionState>,
  updates: [string, 'f' | 'p' | 'n'][],
  onBatchApplied?: (batchSize: number, totalApplied: number) => void
): number {
  let batchSizeApplied = 0;
  
  for (const [dir, code] of updates) {
    const state: SelectionState = code === 'f' ? 'full' : (code === 'p' ? 'partial' : 'none');
    applyCacheUpdate(cache, dir, state);
    batchSizeApplied++;
  }
  
  onBatchApplied?.(batchSizeApplied, batchSizeApplied);
  return batchSizeApplied;
}

/**
 * Clean up worker listener
 */
export function cleanupWorkerListener(
  worker: Worker | null,
  listener: ((ev: MessageEvent) => void) | null
): void {
  if (worker && listener) {
    cancelWorkerComputation(worker);
    worker.removeEventListener('message', listener);
  }
}

export type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

interface WindowWithIdleCallback {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Schedule idle callback with robust fallback
 */
export function scheduleIdle(cb: (deadline: IdleDeadline) => void): {
  cancel: () => void;
} {
  let cancelled = false;
  const windowWithIdle = (typeof window === 'undefined' ? {} : window) as WindowWithIdleCallback;
  const hasIdleCallback = typeof window !== 'undefined' && typeof windowWithIdle.requestIdleCallback === 'function';
  
  if (hasIdleCallback && windowWithIdle.requestIdleCallback) {
    const handle = windowWithIdle.requestIdleCallback((deadline: IdleDeadline) => {
      if (!cancelled) cb(deadline);
    });
    return {
      cancel: () => {
        cancelled = true;
        windowWithIdle.cancelIdleCallback?.(handle);
      }
    };
  } else {
    const handle = setTimeout(() => {
      if (!cancelled) cb({ didTimeout: true, timeRemaining: () => 0 });
    }, 0);
    return {
      cancel: () => {
        cancelled = true;
        clearTimeout(handle);
      }
    };
  }
}

/**
 * Check if we can use web workers
 */
export function canUseOverlayWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

/**
 * Try to get overlay worker instance
 */
export function tryGetOverlayWorker(): Worker | null {
  if (!canUseOverlayWorker()) return null;
  
  try {
    // Try to use import.meta.url when available
    // This is wrapped in a try-catch because import.meta may not be available in all environments
    const hasImportMeta = (globalThis as { importMeta?: { url: string } }).importMeta !== undefined;
    if (hasImportMeta && 'import' in globalThis) {
      // Use dynamic construction to avoid syntax errors in environments without import.meta
      const metaUrl = new Function('return import.meta.url')() as string;
      const workerUrl = new URL('../workers/selection-overlay-worker.ts', metaUrl);
      return new Worker(workerUrl, { type: 'module' });
    }
  } catch {
    // Fall through to dev path
  }
  
  // Fallback dev path (served by Vite)
  try {
    return new Worker('/src/workers/selection-overlay-worker.ts', { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * Validate and process cache.set parameters
 */
export function validateCacheSetParams(
  path: unknown,
  state: unknown
): { valid: boolean; path?: string; state?: SelectionState } {
  if (typeof path !== 'string') {
    console.warn('Invalid path provided to cache.set:', path);
    return { valid: false };
  }
  if (!isValidSelectionState(state)) {
    console.warn('Invalid selection state provided to cache.set:', state);
    return { valid: false };
  }
  return { valid: true, path, state };
}

/**
 * Validate and process bulk update parameters
 */
export function processBulkUpdates(
  updates: Map<string, SelectionState>,
  cache: Map<string, SelectionState>
): number {
  if (!(updates instanceof Map)) {
    console.warn('Invalid updates provided to cache.bulkUpdate:', updates);
    return 0;
  }
  
  let applied = 0;
  for (const [path, state] of updates) {
    if (typeof path === 'string' && isValidSelectionState(state)) {
      applyCacheUpdate(cache, path, state);
      applied += 1;
    } else {
      console.warn('Skipping invalid update:', { path, state });
    }
  }
  
  return applied;
}

/**
 * Handle on-demand compute for missing cache entries
 */
export function computeOnDemand(
  path: string,
  cache: Map<string, SelectionState>,
  allDirectories: Set<string>,
  computeStateForDir: (dirPath: string) => SelectionState,
  onBatchApplied?: (batchSize: number, totalApplied: number) => void
): SelectionState {
  // Check if path exists in directory set
  let canonical: string | null = null;
  if (allDirectories.has(path)) {
    canonical = path;
  } else {
    const altPath = path.startsWith('/') ? path.slice(1) : ('/' + path);
    if (allDirectories.has(altPath)) {
      canonical = altPath;
    }
  }
  
  if (!canonical) {
    return 'none';
  }
  
  const state = computeStateForDir(canonical);
  applyCacheUpdate(cache, canonical, state);
  
  // Notify minimal update for single path
  onBatchApplied?.(1, 0);
  return state;
}