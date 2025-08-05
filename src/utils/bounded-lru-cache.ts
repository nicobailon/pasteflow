/**
 * Bounded LRU (Least Recently Used) cache with configurable size limits
 * Automatically evicts least recently used items when size limit is reached
 */
export class BoundedLRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  private accessOrder: K[] = [];

  constructor(maxSize = 1000) {
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
  }

  /**
   * Get a value from the cache and update its access time
   */
  get(key: K): V | undefined {
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
    // If key exists, just update the value and access order
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      this.updateAccessOrder(key);
      return;
    }

    // If we're at capacity, evict the least recently used item
    if (this.cache.size >= this.maxSize) {
      const lruKey = this.accessOrder.shift();
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }

    // Add the new item
    this.cache.set(key, value);
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
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    return this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
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
}