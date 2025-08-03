import { BoundedLRUCache } from '../utils/bounded-lru-cache';

describe('BoundedLRUCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new BoundedLRUCache<string, number>(5);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBeUndefined();
    });

    it('should track cache size correctly', () => {
      const cache = new BoundedLRUCache<string, number>(3);
      
      expect(cache.size).toBe(0);
      
      cache.set('a', 1);
      expect(cache.size).toBe(1);
      
      cache.set('b', 2);
      expect(cache.size).toBe(2);
      
      cache.delete('a');
      expect(cache.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used item when capacity reached', () => {
      const cache = new BoundedLRUCache<string, number>(2);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // Should evict 'a'
      
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.size).toBe(2);
    });

    it('should update access order on get', () => {
      const cache = new BoundedLRUCache<string, number>(2);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // Move 'a' to most recent
      cache.set('c', 3); // Should evict 'b', not 'a'
      
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
    });

    it('should update access order on set for existing keys', () => {
      const cache = new BoundedLRUCache<string, number>(2);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10); // Update 'a' and move to most recent
      cache.set('c', 3); // Should evict 'b'
      
      expect(cache.get('a')).toBe(10);
      expect(cache.has('b')).toBe(false);
      expect(cache.get('c')).toBe(3);
    });

    it('should handle multiple evictions correctly', () => {
      const cache = new BoundedLRUCache<string, number>(3);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // a is now most recent
      cache.get('b'); // b is now most recent
      // Order is now: c (least recent), a, b (most recent)
      
      cache.set('d', 4); // Should evict 'c'
      expect(cache.has('c')).toBe(false);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('d')).toBe(true);
      
      cache.set('e', 5); // Should evict 'a'
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.has('e')).toBe(true);
    });
  });

  describe('validation and limits', () => {
    it('should throw error for non-positive cache size', () => {
      expect(() => new BoundedLRUCache(0)).toThrow('Cache size must be positive');
      expect(() => new BoundedLRUCache(-1)).toThrow('Cache size must be positive');
    });

    it('should cap very large cache sizes', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cache = new BoundedLRUCache<string, number>(200000);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large cache size')
      );
      expect(cache.maxSizeLimit).toBe(100000);
      
      consoleSpy.mockRestore();
    });

    it('should accept reasonable cache sizes', () => {
      const cache = new BoundedLRUCache<string, number>(5000);
      expect(cache.maxSizeLimit).toBe(5000);
    });
  });

  describe('clear operation', () => {
    it('should clear all items from cache', () => {
      const cache = new BoundedLRUCache<string, number>(5);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      expect(cache.size).toBe(3);
      
      cache.clear();
      
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should return correct cache statistics', () => {
      const cache = new BoundedLRUCache<string, number>(10);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      const stats = cache.getStats();
      
      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(10);
      expect(stats.utilizationPercent).toBe(30);
    });
  });

  describe('edge cases', () => {
    it('should handle cache of size 1', () => {
      const cache = new BoundedLRUCache<string, number>(1);
      
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      
      cache.set('b', 2); // Should evict 'a'
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
    });

    it('should handle delete for non-existent keys', () => {
      const cache = new BoundedLRUCache<string, number>(5);
      
      expect(cache.delete('non-existent')).toBe(false);
      
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.delete('a')).toBe(false); // Already deleted
    });

    it('should handle complex key types', () => {
      const cache = new BoundedLRUCache<{ id: number }, string>(2);
      
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      
      cache.set(key1, 'value1');
      cache.set(key2, 'value2');
      
      expect(cache.get(key1)).toBe('value1');
      expect(cache.get(key2)).toBe('value2');
    });
  });
});