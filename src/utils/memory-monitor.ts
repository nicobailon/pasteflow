import { MEMORY } from '../constants/app-constants';

/**
 * Memory monitoring utility for tracking cache usage across the application.
 * Helps prevent memory leaks by monitoring and reporting on cache sizes.
 */

export interface CacheStats {
  name: string;
  size: number;
  estimatedMemoryMB: number;
}

export interface MemoryStats {
  caches: CacheStats[];
  totalMemoryMB: number;
  timestamp: number;
}

export class MemoryMonitor {
  private caches: Map<string, { getSize: () => number; estimateMemory: () => number }> = new Map();
  private warningThresholdMB: number = MEMORY.WARNING_THRESHOLD_MB;
  private criticalThresholdMB: number = MEMORY.CRITICAL_THRESHOLD_MB;
  
  /**
   * Register a cache for monitoring
   */
  registerCache(
    name: string, 
    getSize: () => number,
    estimateMemory: () => number
  ): void {
    this.caches.set(name, { getSize, estimateMemory });
  }
  
  /**
   * Unregister a cache from monitoring
   */
  unregisterCache(name: string): void {
    this.caches.delete(name);
  }
  
  /**
   * Get current memory statistics for all registered caches
   */
  getStats(): MemoryStats {
    const cacheStats: CacheStats[] = [];
    let totalMemoryMB = 0;
    
    for (const [name, cache] of this.caches) {
      try {
        const size = cache.getSize();
        const estimatedMemoryMB = cache.estimateMemory();
        
        cacheStats.push({
          name,
          size,
          estimatedMemoryMB
        });
        
        totalMemoryMB += estimatedMemoryMB;
      } catch (error) {
        console.error(`Error getting stats for cache ${name}:`, error);
      }
    }
    
    return {
      caches: cacheStats,
      totalMemoryMB,
      timestamp: Date.now()
    };
  }
  
  /**
   * Check memory usage and log warnings if thresholds are exceeded
   */
  checkMemoryUsage(): { level: 'ok' | 'warning' | 'critical'; stats: MemoryStats } {
    const stats = this.getStats();
    
    let level: 'ok' | 'warning' | 'critical' = 'ok';
    
    if (stats.totalMemoryMB >= this.criticalThresholdMB) {
      level = 'critical';
      console.error(`CRITICAL: Cache memory usage (${stats.totalMemoryMB.toFixed(2)}MB) exceeds critical threshold (${this.criticalThresholdMB}MB)`);
      this.logCacheDetails(stats);
    } else if (stats.totalMemoryMB >= this.warningThresholdMB) {
      level = 'warning';
      console.warn(`WARNING: Cache memory usage (${stats.totalMemoryMB.toFixed(2)}MB) exceeds warning threshold (${this.warningThresholdMB}MB)`);
      this.logCacheDetails(stats);
    }
    
    return { level, stats };
  }
  
  /**
   * Log detailed cache information
   */
  private logCacheDetails(stats: MemoryStats): void {
    console.table(
      stats.caches
        .sort((a, b) => b.estimatedMemoryMB - a.estimatedMemoryMB)
        .map(cache => ({
          Cache: cache.name,
          'Size': cache.size,
          'Memory (MB)': cache.estimatedMemoryMB.toFixed(2)
        }))
    );
  }
  
  /**
   * Set custom thresholds
   */
  setThresholds(warningMB: number, criticalMB: number): void {
    this.warningThresholdMB = warningMB;
    this.criticalThresholdMB = criticalMB;
  }
  
  /**
   * Start periodic monitoring
   */
  startPeriodicMonitoring(intervalMs: number = MEMORY.MONITOR_INTERVAL_MS): () => void {
    const intervalId = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);
    
    // Return cleanup function
    return () => clearInterval(intervalId);
  }
}

// Export singleton instance
export const memoryMonitor = new MemoryMonitor();

// Helper to estimate string memory usage
export function estimateStringMemoryMB(str: string): number {
  // Approximate: bytes per character from constants
  return (str.length * MEMORY.BYTES_PER_CHAR) / (1024 * 1024);
}

// Helper to estimate object memory usage (rough approximation)
export function estimateObjectMemoryMB(obj: unknown): number {
  try {
    const jsonStr = JSON.stringify(obj);
    return estimateStringMemoryMB(jsonStr);
  } catch {
    // If can't stringify, estimate based on property count
    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj);
      // Rough estimate using centralized constant
      return (keys.length * MEMORY.BYTES_PER_PROPERTY) / (1024 * 1024);
    }
    return 0;
  }
}