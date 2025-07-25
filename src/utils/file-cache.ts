interface CacheEntry {
  content: string;
  tokenCount: number;
  timestamp: number;
}

class FileContentCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private maxAge: number; // in milliseconds
  
  constructor(maxSize = 100, maxAgeMinutes = 30) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.maxAge = maxAgeMinutes * 60 * 1000;
  }
  
  get(filePath: string): { content: string; tokenCount: number } | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;
    
    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(filePath);
      return null;
    }
    
    // Move to end (LRU)
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    
    return { content: entry.content, tokenCount: entry.tokenCount };
  }
  
  set(filePath: string, content: string, tokenCount: number): void {
    // Remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(filePath)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(filePath, {
      content,
      tokenCount,
      timestamp: Date.now()
    });
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  delete(filePath: string): void {
    this.cache.delete(filePath);
  }
  
  size(): number {
    return this.cache.size;
  }
}

// Export singleton instance
export const fileContentCache = new FileContentCache();