import { enhancedFileContentCache } from '../utils/enhanced-file-cache-adapter';
import { tokenCountCache } from '../utils/token-cache-adapter';

describe('Memory Management on Workspace Changes', () => {
  beforeEach(() => {
    // Clear caches before each test
    enhancedFileContentCache.clear();
    tokenCountCache.clear();
  });

  it('should clear file content cache when switching workspaces', () => {
    // Add some content to the cache
    enhancedFileContentCache.set('/workspace1/file1.ts', 'const test = 1;', 10);
    enhancedFileContentCache.set('/workspace1/file2.ts', 'const test = 2;', 20);
    
    expect(enhancedFileContentCache.size()).toBe(2);
    expect(enhancedFileContentCache.getMemoryUsageMB()).toBeGreaterThan(0);
    
    // Simulate workspace switch by clearing cache
    enhancedFileContentCache.clear();
    
    expect(enhancedFileContentCache.size()).toBe(0);
    expect(enhancedFileContentCache.getMemoryUsageMB()).toBe(0);
    
    // Verify cached content is gone
    expect(enhancedFileContentCache.get('/workspace1/file1.ts')).toBeNull();
    expect(enhancedFileContentCache.get('/workspace1/file2.ts')).toBeNull();
  });

  it('should clear token count cache when switching workspaces', () => {
    // Add some token counts to the cache
    tokenCountCache.set('/workspace1/file1.ts', 'const test = 1;', 10);
    tokenCountCache.set('/workspace1/file2.ts', 'const test = 2;', 20, { start: 1, end: 5 });
    
    expect(tokenCountCache.size()).toBe(2);
    
    // Simulate workspace switch by clearing cache
    tokenCountCache.clear();
    
    expect(tokenCountCache.size()).toBe(0);
    
    // Verify cached content is gone
    expect(tokenCountCache.get('/workspace1/file1.ts')).toBeNull();
    expect(tokenCountCache.get('/workspace1/file2.ts', { start: 1, end: 5 })).toBeNull();
  });

  it('should handle invalidation of specific files in token cache', () => {
    // Add multiple entries for the same file
    tokenCountCache.set('/workspace1/file1.ts', 'full content', 100);
    tokenCountCache.set('/workspace1/file1.ts', 'line 1-5', 20, { start: 1, end: 5 });
    tokenCountCache.set('/workspace1/file1.ts', 'line 10-20', 30, { start: 10, end: 20 });
    tokenCountCache.set('/workspace1/file2.ts', 'other file', 50);
    
    expect(tokenCountCache.size()).toBe(4);
    
    // Invalidate specific file
    tokenCountCache.invalidateFile('/workspace1/file1.ts');
    
    // Only file2 should remain
    expect(tokenCountCache.size()).toBe(1);
    expect(tokenCountCache.get('/workspace1/file2.ts')).not.toBeNull();
    expect(tokenCountCache.get('/workspace1/file1.ts')).toBeNull();
    expect(tokenCountCache.get('/workspace1/file1.ts', { start: 1, end: 5 })).toBeNull();
  });

  it('should verify memory limits are enforced in file cache', () => {
    const config = enhancedFileContentCache.getConfig();
    
    // Verify cache has reasonable limits
    expect(config.maxMemoryMB).toBeGreaterThan(0);
    expect(config.maxEntries).toBeGreaterThan(0);
    expect(config.maxFileSizeMB).toBeGreaterThan(0);
    
    // Try to add a file that exceeds size limit
    const hugeContent = 'x'.repeat((config.maxFileSizeMB + 1) * 1024 * 1024);
    const result = enhancedFileContentCache.set('/huge-file.ts', hugeContent, 1000000);
    
    expect(result).toBe(false); // Should reject oversized file
    expect(enhancedFileContentCache.size()).toBe(0); // Cache should remain empty
  });

  it('should handle cache eviction when memory limit is reached', () => {
    const config = enhancedFileContentCache.getConfig();
    
    // Set a small memory limit for testing
    enhancedFileContentCache.updateConfig({ maxMemoryMB: 1 }); // 1MB limit
    
    // Add files until we exceed the limit
    let fileCount = 0;
    const contentSize = 100 * 1024; // 100KB per file
    const content = 'x'.repeat(contentSize);
    
    while (fileCount < 20) { // Try to add 2MB worth of files
      enhancedFileContentCache.set(`/file${fileCount}.ts`, content, 1000);
      fileCount++;
    }
    
    // Cache should have evicted some entries to stay within limit
    const memoryUsage = enhancedFileContentCache.getMemoryUsageMB();
    expect(memoryUsage).toBeLessThanOrEqual(1);
    
    // Some files should have been evicted
    expect(enhancedFileContentCache.size()).toBeLessThan(20);
    
    // Restore original config
    enhancedFileContentCache.updateConfig(config);
  });

  it('should cleanup expired entries in token cache', () => {
    // Mock Date.now to control time
    const originalNow = Date.now;
    let currentTime = originalNow();
    Date.now = jest.fn(() => currentTime);
    
    // Add entries
    tokenCountCache.set('/file1.ts', 'content1', 10);
    tokenCountCache.set('/file2.ts', 'content2', 20);
    
    expect(tokenCountCache.size()).toBe(2);
    
    // Advance time beyond cache expiry (default 1 hour)
    currentTime += 2 * 60 * 60 * 1000; // 2 hours
    
    // Cleanup expired entries
    tokenCountCache.cleanup();
    
    // All entries should be expired
    expect(tokenCountCache.size()).toBe(0);
    
    // Restore Date.now
    Date.now = originalNow;
  });
});