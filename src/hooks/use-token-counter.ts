import { useEffect, useRef, useCallback } from 'react';

import { TokenWorkerPool } from '../workers/pools/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';

// Match the worker's size limit
const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB

// Singleton instance outside React lifecycle
let globalWorkerPool: TokenWorkerPool | null = null;
let refCount = 0;
let idleTimeoutId: NodeJS.Timeout | null = null;
let lastActivityTime = Date.now();

// Configuration for idle cleanup
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Activity tracking
let cleanupCoordinatorTimer: NodeJS.Timeout | null = null;

// Page visibility tracking
let isPageVisible = true;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (!isPageVisible) {
      checkForCleanup();
    }
  });
}

// Memory pressure detection
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

function checkMemoryPressure(): boolean {
  if (typeof performance === 'undefined') return false;
  
  const perf = performance as PerformanceWithMemory;
  if (!perf.memory) return false;
  
  const { usedJSHeapSize, jsHeapSizeLimit } = perf.memory;
  return usedJSHeapSize / jsHeapSizeLimit > 0.9;
}

// Cleanup coordinator
function hasActiveComponents(): boolean {
  // Check various conditions to determine if cleanup is safe
  return refCount > 0 || 
         (Date.now() - lastActivityTime < 10_000) || // Recent activity in last 10s
         isPageVisible;
}

function checkForCleanup() {
  if (!hasActiveComponents() && globalWorkerPool) {
    scheduleCleanup();
  }
}

function scheduleCleanup() {
  if (cleanupCoordinatorTimer) {
    clearTimeout(cleanupCoordinatorTimer);
  }
  
  cleanupCoordinatorTimer = setTimeout(() => {
    if (!hasActiveComponents() && globalWorkerPool) {
      cleanupGlobalPool();
    }
    cleanupCoordinatorTimer = null;
  }, 5000); // 5 second delay for cleanup
}

// Window/process cleanup handlers for edge cases
if (typeof window !== 'undefined') {
  // HMR guard: Prevent duplicate listener registration in development
  const windowWithFlag = window as Window & { __PF_tokenHookBound?: boolean };
  
  if (!windowWithFlag.__PF_tokenHookBound) {
    windowWithFlag.__PF_tokenHookBound = true;
    
    // Handle window unload
    const handleUnload = () => {
      if (globalWorkerPool) {
        cleanupGlobalPool(true);
      }
    };
    
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    
    // Handle errors that might leave pool in bad state
    window.addEventListener('error', (event) => {
      if (event.error && event.error.message && 
          (event.error.message.includes('Worker') || event.error.message.includes('WebAssembly'))) {
        console.error('[useTokenCounter] Critical error detected, checking pool health');
        verifyPoolHealth();
      }
    });
  }
}

// Helper function to update activity time
function updateActivityTime() {
  lastActivityTime = Date.now();
  scheduleIdleCleanup();
}

// Helper function to schedule idle cleanup
function scheduleIdleCleanup() {
  // Clear existing timeout
  if (idleTimeoutId) {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
  }
  
  // Only schedule cleanup if pool exists and no active references
  if (globalWorkerPool && refCount === 0) {
    idleTimeoutId = setTimeout(() => {
      const idleTime = Date.now() - lastActivityTime;
      if (idleTime >= IDLE_TIMEOUT_MS && refCount === 0) {
        cleanupGlobalPool();
      }
    }, IDLE_TIMEOUT_MS);
  }
}

// Helper function to cleanup global pool
function cleanupGlobalPool(forceResetRefCount = true) {
  if (globalWorkerPool) {
    if (typeof globalWorkerPool.cleanup === 'function') {
      globalWorkerPool.cleanup();
    }
    globalWorkerPool = null;
  }
  
  if (idleTimeoutId) {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
  }
  
  if (cleanupCoordinatorTimer) {
    clearTimeout(cleanupCoordinatorTimer);
    cleanupCoordinatorTimer = null;
  }
  
  // Stop memory monitoring
  stopMemoryMonitoring();
  
  // Stop orphan check
  stopOrphanCheck();
  
  // Reset counters as a safety measure only when force cleanup
  if (forceResetRefCount && refCount !== 0) {
    console.warn(`[useTokenCounter] Reference count mismatch during cleanup: ${refCount}`);
    refCount = 0;
  }
}

// Memory pressure monitoring
let memoryMonitorInterval: NodeJS.Timeout | null = null;

function startMemoryMonitoring() {
  if (memoryMonitorInterval || typeof performance === 'undefined') return;
  
  // Skip memory monitoring in test environment
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return;
  }
  
  memoryMonitorInterval = setInterval(() => {
    if (checkMemoryPressure()) {
      console.warn('[useTokenCounter] Memory pressure detected, forcing cleanup');
      cleanupGlobalPool();
      
      // Stop monitoring after cleanup
      if (memoryMonitorInterval) {
        clearInterval(memoryMonitorInterval);
        memoryMonitorInterval = null;
      }
    }
  }, 30_000); // Check every 30 seconds
}

function stopMemoryMonitoring() {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
  }
}

// Helper function to verify pool health
function verifyPoolHealth(): boolean {
  if (!globalWorkerPool) {
    return refCount === 0;
  }
  
  // If we have a pool but no references, it might be a leak
  if (refCount === 0) {
    console.warn('[useTokenCounter] Pool exists with zero references, scheduling cleanup');
    scheduleIdleCleanup();
    return false;
  }
  
  // Check if pool is in a bad state
  if (typeof globalWorkerPool.getStats === 'function') {
    const stats = globalWorkerPool.getStats();
    if (stats.isTerminated || (stats.healthyWorkers === 0 && refCount > 0)) {
      console.error('[useTokenCounter] Pool in bad state, recreating');
      const oldPool = globalWorkerPool;
      globalWorkerPool = null;
      
      try {
        if (oldPool && typeof oldPool.cleanup === 'function') {
          oldPool.cleanup();
        }
      } catch (error) {
        console.error('[useTokenCounter] Error cleaning up bad pool:', error);
      }
      
      return false;
    }
  }
  
  return true;
}

// Periodic orphan cleanup check
let orphanCheckInterval: NodeJS.Timeout | null = null;

function startOrphanCheck() {
  if (orphanCheckInterval) return;
  
  // Skip orphan check in test environment to avoid interference
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return;
  }
  
  // Don't start orphan check immediately, wait for one interval first
  orphanCheckInterval = setInterval(() => {
    // Only run if we think there are no components but pool exists
    if (refCount === 0 && globalWorkerPool) {
      const timeSinceActivity = Date.now() - lastActivityTime;
      
      // If truly orphaned (no activity for 2 minutes and no refs)
      // This gives enough time for components to remount
      if (timeSinceActivity > 120_000) {
        console.warn('[useTokenCounter] Orphaned pool detected, forcing cleanup');
        cleanupGlobalPool(true);
        
        // Stop checking after cleanup
        if (orphanCheckInterval) {
          clearInterval(orphanCheckInterval);
          orphanCheckInterval = null;
        }
      }
    } else if (refCount > 0 && orphanCheckInterval) {
      // Stop checking if we have active references
      clearInterval(orphanCheckInterval);
      orphanCheckInterval = null;
    }
  }, 120_000); // Check every 2 minutes to avoid false positives
}

function stopOrphanCheck() {
  if (orphanCheckInterval) {
    clearInterval(orphanCheckInterval);
    orphanCheckInterval = null;
  }
}

export function useTokenCounter() {
  const workerPoolRef = useRef(null as TokenWorkerPool | null);
  const fallbackCountRef = useRef(0);
  const abortControllerRef = useRef(null as AbortController | null);
  
  useEffect(() => {
    // Create abort controller for this component instance
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    // Use singleton instance with reference counting
    refCount++;
    updateActivityTime();
    
    // Clear any pending cleanup since we have a new reference
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }
    
    if (cleanupCoordinatorTimer) {
      clearTimeout(cleanupCoordinatorTimer);
      cleanupCoordinatorTimer = null;
    }
    
    if (!globalWorkerPool) {
      globalWorkerPool = new TokenWorkerPool();
      // monitorWorkerMemory method removed after worker-base refactor
      // Start memory monitoring when pool is created
      startMemoryMonitoring();
      // Start orphan check for edge case cleanup
      startOrphanCheck();
    }
    
    workerPoolRef.current = globalWorkerPool;
    
    // Verify pool health periodically
    const healthCheckInterval = setInterval(() => {
      verifyPoolHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    
    // Cleanup on unmount - only terminate if last reference
    return () => {
      // Abort all pending operations for this component
      abortController.abort();
      
      clearInterval(healthCheckInterval);
      
      // Cleanup complete
      
      refCount--;
      
      if (refCount === 0) {
        scheduleIdleCleanup();
        checkForCleanup();
      } else if (refCount < 0) {
        // Safety check for reference count going negative
        console.error('[useTokenCounter] Reference count went negative, resetting to 0');
        refCount = 0;
        scheduleIdleCleanup();
        checkForCleanup();
      }
    };
  }, []);
  
  const countTokens = useCallback(async (text: string, priority = 0): Promise<number> => {
    // Update activity time on usage
    updateActivityTime();
    
    // Get abort signal for this operation
    const signal = abortControllerRef.current?.signal;
    
    // Check if already aborted
    if (signal?.aborted) {
      throw new DOMException('Component unmounted', 'AbortError');
    }
    
    // Handle invalid inputs
    if (text === null || text === undefined || typeof text !== 'string') {
      return estimateTokenCount(String(text || ''));
    }
    
    // Pre-validate input size to avoid unnecessary worker communication
    if (text.length > MAX_TEXT_SIZE) {
      console.warn(`Text too large for token counting (${(text.length / 1024 / 1024).toFixed(2)}MB), using estimation`);
      return estimateTokenCount(text);
    }
    
    // Check if pool needs to be recreated after force cleanup
    if (!globalWorkerPool && refCount > 0) {
      globalWorkerPool = new TokenWorkerPool();
      // monitorWorkerMemory method removed after worker-base refactor
      workerPoolRef.current = globalWorkerPool;
      // Restart monitoring for the new pool
      startMemoryMonitoring();
      startOrphanCheck();
    }
    
    // Check if worker pool is available
    if (!workerPoolRef.current) {
      console.warn('Worker pool not initialized, using estimation');
      return estimateTokenCount(text);
    }
    
    try {
      const count = await workerPoolRef.current.countTokens(text, { signal, priority });
      
      // Check again after async operation
      if (signal?.aborted) {
        throw new DOMException('Component unmounted during operation', 'AbortError');
      }
      
      if (count !== undefined) {
        fallbackCountRef.current = 0; // Reset fallback counter
        return count;
      }
    } catch (error) {
      // Handle abort silently
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 0;
      }
      
      console.warn('Token counting error:', error);
      fallbackCountRef.current++;
      
      // If too many failures, recreate the pool
      if (fallbackCountRef.current > 10 && refCount > 0) {
        console.warn('[useTokenCounter] Too many failures, recreating pool');
        const oldPool = globalWorkerPool;
        
        // Create new pool before terminating old one
        globalWorkerPool = new TokenWorkerPool();
        // monitorWorkerMemory method removed after worker-base refactor
        workerPoolRef.current = globalWorkerPool;
        
        // Cleanup old pool
        if (oldPool && typeof oldPool.cleanup === 'function') {
          oldPool.cleanup();
        }
        
        fallbackCountRef.current = 0;
        updateActivityTime();
      }
    }
    
    // Fallback to estimation
    return estimateTokenCount(text);
  }, []);
  
  const countTokensBatch = useCallback(async (texts: string[], options?: { priority?: number }): Promise<number[]> => {
    // Update activity time on usage
    updateActivityTime();
    
    // Get abort signal for this operation
    const signal = abortControllerRef.current?.signal;
    
    // Check if already aborted
    if (signal?.aborted) {
      throw new DOMException('Component unmounted', 'AbortError');
    }
    
    // Pre-validate all text sizes
    const validatedTexts = texts.map(text => {
      if (text.length > MAX_TEXT_SIZE) {
        console.warn(`Text in batch too large (${(text.length / 1024 / 1024).toFixed(2)}MB), will use estimation`);
        return null;
      }
      return text;
    });
    
    // Check if worker pool is available
    if (!workerPoolRef.current) {
      console.warn('Worker pool not initialized, using estimation for batch');
      return texts.map(text => estimateTokenCount(text));
    }
    
    try {
      // Separate valid texts and their indices
      const validIndices: number[] = [];
      const validTexts: string[] = [];
      
      for (const [index, text] of validatedTexts.entries()) {
        if (text !== null) {
          validIndices.push(index);
          validTexts.push(text);
        }
      }
      
      // Count tokens for valid texts using batch method with priority
      const validResults = await workerPoolRef.current.countTokensBatch(validTexts, { signal, priority: options?.priority });
      
      // Combine results, using estimation for oversized texts
      const results: number[] = Array.from({length: texts.length});
      for (const [validIndex, originalIndex] of validIndices.entries()) {
        results[originalIndex] = validResults[validIndex];
      }
      
      // Fill in estimations for oversized texts
      for (const [index, text] of texts.entries()) {
        if (validatedTexts[index] === null) {
          results[index] = estimateTokenCount(text);
        }
      }
      
      return results;
    } catch (error) {
      // Handle abort silently
      if (error instanceof DOMException && error.name === 'AbortError') {
        return texts.map(() => 0);
      }
      
      console.warn('Batch token counting error:', error);
    }
    
    // Fallback to estimation
    return texts.map(text => estimateTokenCount(text));
  }, []);
  
  const getPerformanceStats = useCallback(() => {
    if (workerPoolRef.current && typeof workerPoolRef.current.getPerformanceStats === 'function') {
      return workerPoolRef.current.getPerformanceStats();
    }
    return {
      totalProcessed: 0,
      totalTime: 0,
      failureCount: 0,
      averageTime: 0,
      successRate: 0
    };
  }, []);
  
  const forceCleanup = useCallback(() => {
    if (refCount > 0) {
      console.warn(`[useTokenCounter] Force cleanup with active references: ${refCount}`);
    }
    cleanupGlobalPool(false); // Don't reset refCount during force cleanup
    // Clear local reference as well
    workerPoolRef.current = null;
  }, []);
  
  return { 
    countTokens, 
    countTokensBatch, 
    getPerformanceStats,
    isReady: !!globalWorkerPool,
    forceCleanup 
  };
}

// Export global cleanup function for edge cases
export function forceCleanupTokenWorkerPool() {
  cleanupGlobalPool(true); // Reset refCount for global cleanup
}
