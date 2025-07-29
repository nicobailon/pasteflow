import { useEffect, useRef, useCallback } from 'react';

import { TokenWorkerPool } from '../utils/token-worker-pool';
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
interface ComponentTracker {
  readonly id: symbol;
}
const activeComponents = new WeakSet<ComponentTracker>();
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
         (Date.now() - lastActivityTime < 10000) || // Recent activity in last 10s
         isPageVisible;
}

function checkForCleanup() {
  if (!hasActiveComponents() && globalWorkerPool) {
    console.log('[useTokenCounter] No active components detected, scheduling cleanup');
    scheduleCleanup();
  }
}

function scheduleCleanup() {
  if (cleanupCoordinatorTimer) {
    clearTimeout(cleanupCoordinatorTimer);
  }
  
  cleanupCoordinatorTimer = setTimeout(() => {
    if (!hasActiveComponents() && globalWorkerPool) {
      console.log('[useTokenCounter] Cleanup coordinator: terminating pool');
      cleanupGlobalPool();
    }
    cleanupCoordinatorTimer = null;
  }, 5000); // 5 second delay for cleanup
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
        console.log('[useTokenCounter] Idle timeout reached, terminating unused pool');
        cleanupGlobalPool();
      }
    }, IDLE_TIMEOUT_MS);
  }
}

// Helper function to cleanup global pool
function cleanupGlobalPool(forceResetRefCount = true) {
  if (globalWorkerPool) {
    console.log('[useTokenCounter] Cleaning up global worker pool');
    if (typeof globalWorkerPool.terminate === 'function') {
      globalWorkerPool.terminate();
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
  }, 30000); // Check every 30 seconds
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
  
  return true;
}

export function useTokenCounter() {
  const workerPoolRef = useRef<TokenWorkerPool | null>(null);
  const fallbackCountRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Component identity for tracking
  const componentTracker = useRef<ComponentTracker>({ id: Symbol('token-counter-component') });
  
  useEffect(() => {
    // Create abort controller for this component instance
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    // Track component with WeakSet
    const tracker = componentTracker.current;
    activeComponents.add(tracker);
    
    // Use singleton instance with reference counting
    refCount++;
    console.log(`[useTokenCounter] Reference count: ${refCount}`);
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
    
    if (globalWorkerPool) {
      console.log('[useTokenCounter] Reusing existing singleton TokenWorkerPool');
    } else {
      console.log('[useTokenCounter] Creating singleton TokenWorkerPool');
      globalWorkerPool = new TokenWorkerPool();
      if (globalWorkerPool && typeof globalWorkerPool.monitorWorkerMemory === 'function') {
        globalWorkerPool.monitorWorkerMemory();
      }
      // Start memory monitoring when pool is created
      startMemoryMonitoring();
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
      
      // Remove component from tracking
      activeComponents.delete(tracker);
      
      refCount--;
      console.log(`[useTokenCounter] Cleanup - Reference count: ${refCount}`);
      
      if (refCount === 0) {
        console.log('[useTokenCounter] Last reference removed, scheduling idle cleanup');
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
  
  const countTokens = useCallback(async (text: string): Promise<number> => {
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
      console.log('[useTokenCounter] Recreating pool after force cleanup');
      globalWorkerPool = new TokenWorkerPool();
      if (globalWorkerPool && typeof globalWorkerPool.monitorWorkerMemory === 'function') {
        globalWorkerPool.monitorWorkerMemory();
      }
      workerPoolRef.current = globalWorkerPool;
    }
    
    // Check if worker pool is available
    if (!workerPoolRef.current) {
      console.warn('Worker pool not initialized, using estimation');
      return estimateTokenCount(text);
    }
    
    try {
      const count = await workerPoolRef.current.countTokens(text, { signal });
      
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
        console.log('[useTokenCounter] Operation aborted due to component unmount');
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
        if (globalWorkerPool && typeof globalWorkerPool.monitorWorkerMemory === 'function') {
          globalWorkerPool.monitorWorkerMemory();
        }
        workerPoolRef.current = globalWorkerPool;
        
        // Terminate old pool
        if (oldPool && typeof oldPool.terminate === 'function') {
          oldPool.terminate();
        }
        
        fallbackCountRef.current = 0;
        updateActivityTime();
      }
    }
    
    // Fallback to estimation
    return estimateTokenCount(text);
  }, []);
  
  const countTokensBatch = useCallback(async (texts: string[]): Promise<number[]> => {
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
      // Process valid texts through workers, use estimation for oversized ones
      return await Promise.all(
        validatedTexts.map(async (text, index) => {
          if (text === null) {
            return estimateTokenCount(texts[index]);
          }
          try {
            const count = await workerPoolRef.current!.countTokens(text, { signal });
            
            // Check if aborted after async operation
            if (signal?.aborted) {
              throw new DOMException('Component unmounted during batch operation', 'AbortError');
            }
            
            return count ?? estimateTokenCount(text);
          } catch (error) {
            // Handle abort silently
            if (error instanceof DOMException && error.name === 'AbortError') {
              throw error; // Re-throw to be caught by outer try-catch
            }
            return estimateTokenCount(texts[index]);
          }
        })
      );
    } catch (error) {
      // Handle abort silently
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('[useTokenCounter] Batch operation aborted due to component unmount');
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
    console.log('[useTokenCounter] Force cleanup requested');
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
  console.log('[useTokenCounter] Global force cleanup requested');
  cleanupGlobalPool(true); // Reset refCount for global cleanup
}