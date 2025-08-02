interface CacheEntry {
  content: string;
  tokenCount: number;
  timestamp: number;
  accessCount: number;
  sizeBytes: number;
  isCompressed?: boolean;
}

import { CACHE } from '../constants/app-constants';

interface MemoryAwareCacheConfig {
  maxMemoryMB: number;
  maxEntries: number;
  maxFileSizeMB: number;
  ttlMinutes: number;
  compressionThreshold: number; // Bytes threshold for compression
}

interface CacheMetrics {
  totalMemoryUsage: number;
  totalEntries: number;
  hitRate: number;
  evictionCount: number;
}

export class MemoryAwareFileCache {
  private cache = new Map<string, CacheEntry>();
  private totalMemoryUsage = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private config: MemoryAwareCacheConfig;

  constructor(config?: Partial<MemoryAwareCacheConfig>) {
    this.config = {
      maxMemoryMB: CACHE.DEFAULT.MAX_MEMORY_MB,
      maxEntries: CACHE.DEFAULT.MAX_ENTRIES,
      maxFileSizeMB: CACHE.DEFAULT.MAX_FILE_SIZE_MB,
      ttlMinutes: CACHE.DEFAULT.TTL_MINUTES,
      compressionThreshold: CACHE.DEFAULT.COMPRESSION_THRESHOLD_BYTES,
      ...config
    };
  }

  get(filePath: string): { content: string; tokenCount: number } | null {
    const entry = this.cache.get(filePath);
    if (!entry) {
      this.missCount++;
      return null;
    }

    // Check if entry is expired
    const isExpired = Date.now() - entry.timestamp > (this.config.ttlMinutes * 60 * 1000);
    if (isExpired) {
      this.evictEntry(filePath);
      this.missCount++;
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    this.hitCount++;

    // Move to end for LRU (delete and re-add)
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);

    return { 
      content: entry.content, // Compression is disabled, so no decompression needed
      tokenCount: entry.tokenCount 
    };
  }

  set(filePath: string, content: string, tokenCount: number): boolean {
    // Use TextEncoder for browser compatibility instead of Buffer
    const sizeBytes = new TextEncoder().encode(content).length;
    
    // Check individual file size limit
    if (sizeBytes > this.config.maxFileSizeMB * 1024 * 1024) {
      console.warn(`File too large for cache: ${filePath} (${this.formatBytes(sizeBytes)})`);
      return false;
    }

    // Check if we need to evict entries to make space
    const spaceNeeded = this.totalMemoryUsage + sizeBytes;
    const maxMemoryBytes = this.config.maxMemoryMB * 1024 * 1024;
    
    if ((spaceNeeded > maxMemoryBytes || this.cache.size >= this.config.maxEntries) && !this.makeSpace(sizeBytes)) {
        console.warn(`Could not make space for file: ${filePath}`);
        return false;
      }

    // Remove existing entry if updating
    if (this.cache.has(filePath)) {
      this.evictEntry(filePath);
    }

    // Note: Compression is not currently implemented, but the infrastructure is in place
    // For now, we don't compress files but track the size accurately
    const shouldCompress = false; // Disabled until actual compression is implemented
    const finalContent = content;
    const finalSize = sizeBytes;

    const entry: CacheEntry = {
      content: finalContent,
      tokenCount,
      timestamp: Date.now(),
      accessCount: 1,
      sizeBytes: finalSize,
      isCompressed: shouldCompress
    };

    this.cache.set(filePath, entry);
    this.totalMemoryUsage += finalSize;

    return true;
  }

  private makeSpace(spaceNeeded: number): boolean {
    const maxMemoryBytes = this.config.maxMemoryMB * 1024 * 1024;

    // Check if we need to evict based on entry count or memory
    const memoryOverLimit = this.totalMemoryUsage + spaceNeeded > maxMemoryBytes;
    const entriesOverLimit = this.cache.size >= this.config.maxEntries;

    if (!memoryOverLimit && !entriesOverLimit) {
      return true; // No eviction needed
    }

    // Get entries sorted by eviction priority (lowest priority first)
    const entries = [...this.cache.entries()]
      .map(([key, entry]) => ({
        key,
        entry,
        priority: this.calculateEvictionPriority(entry)
      }))
      .sort((a, b) => a.priority - b.priority);

    let freedSpace = 0;
    const keysToEvict: string[] = [];

    // Evict entries until we satisfy both memory and entry count limits
    for (const { key, entry } of entries) {
      keysToEvict.push(key);
      freedSpace += entry.sizeBytes;
      
      const memoryWillBeOk = this.totalMemoryUsage - freedSpace + spaceNeeded <= maxMemoryBytes;
      const entriesWillBeOk = this.cache.size - keysToEvict.length < this.config.maxEntries;
      
      if (memoryWillBeOk && entriesWillBeOk) {
        break;
      }
    }

    // Perform evictions
    for (const key of keysToEvict) {
      this.evictEntry(key);
    }

    const memoryOk = this.totalMemoryUsage + spaceNeeded <= maxMemoryBytes;
    const entriesOk = this.cache.size < this.config.maxEntries;
    return memoryOk && entriesOk;
  }

  private calculateEvictionPriority(entry: CacheEntry): number {
    const age = Date.now() - entry.timestamp;
    const ageScore = age / (1000 * 60); // Age in minutes
    const sizeScore = entry.sizeBytes / (1024 * 1024); // Size in MB
    const accessScore = 1 / Math.max(entry.accessCount, 1); // Inverse of access count
    
    // Higher score = higher priority for eviction
    return ageScore + (sizeScore * 2) + (accessScore * 10);
  }

  private evictEntry(filePath: string): void {
    const entry = this.cache.get(filePath);
    if (entry) {
      this.cache.delete(filePath);
      this.totalMemoryUsage -= entry.sizeBytes;
      this.evictionCount++;
    }
  }

  // Compression methods removed since compression is currently disabled
  // These can be re-implemented when actual compression support is added

  clear(): void {
    this.cache.clear();
    this.totalMemoryUsage = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  delete(filePath: string): void {
    this.evictEntry(filePath);
  }

  size(): number {
    return this.cache.size;
  }

  getMetrics(): CacheMetrics {
    const totalRequests = this.hitCount + this.missCount;
    return {
      totalMemoryUsage: this.totalMemoryUsage,
      totalEntries: this.cache.size,
      hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
      evictionCount: this.evictionCount
    };
  }

  getMemoryUsageMB(): number {
    return this.totalMemoryUsage / (1024 * 1024);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Configuration methods
  updateConfig(newConfig: Partial<MemoryAwareCacheConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Trigger cleanup if new limits are lower
    const maxMemoryBytes = this.config.maxMemoryMB * 1024 * 1024;
    if (this.totalMemoryUsage > maxMemoryBytes || this.cache.size > this.config.maxEntries) {
      this.makeSpace(0); // Force cleanup to new limits
    }
  }

  getConfig(): MemoryAwareCacheConfig {
    return { ...this.config };
  }
}

// Use centralized cache profiles from constants  
const CACHE_PROFILES = {
  development: {
    maxMemoryMB: CACHE.PROFILES.DEVELOPMENT.MAX_MEMORY_MB,
    maxEntries: CACHE.PROFILES.DEVELOPMENT.MAX_ENTRIES,
    maxFileSizeMB: CACHE.PROFILES.DEVELOPMENT.MAX_FILE_SIZE_MB,
    ttlMinutes: CACHE.PROFILES.DEVELOPMENT.TTL_MINUTES,
    compressionThreshold: CACHE.PROFILES.DEVELOPMENT.COMPRESSION_THRESHOLD_BYTES
  },
  production: {
    maxMemoryMB: CACHE.PROFILES.PRODUCTION.MAX_MEMORY_MB,
    maxEntries: CACHE.PROFILES.PRODUCTION.MAX_ENTRIES,
    maxFileSizeMB: CACHE.PROFILES.PRODUCTION.MAX_FILE_SIZE_MB,
    ttlMinutes: CACHE.PROFILES.PRODUCTION.TTL_MINUTES,
    compressionThreshold: CACHE.PROFILES.PRODUCTION.COMPRESSION_THRESHOLD_BYTES
  },
  electron: {
    maxMemoryMB: CACHE.PROFILES.ELECTRON.MAX_MEMORY_MB,
    maxEntries: CACHE.PROFILES.ELECTRON.MAX_ENTRIES,
    maxFileSizeMB: CACHE.PROFILES.ELECTRON.MAX_FILE_SIZE_MB,
    ttlMinutes: CACHE.PROFILES.ELECTRON.TTL_MINUTES,
    compressionThreshold: CACHE.PROFILES.ELECTRON.COMPRESSION_THRESHOLD_BYTES
  }
};

// Factory function for creating cache with profiles
export function createEnhancedFileCache(profile: keyof typeof CACHE_PROFILES = 'development'): MemoryAwareFileCache {
  return new MemoryAwareFileCache(CACHE_PROFILES[profile]);
}

// Export singleton instance with development profile by default
export const enhancedFileContentCache = createEnhancedFileCache(
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') ? 'electron' : 'development'
);