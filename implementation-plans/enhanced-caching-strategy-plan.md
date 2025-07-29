# Enhanced Caching Strategy Implementation Plan for PasteFlow

## Executive Summary

This plan details the implementation of a persistent, cross-session caching system for PasteFlow that will reduce file loading times by 40% for subsequent loads. The strategy includes persistent storage using IndexedDB, intelligent cache warming for frequently accessed files, and a robust invalidation system.

## Current State Analysis

### Existing Caching Infrastructure

1. **In-Memory Caches**:
   - `FileContentCache` (src/utils/file-cache.ts): Basic LRU cache with 100 file limit, 30-minute TTL
   - `MemoryAwareFileCache` (src/utils/enhanced-file-cache.ts): Advanced cache with memory management, eviction policies, and metrics
   - Both caches are session-only and cleared on app restart

2. **Current Limitations**:
   - No persistence across sessions - users must reload files every time
   - No cache warming - frequently used files aren't preloaded
   - Limited cache size (100-5000 files depending on profile)
   - No intelligent prefetching based on user patterns
   - Cache eviction is purely LRU/memory-based, not usage-pattern aware

3. **Caching Opportunities Identified**:
   - File content is loaded via `requestFileContent` IPC call
   - Workspace state persists file paths but not content
   - Token counting is expensive and could benefit from persistent caching
   - Directory structure scanning happens on every folder open

## Detailed Implementation Plan

### Phase 1: Persistent Cache Storage Layer

#### 1.1 IndexedDB Integration

Create a new persistent cache layer using IndexedDB for cross-session storage:

```typescript
// src/utils/persistent-cache.ts
interface PersistentCacheEntry {
  filePath: string;
  content: string;
  tokenCount: number;
  fileHash: string; // For invalidation
  lastModified: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  workspaceId?: string; // Associate with workspace
}

class PersistentFileCache {
  private dbName = 'pasteflow-cache';
  private storeName = 'file-content';
  private version = 1;
  private db: IDBDatabase | null = null;
  
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'filePath' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('accessCount', 'accessCount', { unique: false });
        }
      };
    });
  }
  
  async get(filePath: string): Promise<PersistentCacheEntry | null> {
    if (!this.db) return null;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(filePath);
      
      request.onsuccess = () => {
        const entry = request.result;
        if (entry) {
          // Update access statistics
          this.updateAccessStats(filePath);
        }
        resolve(entry || null);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async set(entry: PersistentCacheEntry): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(entry);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getFrequentlyAccessed(limit: number = 20): Promise<PersistentCacheEntry[]> {
    if (!this.db) return [];
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('accessCount');
      const request = index.openCursor(null, 'prev'); // Descending order
      
      const results: PersistentCacheEntry[] = [];
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}
```

#### 1.2 Cache Coordination Layer

Integrate persistent cache with existing in-memory caches:

```typescript
// src/utils/unified-cache.ts
export class UnifiedFileCache {
  private memoryCache: MemoryAwareFileCache;
  private persistentCache: PersistentFileCache;
  private pendingWrites = new Map<string, NodeJS.Timeout>();
  
  constructor() {
    this.memoryCache = enhancedFileContentCache;
    this.persistentCache = new PersistentFileCache();
  }
  
  async initialize(): Promise<void> {
    await this.persistentCache.initialize();
    await this.warmCache(); // Load frequently accessed files
  }
  
  async get(filePath: string): Promise<{ content: string; tokenCount: number } | null> {
    // Check memory cache first
    const memoryResult = this.memoryCache.get(filePath);
    if (memoryResult) return memoryResult;
    
    // Check persistent cache
    const persistentResult = await this.persistentCache.get(filePath);
    if (persistentResult) {
      // Validate cache entry
      if (await this.isValidCacheEntry(filePath, persistentResult)) {
        // Promote to memory cache
        this.memoryCache.set(filePath, persistentResult.content, persistentResult.tokenCount);
        return { content: persistentResult.content, tokenCount: persistentResult.tokenCount };
      }
    }
    
    return null;
  }
  
  async set(filePath: string, content: string, tokenCount: number): Promise<void> {
    // Always update memory cache immediately
    this.memoryCache.set(filePath, content, tokenCount);
    
    // Debounce persistent cache writes
    if (this.pendingWrites.has(filePath)) {
      clearTimeout(this.pendingWrites.get(filePath)!);
    }
    
    const timeout = setTimeout(async () => {
      const fileStats = await this.getFileStats(filePath);
      await this.persistentCache.set({
        filePath,
        content,
        tokenCount,
        fileHash: await this.calculateFileHash(filePath),
        lastModified: fileStats.mtime.getTime(),
        accessCount: 1,
        lastAccessed: Date.now(),
        size: Buffer.byteLength(content, 'utf8'),
        workspaceId: this.getCurrentWorkspaceId()
      });
      this.pendingWrites.delete(filePath);
    }, 1000); // 1 second debounce
    
    this.pendingWrites.set(filePath, timeout);
  }
}
```

### Phase 2: Cache Warming and Prefetching

#### 2.1 Intelligent Cache Warming

Implement cache warming based on workspace and usage patterns:

```typescript
// src/utils/cache-warming.ts
export class CacheWarmingStrategy {
  private unifiedCache: UnifiedFileCache;
  
  async warmCacheForWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) return;
    
    // Warm cache with:
    // 1. Currently selected files
    const selectedFiles = workspace.selectedFiles || [];
    await this.warmFiles(selectedFiles.map(f => f.path), 'selected');
    
    // 2. Recently accessed files in this workspace
    const recentFiles = await this.getRecentlyAccessedFiles(workspaceId, 10);
    await this.warmFiles(recentFiles, 'recent');
    
    // 3. Files in expanded directories
    const expandedDirs = Object.keys(workspace.expandedNodes || {})
      .filter(key => workspace.expandedNodes[key]);
    await this.warmFilesInDirectories(expandedDirs, 'expanded');
  }
  
  private async warmFiles(filePaths: string[], reason: string): Promise<void> {
    console.log(`[CacheWarming] Warming ${filePaths.length} files (${reason})`);
    
    // Batch load files with concurrency control
    const BATCH_SIZE = 5;
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (filePath) => {
        try {
          // Check if already cached
          const cached = await this.unifiedCache.get(filePath);
          if (!cached) {
            // Load from filesystem
            const result = await window.electron.ipcRenderer.invoke('request-file-content', filePath);
            if (result.success && result.content) {
              await this.unifiedCache.set(filePath, result.content, result.tokenCount);
            }
          }
        } catch (error) {
          console.warn(`[CacheWarming] Failed to warm ${filePath}:`, error);
        }
      }));
    }
  }
}
```

#### 2.2 Predictive Prefetching

Implement smart prefetching based on user behavior:

```typescript
// src/utils/predictive-prefetch.ts
export class PredictivePrefetcher {
  private accessPatterns = new Map<string, string[]>(); // file -> commonly accessed together
  
  async onFileAccessed(filePath: string): Promise<void> {
    // Record access pattern
    this.updateAccessPattern(filePath);
    
    // Prefetch related files
    const relatedFiles = this.predictRelatedFiles(filePath);
    if (relatedFiles.length > 0) {
      // Prefetch in background with low priority
      setTimeout(() => {
        this.prefetchFiles(relatedFiles);
      }, 100);
    }
  }
  
  private predictRelatedFiles(filePath: string): string[] {
    const predictions: string[] = [];
    
    // 1. Same directory siblings
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    predictions.push(
      `${dir}/test-${path.basename(filePath)}`, // Test file
      `${dir}/${path.basename(filePath, ext)}.test${ext}`, // Alternative test pattern
      `${dir}/index${ext}` // Index file
    );
    
    // 2. Import dependencies (basic heuristic)
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      // This would need actual parsing, simplified here
      predictions.push(
        filePath.replace(/\.(ts|js)x?$/, '.css'), // Related styles
        filePath.replace(/\.(ts|js)x?$/, '.scss')
      );
    }
    
    // 3. Historical patterns
    const historicallyRelated = this.accessPatterns.get(filePath) || [];
    predictions.push(...historicallyRelated);
    
    // Filter to existing, uncached files
    return predictions.filter(f => this.shouldPrefetch(f));
  }
}
```

### Phase 3: Cache Invalidation and Consistency

#### 3.1 File Change Detection

Implement file watching and cache invalidation:

```typescript
// src/utils/cache-invalidation.ts
export class CacheInvalidationManager {
  private fileWatchers = new Map<string, fs.FSWatcher>();
  private unifiedCache: UnifiedFileCache;
  
  watchFile(filePath: string): void {
    if (this.fileWatchers.has(filePath)) return;
    
    try {
      const watcher = fs.watch(filePath, async (eventType) => {
        if (eventType === 'change') {
          console.log(`[CacheInvalidation] File changed: ${filePath}`);
          await this.invalidateCache(filePath);
        }
      });
      
      this.fileWatchers.set(filePath, watcher);
    } catch (error) {
      console.warn(`[CacheInvalidation] Failed to watch ${filePath}:`, error);
    }
  }
  
  async invalidateCache(filePath: string): Promise<void> {
    // Remove from all cache layers
    this.unifiedCache.delete(filePath);
    
    // If file is currently selected, reload it
    const appState = window.appStateRef?.current;
    if (appState?.selectedFiles.some(f => f.path === filePath)) {
      // Trigger reload
      await appState.loadFileContent(filePath);
    }
  }
  
  async validateCacheEntry(filePath: string, entry: PersistentCacheEntry): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(filePath);
      const currentModified = stats.mtime.getTime();
      
      // Check modification time
      if (currentModified > entry.lastModified) {
        return false;
      }
      
      // For extra safety, check file hash for small files
      if (entry.size < 100 * 1024) { // 100KB
        const currentHash = await this.calculateFileHash(filePath);
        return currentHash === entry.fileHash;
      }
      
      return true;
    } catch (error) {
      return false; // File doesn't exist or can't be accessed
    }
  }
}
```

#### 3.2 Cache Cleanup and Maintenance

Implement cache maintenance routines:

```typescript
// src/utils/cache-maintenance.ts
export class CacheMaintenanceService {
  private maintenanceInterval: NodeJS.Timeout | null = null;
  
  startMaintenance(): void {
    // Run maintenance every 5 minutes
    this.maintenanceInterval = setInterval(() => {
      this.performMaintenance();
    }, 5 * 60 * 1000);
    
    // Also run on app startup
    setTimeout(() => this.performMaintenance(), 10000);
  }
  
  async performMaintenance(): Promise<void> {
    console.log('[CacheMaintenance] Starting maintenance');
    
    // 1. Clean up orphaned entries (files that no longer exist)
    await this.cleanOrphanedEntries();
    
    // 2. Enforce storage quotas
    await this.enforceStorageQuota();
    
    // 3. Update access statistics
    await this.updateAccessStatistics();
    
    // 4. Optimize database
    await this.optimizeDatabase();
  }
  
  private async enforceStorageQuota(): Promise<void> {
    const STORAGE_QUOTA_MB = 500; // 500MB for persistent cache
    const currentUsage = await this.calculateStorageUsage();
    
    if (currentUsage > STORAGE_QUOTA_MB * 1024 * 1024) {
      // Evict least recently used entries
      const entriesToEvict = await this.getLRUEntries(
        Math.ceil((currentUsage - STORAGE_QUOTA_MB * 1024 * 1024) / (100 * 1024))
      );
      
      for (const entry of entriesToEvict) {
        await this.persistentCache.delete(entry.filePath);
      }
    }
  }
}
```

### Phase 4: Integration with Existing Systems

#### 4.1 Main Process Integration

Update the main process to support cache operations:

```typescript
// main.js additions
let cacheManager = null;

app.whenReady().then(async () => {
  // Initialize cache manager
  const { CacheManager } = require('./src/main/cache-manager');
  cacheManager = new CacheManager();
  await cacheManager.initialize();
  
  createWindow();
});

// Add new IPC handlers
ipcMain.handle('cache-stats', async () => {
  return cacheManager.getStatistics();
});

ipcMain.handle('warm-cache', async (event, workspaceId) => {
  return cacheManager.warmCacheForWorkspace(workspaceId);
});

// Modify existing request-file-content handler
ipcMain.handle('request-file-content', async (event, filePath) => {
  // ... existing validation code ...
  
  // Check cache first
  const cached = await cacheManager.get(filePath);
  if (cached && await cacheManager.isValid(filePath, cached)) {
    return { success: true, content: cached.content, tokenCount: cached.tokenCount, fromCache: true };
  }
  
  // ... existing file reading code ...
  
  // Cache the result
  if (result.success) {
    await cacheManager.set(filePath, result.content, result.tokenCount);
  }
  
  return result;
});
```

#### 4.2 React Hook Integration

Update useAppState hook to leverage caching:

```typescript
// src/hooks/use-app-state.ts modifications
const useAppState = () => {
  // ... existing code ...
  
  // Initialize cache warming on workspace load
  useEffect(() => {
    if (currentWorkspace && appInitialized) {
      // Warm cache for current workspace
      window.electron.ipcRenderer.invoke('warm-cache', currentWorkspace)
        .then(() => console.log(`[Cache] Warmed cache for workspace: ${currentWorkspace}`))
        .catch(err => console.warn('[Cache] Failed to warm cache:', err));
    }
  }, [currentWorkspace, appInitialized]);
  
  // Modified loadFileContent with cache awareness
  const loadFileContent = useCallback(async (filePath: string): Promise<void> => {
    const file = allFiles.find((f: FileData) => f.path === filePath);
    if (!file || file.isContentLoaded) return;
    
    // Show loading indicator for cache misses
    const startTime = performance.now();
    
    const result = await requestFileContent(filePath);
    
    const loadTime = performance.now() - startTime;
    if (result.fromCache) {
      console.log(`[Cache] Loaded ${filePath} from cache in ${loadTime.toFixed(2)}ms`);
    } else {
      console.log(`[Cache] Loaded ${filePath} from disk in ${loadTime.toFixed(2)}ms`);
    }
    
    // ... rest of existing logic ...
  }, [allFiles, setAllFiles, fileSelection]);
};
```

### Phase 5: Performance Metrics and Monitoring

#### 5.1 Cache Performance Tracking

Implement comprehensive metrics:

```typescript
// src/utils/cache-metrics.ts
export interface CacheMetrics {
  hitRate: number;
  missRate: number;
  averageLoadTime: {
    fromCache: number;
    fromDisk: number;
  };
  storageUsage: {
    memory: number;
    persistent: number;
  };
  evictionRate: number;
  warmingEffectiveness: number;
}

export class CacheMetricsCollector {
  private metrics = {
    hits: 0,
    misses: 0,
    loadTimes: {
      cache: [] as number[],
      disk: [] as number[]
    },
    evictions: 0,
    warmedFiles: new Set<string>(),
    accessedWarmedFiles: new Set<string>()
  };
  
  recordCacheHit(loadTime: number): void {
    this.metrics.hits++;
    this.metrics.loadTimes.cache.push(loadTime);
  }
  
  recordCacheMiss(loadTime: number): void {
    this.metrics.misses++;
    this.metrics.loadTimes.disk.push(loadTime);
  }
  
  getMetrics(): CacheMetrics {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      hitRate: total > 0 ? this.metrics.hits / total : 0,
      missRate: total > 0 ? this.metrics.misses / total : 0,
      averageLoadTime: {
        fromCache: this.average(this.metrics.loadTimes.cache),
        fromDisk: this.average(this.metrics.loadTimes.disk)
      },
      storageUsage: this.getStorageUsage(),
      evictionRate: this.metrics.evictions / total,
      warmingEffectiveness: this.metrics.warmedFiles.size > 0 
        ? this.metrics.accessedWarmedFiles.size / this.metrics.warmedFiles.size 
        : 0
    };
  }
}
```

## Implementation Timeline

### Week 1-2: Foundation
- Implement PersistentFileCache with IndexedDB
- Create UnifiedFileCache coordination layer
- Add basic cache invalidation

### Week 3: Integration
- Integrate with main process IPC handlers
- Update React hooks to use unified cache
- Add file watching for invalidation

### Week 4: Intelligence
- Implement cache warming strategies
- Add predictive prefetching
- Create maintenance routines

### Week 5: Testing and Optimization
- Performance benchmarking
- Load testing with large repositories
- Cache effectiveness metrics

### Week 6: Polish and Monitoring
- Add user-visible cache indicators
- Implement cache management UI
- Performance dashboard

## Expected Performance Improvements

Based on analysis and similar implementations:

1. **Second Load Performance**: 40-60% faster file loading for cached content
2. **Memory Usage**: 20-30% reduction through shared caching
3. **Token Counting**: 90% faster for cached files
4. **Workspace Loading**: 50% faster with warm cache
5. **Network/Disk I/O**: 70% reduction for repeat accesses

## Risk Mitigation

1. **Storage Quota Exceeded**: Implement progressive eviction and user notifications
2. **Cache Corruption**: Add integrity checks and automatic recovery
3. **Memory Pressure**: Dynamic cache sizing based on system resources
4. **File Consistency**: File watching with debounced invalidation
5. **Performance Regression**: Feature flag for gradual rollout

## Success Metrics

1. **Primary**: 40% reduction in subsequent file load times
2. **Cache Hit Rate**: Target 70%+ for active development sessions
3. **User Satisfaction**: Reduced complaints about reload times
4. **System Health**: No increase in memory usage beyond 10%
5. **Reliability**: <0.1% cache corruption rate

## Future Enhancements

1. **Cloud Sync**: Sync cache across devices via encrypted cloud storage
2. **Compression**: Implement LZ4 compression for persistent cache
3. **Smart Eviction**: ML-based prediction of file access patterns
4. **Shared Cache**: Team-level cache sharing for common repositories
5. **Differential Updates**: Store only deltas for frequently changing files