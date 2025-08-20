/**
 * Bounded LRU (Least Recently Used) cache with configurable size limits and optional TTL
 * Automatically evicts least recently used items when size limit is reached
 * Optionally expires items after a time-to-live (TTL) duration
 */
export class BoundedLRUCache<K, V> {
  private cache = new Map<K, V>();
  private timestamps = new Map<K, number>();
  private readonly maxSize: number;
  private readonly ttlMs: number | undefined;
  private accessOrder: K[] = [];

  constructor(maxSize = 1000, ttlMs?: number) {
    const MAX_REASONABLE_SIZE = 100_000;
    
    if (maxSize <= 0) {
      throw new Error('Cache size must be positive');
    }
    
    if (maxSize > MAX_REASONABLE_SIZE) {
      console.warn(`Large cache size (${maxSize}) may cause memory issues. Capping at ${MAX_REASONABLE_SIZE}`);
      this.maxSize = MAX_REASONABLE_SIZE;
    } else {
      this.maxSize = maxSize;
    }
    
    if (ttlMs !== undefined && ttlMs <= 0) {
      throw new Error('TTL must be positive if provided');
    }
    
    this.ttlMs = ttlMs;
  }

  /**
   * Get a value from the cache and update its access time
   */
  get(key: K): V | undefined {
    // Check if item exists and hasn't expired
    if (this.ttlMs !== undefined) {
      const timestamp = this.timestamps.get(key);
      if (timestamp !== undefined) {
        const age = Date.now() - timestamp;
        if (age > this.ttlMs) {
          // Item has expired, remove it
          this.delete(key);
          return undefined;
        }
      }
    }
    
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end of access order (most recently used)
      this.updateAccessOrder(key);
    }
    return value;
  }

  /**
   * Set a value in the cache, evicting LRU item if necessary
   */
  set(key: K, value: V): void {
    // Opportunistically prune expired entries if TTL is enabled
    if (this.ttlMs !== undefined) {
      this.pruneExpired();
    }
    
    // If key exists, just update the value and access order
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      if (this.ttlMs !== undefined) {
        this.timestamps.set(key, Date.now());
      }
      this.updateAccessOrder(key);
      return;
    }

    // If we're at capacity, evict the least recently used item
    if (this.cache.size >= this.maxSize) {
      const lruKey = this.accessOrder.shift();
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
        this.timestamps.delete(lruKey);
      }
    }

    // Add the new item
    this.cache.set(key, value);
    if (this.ttlMs !== undefined) {
      this.timestamps.set(key, Date.now());
    }
    this.accessOrder.push(key);
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: K): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.timestamps.delete(key);
    }
    return deleted;
  }
  
  /**
   * Delete all keys that match a predicate function
   * Useful for invalidating related cache entries (e.g., all entries for a file)
   */
  deleteWhere(predicate: (key: K) => boolean): number {
    const keysToDelete = new Set<K>();
    
    for (const key of this.cache.keys()) {
      if (predicate(key)) {
        keysToDelete.add(key);
      }
    }
    
    // Batch delete from Map and timestamps
    let deleteCount = 0;
    for (const key of keysToDelete) {
      if (this.cache.delete(key)) {
        this.timestamps.delete(key);
        deleteCount++;
      }
    }
    
    // Rebuild accessOrder array once (O(n) instead of O(n²))
    if (deleteCount > 0) {
      this.accessOrder = this.accessOrder.filter(key => !keysToDelete.has(key));
    }
    
    return deleteCount;
  }
  
  /**
   * Get all keys that match a predicate function
   */
  keysWhere(predicate: (key: K) => boolean): K[] {
    const matchingKeys: K[] = [];
    
    for (const key of this.cache.keys()) {
      if (predicate(key)) {
        matchingKeys.push(key);
      }
    }
    
    return matchingKeys;
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
    this.timestamps.clear();
    this.accessOrder = [];
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    // Prune expired entries first if TTL is enabled
    if (this.ttlMs !== undefined) {
      this.pruneExpired();
    }
    return this.cache.size;
  }

  /**
   * Get the maximum size of the cache
   */
  get maxSizeLimit(): number {
    return this.maxSize;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; utilizationPercent: number } {
    // Prune expired entries first for accurate stats if TTL is enabled
    if (this.ttlMs !== undefined) {
      this.pruneExpired();
    }
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilizationPercent: (this.cache.size / this.maxSize) * 100
    };
  }

  /**
   * Update the access order of a key (move to most recently used)
   */
  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
  
  /**
   * Remove expired entries from the cache
   */
  private pruneExpired(): void {
    if (this.ttlMs === undefined) return;
    
    const now = Date.now();
    const keysToDelete: K[] = [];
    
    for (const [key, timestamp] of this.timestamps.entries()) {
      if (now - timestamp > this.ttlMs) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.delete(key);
    }
  }
  
  /**
   * Get all cache entries (for stats/monitoring purposes)
   * Returns an iterator over the cache entries
   */
  entries(): IterableIterator<[K, V]> {
    // Prune expired entries first if TTL is enabled
    if (this.ttlMs !== undefined) {
      this.pruneExpired();
    }
    return this.cache.entries();
  }
}