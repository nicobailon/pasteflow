/**
 * Central registry for all application caches.
 * Registers caches with the memory monitor for tracking and alerting.
 */

import { memoryMonitor, estimateObjectMemoryMB } from './memory-monitor';
import { getTreeSortingService } from './tree-sorting-service';
import { getFlattenCacheStats } from './tree-node-transform';
import { enhancedFileContentCache } from './enhanced-file-cache-adapter';
import { tokenCountCache } from './token-cache-adapter';

/**
 * Register all application caches with the memory monitor
 */
export function registerAllCaches(): void {
  // Register tree sorting cache
  const treeSortingService = getTreeSortingService();
  memoryMonitor.registerCache(
    'tree-sorting',
    () => treeSortingService.getCacheStats().entries,
    () => {
      const stats = treeSortingService.getCacheStats();
      // Estimate memory based on average entry size
      // Each entry has: key (string) + sorted nodes array
      const avgEntrySize = stats.entries > 0 ? 
        estimateObjectMemoryMB({ sample: 'tree-node-data' }) * 10 : // Rough estimate per entry
        0;
      return stats.entries * avgEntrySize;
    }
  );
  
  // Register flatten cache
  memoryMonitor.registerCache(
    'tree-flatten',
    () => getFlattenCacheStats().size,
    () => getFlattenCacheStats().estimatedMemoryMB
  );
  
  // Register enhanced file content cache
  memoryMonitor.registerCache(
    'file-content',
    () => enhancedFileContentCache.getMetrics().totalEntries,
    () => enhancedFileContentCache.getMemoryUsageMB()
  );
  
  // Register token count cache
  memoryMonitor.registerCache(
    'token-count',
    () => tokenCountCache.size(),
    () => tokenCountCache.estimateMemoryUsage()
  );
}

/**
 * Start periodic memory monitoring in development mode
 */
export function startMemoryMonitoring(): () => void {
  // Only enable in development builds
  if (process.env.NODE_ENV === 'development') {
    console.log('Memory monitoring enabled for development');
    return memoryMonitor.startPeriodicMonitoring();
  }
  
  // Return no-op cleanup function in production
  return () => {};
}

/**
 * Initialize cache registry and monitoring
 */
export function initializeCacheRegistry(): () => void {
  registerAllCaches();
  return startMemoryMonitoring();
}