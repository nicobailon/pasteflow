import { useEffect, useRef, useCallback } from 'react';

import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';

// Match the worker's size limit
const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB

// Singleton instance outside React lifecycle
let globalWorkerPool: TokenWorkerPool | null = null;
let refCount = 0;

export function useTokenCounter() {
  const workerPoolRef = useRef<TokenWorkerPool | undefined>();
  const fallbackCountRef = useRef(0);
  
  useEffect(() => {
    // Use singleton instance with reference counting
    refCount++;
    console.log(`[useTokenCounter] Reference count: ${refCount}`);
    
    if (globalWorkerPool) {
      console.log('[useTokenCounter] Reusing existing singleton TokenWorkerPool');
    } else {
      console.log('[useTokenCounter] Creating singleton TokenWorkerPool');
      globalWorkerPool = new TokenWorkerPool();
      globalWorkerPool.monitorWorkerMemory();
    }
    
    workerPoolRef.current = globalWorkerPool;
    
    // Cleanup on unmount - only terminate if last reference
    return () => {
      refCount--;
      console.log(`[useTokenCounter] Cleanup - Reference count: ${refCount}`);
      
      if (refCount === 0) {
        console.log('[useTokenCounter] Last reference removed, terminating TokenWorkerPool');
        globalWorkerPool?.terminate();
        globalWorkerPool = null;
      }
    };
  }, []);
  
  const countTokens = useCallback(async (text: string): Promise<number> => {
    // Pre-validate input size to avoid unnecessary worker communication
    if (text.length > MAX_TEXT_SIZE) {
      console.warn(`Text too large for token counting (${(text.length / 1024 / 1024).toFixed(2)}MB), using estimation`);
      return estimateTokenCount(text);
    }
    
    // Check if worker pool is available
    if (!workerPoolRef.current) {
      console.warn('Worker pool not initialized, using estimation');
      return estimateTokenCount(text);
    }
    
    try {
      const count = await workerPoolRef.current.countTokens(text);
      if (count !== undefined) {
        fallbackCountRef.current = 0; // Reset fallback counter
        return count;
      }
    } catch (error) {
      console.warn('Token counting error:', error);
      fallbackCountRef.current++;
      
      // If too many failures, recreate the pool
      if (fallbackCountRef.current > 10) {
        console.warn('[useTokenCounter] Too many failures, recreating pool');
        globalWorkerPool?.terminate();
        globalWorkerPool = new TokenWorkerPool();
        globalWorkerPool.monitorWorkerMemory();
        workerPoolRef.current = globalWorkerPool;
        fallbackCountRef.current = 0;
      }
    }
    
    // Fallback to estimation
    return estimateTokenCount(text);
  }, []);
  
  const countTokensBatch = useCallback(async (texts: string[]): Promise<number[]> => {
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
            const count = await workerPoolRef.current!.countTokens(text);
            return count ?? estimateTokenCount(text);
          } catch {
            return estimateTokenCount(texts[index]);
          }
        })
      );
    } catch (error) {
      console.warn('Batch token counting error:', error);
    }
    
    // Fallback to estimation
    return texts.map(text => estimateTokenCount(text));
  }, []);
  
  const getPerformanceStats = useCallback(() => {
    return workerPoolRef.current?.getPerformanceStats() ?? {
      totalProcessed: 0,
      totalTime: 0,
      failureCount: 0,
      averageTime: 0,
      successRate: 0
    };
  }, []);
  
  return { 
    countTokens, 
    countTokensBatch, 
    getPerformanceStats,
    isReady: !!workerPoolRef.current 
  };
}