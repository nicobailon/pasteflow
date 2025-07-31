import { LineRange } from "../types/file-types";

interface TokenCacheEntry {
  content: string;
  tokenCount: number;
  lastAccessed: number;
}

/**
 * Cache for storing pre-calculated token counts for file line ranges
 * Uses LRU eviction policy to prevent memory bloat
 */
export class TokenCountCache {
  private cache: Map<string, TokenCacheEntry>;
  private maxSize: number;
  private maxAge: number; // in milliseconds

  constructor(maxSize = 1000, maxAge = 3_600_000) { // 1 hour default
    this.cache = new Map();
    this.maxSize = maxSize;
    this.maxAge = maxAge;
  }

  /**
   * Generate a cache key for a file path and line range
   */
  private generateKey(filePath: string, lineRange?: LineRange): string {
    if (!lineRange) {
      return `file:${filePath}`;
    }
    return `file:${filePath}:lines:${lineRange.start}-${lineRange.end}`;
  }

  /**
   * Get cached token count for a file or line range
   */
  get(filePath: string, lineRange?: LineRange): TokenCacheEntry | null {
    const key = this.generateKey(filePath, lineRange);
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if entry is expired
    const now = Date.now();
    if (now - entry.lastAccessed > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    // Update last accessed time
    entry.lastAccessed = now;
    return entry;
  }

  /**
   * Set cached token count for a file or line range
   */
  set(filePath: string, content: string, tokenCount: number, lineRange?: LineRange): void {
    const key = this.generateKey(filePath, lineRange);
    
    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Find and remove oldest entry
      let oldestKey: string | null = null;
      let oldestTime = Date.now();
      
      for (const [k, v] of this.cache.entries()) {
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      content,
      tokenCount,
      lastAccessed: Date.now()
    });
  }

  /**
   * Invalidate cache entries for a specific file
   */
  invalidateFile(filePath: string): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (key.startsWith(`file:${filePath}`)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastAccessed > this.maxAge) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

// Global singleton instance
export const tokenCountCache = new TokenCountCache();