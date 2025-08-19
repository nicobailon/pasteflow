/**
 * Adapter that provides backwards compatibility for the old token-cache API
 * while using the new unified cache service underneath
 */

import { getTokenCountCache } from '../services/cache-service';
import { LineRange } from '../types/file-types';

// Lazy initialization to ensure singleton pattern
let cache: ReturnType<typeof getTokenCountCache> | null = null;

const getCache = () => {
  if (!cache) {
    cache = getTokenCountCache();
  }
  return cache;
};

class TokenCountCacheAdapter {
  get(filePath: string, lineRange?: LineRange): { content: string; tokenCount: number } | null {
    const key = {
      filePath,
      lineStart: lineRange?.start,
      lineEnd: lineRange?.end
    };
    const entry = getCache().getTokenCount(key);
    return entry || null;
  }
  
  set(filePath: string, content: string, tokenCount: number, lineRange?: LineRange): void {
    const key = {
      filePath,
      lineStart: lineRange?.start,
      lineEnd: lineRange?.end
    };
    getCache().setTokenCount(key, { content, tokenCount });
  }
  
  invalidateFile(filePath: string): void {
    getCache().invalidateFile(filePath);
  }
  
  clear(): void {
    getCache().clear();
  }
  
  cleanup(): void {
    getCache().clear();
  }
  
  size(): number {
    return getCache().size;
  }
  
  estimateMemoryUsage(): number {
    // Rough estimate based on cache size
    return getCache().size * 100; // Assume average 100 bytes per entry
  }
}

export const tokenCountCache = new TokenCountCacheAdapter();