import { DirectorySelectionCache } from '../types/file-types';

import { SelectionState } from './selection-cache';
import { getGlobalPerformanceMonitor } from './performance-monitor';
import {
  type WorkerBatchUpdate,
  type CacheInterfaceParams,
  type ProgressiveRecomputeOptions,
  applyCacheUpdate,
  getCacheValue,
  prioritizeDirectories,
  initializeWorker,
  sendComputeToWorker,
  cancelWorkerComputation,
  processWorkerBatch,
  cleanupWorkerListener,
  scheduleIdle,
  canUseOverlayWorker,
  validateCacheSetParams,
  processBulkUpdates,
  computeOnDemand
} from './selection-cache-helpers';

interface CacheState {
  selectedPathsRef: Set<string>;
  computing: boolean;
  progress: number;
  currentTaskId: number;
  cancelIdle: (() => void) | null;
  allowOnDemandCompute: boolean;
  workerListener: ((ev: MessageEvent) => void) | null;
  workerRef: Worker | null;
}

/**
 * Calculate selection state for a single directory
 */
export function calculateDirectorySelectionState(
  dirPath: string,
  directoryMap: Map<string, Set<string>>,
  selectedPaths: Set<string>
): SelectionState {
  const filesInDir = directoryMap.get(dirPath) || new Set();
  
  if (filesInDir.size === 0) {
    return 'none';
  }
  
  let selectedCount = 0;
  for (const filePath of filesInDir) {
    if (selectedPaths.has(filePath)) {
      selectedCount++;
    }
  }
  
  if (selectedCount === 0) {
    return 'none';
  } else if (selectedCount === filesInDir.size) {
    return 'full';
  } else {
    return 'partial';
  }
}

/**
 * Create worker message handler for batch processing
 */
function createWorkerMessageHandler(
  state: CacheState,
  cache: Map<string, SelectionState>,
  taskId: number,
  total: number,
  onBatchApplied: ((batchSize: number, totalApplied: number) => void) | undefined,
  endMeasure: () => void
): (ev: MessageEvent) => void {
  const monitor = getGlobalPerformanceMonitor();
  let applied = 0;
  
  return (ev: MessageEvent) => {
    if (taskId !== state.currentTaskId) return; // stale
    
    const data = ev.data as { type: string; payload?: WorkerBatchUpdate };
    if (!data || typeof data.type !== 'string') return;
    
    if (data.type === 'BATCH' && data.payload && Array.isArray(data.payload.updates)) {
      const batchSizeApplied = processWorkerBatch(cache, data.payload.updates, onBatchApplied);
      applied += batchSizeApplied;
      state.progress = Math.min(1, applied / total);
    } else if (data.type === 'DONE') {
      if (state.workerRef && state.workerListener) {
        state.workerRef.removeEventListener('message', state.workerListener);
      }
      state.workerListener = null;
      if (taskId === state.currentTaskId) {
        state.computing = false;
        state.progress = 1;
        endMeasure();
        monitor.recordMetric('overlay.batch.count', 1);
      }
    }
  };
}

/**
 * Setup worker-based progressive recompute
 */
function setupWorkerRecompute(
  state: CacheState,
  worker: Worker,
  cache: Map<string, SelectionState>,
  params: CacheInterfaceParams,
  taskId: number,
  total: number,
  prioritySet: Set<string>,
  batchSize: number,
  endMeasure: () => void
): { cancel: () => void } {
  // Clean up previous listener if exists
  if (state.workerRef && state.workerListener) {
    try {
      state.workerRef.postMessage({ type: 'CANCEL' });
    } catch {
      // ignore
    }
    state.workerRef.removeEventListener('message', state.workerListener);
    state.workerListener = null;
  }
  
  state.workerRef = worker;
  
  // Initialize worker
  initializeWorker(worker, params.directoryMap, params.allDirectories);
  
  // Create and attach message handler
  const onMessage = createWorkerMessageHandler(
    state, cache, taskId, total, params.onBatchApplied, endMeasure
  );
  
  worker.addEventListener('message', onMessage);
  state.workerListener = onMessage;
  
  // Send compute request
  try {
    sendComputeToWorker(worker, state.selectedPathsRef, prioritySet, batchSize);
  } catch {
    worker.removeEventListener('message', onMessage);
    state.workerListener = null;
    return {
      cancel: () => {
        if (taskId === state.currentTaskId) {
          state.currentTaskId++;
          state.computing = false;
          state.progress = 1;
        }
      }
    };
  }
  
  return {
    cancel: () => {
      if (taskId === state.currentTaskId) {
        state.currentTaskId++;
        cancelWorkerComputation(worker);
        if (state.workerListener) {
          worker.removeEventListener('message', state.workerListener);
          state.workerListener = null;
        }
        state.computing = false;
        state.progress = 1;
      }
    }
  };
}

/**
 * Setup main-thread progressive recompute
 */
function setupMainThreadRecompute(
  state: CacheState,
  cache: Map<string, SelectionState>,
  params: CacheInterfaceParams,
  taskId: number,
  prioritized: string[],
  batchSize: number,
  endMeasure: () => void
): { cancel: () => void } {
  const monitor = getGlobalPerformanceMonitor();
  const total = prioritized.length;
  let index = 0;
  let batchCount = 0;
  let totalApplied = 0;
  
  const runBatch = () => {
    if (taskId !== state.currentTaskId) {
      return; // Cancelled
    }
    
    const start = index;
    const end = Math.min(index + batchSize, total);
    const endBatch = monitor.startMeasure('overlay.compute.batch.ms');
    
    // Compute batch
    let appliedThisBatch = 0;
    for (let i = start; i < end; i++) {
      const dir = prioritized[i];
      const selState = calculateDirectorySelectionState(
        dir, params.directoryMap, state.selectedPathsRef
      );
      applyCacheUpdate(cache, dir, selState);
      appliedThisBatch++;
    }
    
    endBatch();
    
    index = end;
    batchCount++;
    totalApplied += appliedThisBatch;
    params.onBatchApplied?.(appliedThisBatch, totalApplied);
    state.progress = index / total;
    
    if (index < total) {
      const sched = scheduleIdle(() => runBatch());
      state.cancelIdle = sched.cancel;
    } else {
      state.computing = false;
      state.progress = 1;
      endMeasure();
      monitor.recordMetric('overlay.batch.count', batchCount);
      monitor.recordMetric('overlay.batch.size.avg', totalApplied / Math.max(1, batchCount));
    }
  };
  
  // Kick off first batch synchronously
  runBatch();
  
  return {
    cancel: () => {
      if (taskId === state.currentTaskId) {
        state.currentTaskId++;
        if (state.cancelIdle) {
          state.cancelIdle();
          state.cancelIdle = null;
        }
        state.computing = false;
        state.progress = 1;
      }
    }
  };
}

/**
 * Create the directory selection cache interface
 */
export function createCacheInterface(
  params: CacheInterfaceParams,
  cache: Map<string, SelectionState>,
  getOverlayWorker: () => Worker | null
): DirectorySelectionCache {
  const monitor = getGlobalPerformanceMonitor();
  
  // Initialize state
  const state: CacheState = {
    selectedPathsRef: params.selectedPaths,
    computing: false,
    progress: 1,
    currentTaskId: 0,
    cancelIdle: null,
    allowOnDemandCompute: cache.size === 0,
    workerListener: null,
    workerRef: null
  };
  
  const computeStateForDir = (dirPath: string): SelectionState => {
    return calculateDirectorySelectionState(dirPath, params.directoryMap, state.selectedPathsRef);
  };
  
  const startProgressiveRecompute = (opts: ProgressiveRecomputeOptions): { cancel: () => void } => {
    // Cancel previous task
    state.currentTaskId++;
    const taskId = state.currentTaskId;
    if (state.cancelIdle) {
      state.cancelIdle();
      state.cancelIdle = null;
    }
    
    state.selectedPathsRef = opts.selectedPaths;
    const prioritized = prioritizeDirectories(params.allDirectories, opts.priorityPaths);
    const total = prioritized.length;
    
    if (total === 0) {
      state.computing = false;
      state.progress = 1;
      return { cancel: () => { /* no-op */ } };
    }
    
    const BATCH = Math.max(200, Math.min(opts.batchSize ?? 1000, 4000));
    const endMeasure = monitor.startMeasure('overlay.compute.progressive.ms');
    
    state.computing = true;
    state.progress = 0;
    state.allowOnDemandCompute = true;
    
    // Record metrics
    const coverage = (opts.priorityPaths?.length ?? 0) / Math.max(1, total);
    monitor.recordMetric('overlay.visibleFirst.coverage', coverage);
    
    // Use worker for large graphs
    const useWorker = total > 8000 && canUseOverlayWorker();
    if (useWorker) {
      const worker = getOverlayWorker();
      if (worker) {
        const prioritySet = new Set<string>(opts.priorityPaths || []);
        return setupWorkerRecompute(
          state, worker, cache, params, taskId, total, prioritySet, BATCH, endMeasure
        );
      }
    }
    
    // Fallback to main thread
    return setupMainThreadRecompute(
      state, cache, params, taskId, prioritized, BATCH, endMeasure
    );
  };
  
  return {
    get(path: string): SelectionState {
      if (typeof path !== 'string') {
        console.warn('Invalid path provided to cache.get:', path);
        return 'none';
      }
      
      if (path === '') {
        return 'none';
      }
      
      const cached = getCacheValue(cache, path);
      if (cached !== undefined) return cached;
      
      if (!state.allowOnDemandCompute) {
        return 'none';
      }
      
      return computeOnDemand(
        path, cache, params.allDirectories, computeStateForDir, params.onBatchApplied
      );
    },
    
    set(path: string, selState: SelectionState): void {
      const validated = validateCacheSetParams(path, selState);
      if (!validated.valid || !validated.path || !validated.state) return;
      
      applyCacheUpdate(cache, validated.path, validated.state);
      params.onBatchApplied?.(1, 0);
    },
    
    bulkUpdate(updates: Map<string, SelectionState>): void {
      const applied = processBulkUpdates(updates, cache);
      if (applied > 0) {
        params.onBatchApplied?.(applied, 0);
      }
    },
    
    clear(): void {
      cache.clear();
      state.computing = false;
      state.progress = 1;
      state.allowOnDemandCompute = false;
      params.onBatchApplied?.(0, 0);
    },
    
    isComputing(): boolean {
      return state.computing;
    },
    
    getProgress(): number {
      return state.progress;
    },
    
    startProgressiveRecompute,
    
    cancel(): void {
      state.currentTaskId++;
      if (state.cancelIdle) {
        state.cancelIdle();
        state.cancelIdle = null;
      }
      cleanupWorkerListener(state.workerRef, state.workerListener);
      state.workerListener = null;
      state.computing = false;
      state.progress = 1;
    },
    
    setSelectedPaths(paths: Set<string>): void {
      state.selectedPathsRef = paths;
    }
  };
}
