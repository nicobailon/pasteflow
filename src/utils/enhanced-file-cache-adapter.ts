/**
 * Adapter that provides backwards compatibility for the old enhanced-file-cache API
 * while using the new unified cache service underneath
 */

import { getFileContentCache } from '../services/cache-service';

// Lazy initialization to ensure singleton pattern
let cache: ReturnType<typeof getFileContentCache> | null = null;

const getCache = () => {
  if (!cache) {
    cache = getFileContentCache();
  }
  return cache;
};

export const enhancedFileContentCache = {
  get(filePath: string): { content: string; tokenCount: number } | null {
    const entry = getCache().getFileContent(filePath);
    return entry || null;
  },
  
  set(filePath: string, content: string, tokenCount: number): void {
    getCache().setFileContent(filePath, content, tokenCount);
  },
  
  clear(): void {
    getCache().clear();
  },
  
  delete(filePath: string): void {
    getCache().delete(filePath);
  },
  
  getMetrics() {
    const stats = getCache().getStats();
    return {
      totalMemoryUsage: stats.size * 1024, // Rough estimate: 1KB average per entry
      totalEntries: stats.size,
      hitRate: stats.hitRate,
      evictionCount: 0 // Not tracked in new implementation  
    };
  },
  
  getMemoryUsageMB() {
    const stats = getCache().getStats();
    // Estimate based on cache size - assume average 1KB per entry
    return (stats.size * 1024) / (1024 * 1024);
  }
};