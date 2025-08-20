import { CACHE } from '@constants';

import { BoundedLRUCache } from '../utils/bounded-lru-cache';

export interface CacheConfig {
  maxSize?: number;
  ttlMs?: number;
  name?: string;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  utilizationPercent: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export class UnifiedCache<K, V> {
  protected cache: BoundedLRUCache<K, V>;
  private hits = 0;
  private misses = 0;
  private name: string;
  
  constructor(config?: CacheConfig) {
    this.name = config?.name ?? 'unnamed-cache';
    this.cache = new BoundedLRUCache<K, V>(
      config?.maxSize ?? CACHE.DEFAULT.MAX_ENTRIES,
      config?.ttlMs ?? (CACHE.DEFAULT.TTL_MINUTES * 60 * 1000)
    );
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value === undefined) {
      this.misses++;
    } else {
      this.hits++;
    }
    return value;
  }
  
  set(key: K, value: V): void {
    this.cache.set(key, value);
  }
  
  has(key: K): boolean {
    return this.cache.has(key);
  }
  
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
  
  deleteWhere(predicate: (key: K) => boolean): number {
    return this.cache.deleteWhere(predicate);
  }
  
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
  
  getStats(): CacheStats {
    const baseStats = this.cache.getStats();
    const totalRequests = this.hits + this.misses;
    
    return {
      ...baseStats,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0
    };
  }
  
  get size(): number {
    return this.cache.size;
  }
  
  get maxSize(): number {
    return this.cache.maxSizeLimit;
  }
  
  getName(): string {
    return this.name;
  }
}

export interface FileContentCacheEntry {
  content: string;
  tokenCount: number;
}

// Lazy initialization for TextEncoder to support both browser and Node.js
let textEncoder: TextEncoder | null = null;

const getTextEncoder = (): TextEncoder => {
  if (!textEncoder) {
    textEncoder = new TextEncoder();
  }
  return textEncoder;
};

export class FileContentCache extends UnifiedCache<string, FileContentCacheEntry> {
  constructor(config?: CacheConfig) {
    super({
      name: 'file-content',
      maxSize: CACHE.DEFAULT.MAX_ENTRIES,
      ttlMs: CACHE.DEFAULT.TTL_MINUTES * 60 * 1000,
      ...config
    });
  }
  
  setFileContent(filePath: string, content: string, tokenCount: number): void {
    const sizeBytes = getTextEncoder().encode(content).length;
    const maxFileSizeBytes = CACHE.DEFAULT.MAX_FILE_SIZE_MB * 1024 * 1024;
    
    if (sizeBytes > maxFileSizeBytes) {
      console.warn(`File ${filePath} exceeds max cache size (${sizeBytes} > ${maxFileSizeBytes}), not caching`);
      return;
    }
    
    this.set(filePath, { content, tokenCount });
  }
  
  getFileContent(filePath: string): FileContentCacheEntry | undefined {
    return this.get(filePath);
  }
}

export interface TokenCacheKey {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface TokenCacheEntry {
  content: string;
  tokenCount: number;
}

export class TokenCountCache extends UnifiedCache<string, TokenCacheEntry> {
  constructor(config?: CacheConfig) {
    super({
      name: 'token-count',
      maxSize: 1000,
      ttlMs: 60 * 60 * 1000, // 1 hour
      ...config
    });
  }
  
  private generateKey(key: TokenCacheKey): string {
    if (key.lineStart === undefined || key.lineEnd === undefined) {
      return `file:${key.filePath}`;
    }
    return `file:${key.filePath}:lines:${key.lineStart}-${key.lineEnd}`;
  }
  
  getTokenCount(key: TokenCacheKey): TokenCacheEntry | undefined {
    const cacheKey = this.generateKey(key);
    return this.get(cacheKey);
  }
  
  setTokenCount(key: TokenCacheKey, entry: TokenCacheEntry): void {
    const cacheKey = this.generateKey(key);
    this.set(cacheKey, entry);
  }
  
  invalidateFile(filePath: string): number {
    // Delete all cache entries for this specific file
    // Must match exactly or have line range suffix
    const exactKey = `file:${filePath}`;
    const prefixWithSeparator = `file:${filePath}:lines:`;
    
    return this.deleteWhere(key => 
      key === exactKey || key.startsWith(prefixWithSeparator)
    );
  }
}

let globalFileCache: FileContentCache | null = null;
let globalTokenCache: TokenCountCache | null = null;

export function getFileContentCache(): FileContentCache {
  if (!globalFileCache) {
    globalFileCache = new FileContentCache();
  }
  return globalFileCache;
}

export function getTokenCountCache(): TokenCountCache {
  if (!globalTokenCache) {
    globalTokenCache = new TokenCountCache();
  }
  return globalTokenCache;
}

export function clearAllCaches(): void {
  if (globalFileCache) {
    globalFileCache.clear();
  }
  if (globalTokenCache) {
    globalTokenCache.clear();
  }
}