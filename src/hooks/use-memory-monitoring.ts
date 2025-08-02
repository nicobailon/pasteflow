import { useEffect } from 'react';
import { memoryMonitor } from '../utils/memory-monitor';
import { fileContentCache } from '../utils/file-cache';
import { tokenCountCache } from '../utils/token-cache';
import { DirectorySelectionCache } from '../utils/selection-cache';

/**
 * Hook to set up memory monitoring for all application caches.
 * Registers caches with the memory monitor and starts periodic monitoring.
 */
export function useMemoryMonitoring(
  directorySelectionCache?: DirectorySelectionCache | null,
  folderIndexSize?: number
): void {
  useEffect(() => {
    // Register file content cache
    memoryMonitor.registerCache(
      'FileContentCache',
      () => fileContentCache.size(),
      () => fileContentCache.estimateMemoryUsage()
    );

    // Register token count cache
    memoryMonitor.registerCache(
      'TokenCountCache',
      () => tokenCountCache.size(),
      () => tokenCountCache.estimateMemoryUsage()
    );

    // Register directory selection cache if available
    if (directorySelectionCache) {
      // Since DirectorySelectionCache uses a Map internally, estimate based on entry count
      // Assume each entry is roughly 100 bytes (path string + state string)
      memoryMonitor.registerCache(
        'DirectorySelectionCache',
        () => {
          // Estimate size based on typical directory count
          return folderIndexSize || 0;
        },
        () => {
          // Rough estimate: 100 bytes per directory entry
          const size = folderIndexSize || 0;
          return (size * 100) / (1024 * 1024);
        }
      );
    }

    // Set thresholds based on typical Electron app constraints
    memoryMonitor.setThresholds(50, 100); // Warn at 50MB, critical at 100MB

    // Start periodic monitoring (every 30 seconds in production, every 5 seconds in dev)
    const intervalMs = process.env.NODE_ENV === 'development' ? 5000 : 30000;
    const cleanup = memoryMonitor.startPeriodicMonitoring(intervalMs);

    // Log initial stats in development
    if (process.env.NODE_ENV === 'development') {
      const stats = memoryMonitor.getStats();
      console.log('Memory monitoring initialized:', {
        totalCaches: stats.caches.length,
        totalMemoryMB: stats.totalMemoryMB.toFixed(2)
      });
    }

    return () => {
      cleanup();
      memoryMonitor.unregisterCache('FileContentCache');
      memoryMonitor.unregisterCache('TokenCountCache');
      if (directorySelectionCache) {
        memoryMonitor.unregisterCache('DirectorySelectionCache');
      }
    };
  }, [directorySelectionCache, folderIndexSize]);
}