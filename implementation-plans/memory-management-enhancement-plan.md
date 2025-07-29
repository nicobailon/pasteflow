# Memory Management Enhancement Implementation Plan for PasteFlow

## Executive Summary

This document outlines a comprehensive plan to enhance memory management in PasteFlow, targeting a 30% reduction in memory usage through aggressive garbage collection, memory pressure monitoring, and optimized data structures. The implementation focuses on three key areas: content caching optimization, file processing memory efficiency, and real-time memory monitoring.

## Current State Analysis

### Memory Management Issues Identified

1. **File Content Accumulation in Renderer Process**
   - `electron-handlers.ts`: Accumulates up to 50,000 files in memory before applying limits
   - Files are kept in memory even when not actively displayed
   - Memory limit is reactive rather than proactive

2. **Cache Management Inefficiencies**
   - Two cache implementations exist (`file-cache.ts` and `enhanced-file-cache.ts`)
   - Enhanced cache has memory limits but isn't fully utilized
   - No compression implementation despite infrastructure being in place

3. **Main Process Memory Usage**
   - `main.js`: Accumulates all files during directory scanning without streaming
   - No memory pressure feedback to renderer process
   - Token counting happens in main process, keeping content in memory

4. **State Management Memory Overhead**
   - `use-app-state.ts`: Multiple refs maintain duplicate state references
   - Large workspace states are kept entirely in memory
   - No lazy loading for workspace data

## Implementation Strategy

### Phase 1: Immediate Memory Optimizations (Week 1)

#### 1.1 Implement Streaming File Processing

**Current Issue**: Main process accumulates all files before sending to renderer
**Solution**: Stream files in smaller batches with memory-aware chunking

```typescript
// main.js modifications
const MEMORY_AWARE_BATCH_SIZE = 25; // Reduced from 50
const MAX_BATCH_MEMORY = 10 * 1024 * 1024; // 10MB per batch

let currentBatchMemory = 0;
const sendMemoryAwareBatch = (files, isComplete) => {
  event.sender.send("file-list-data", {
    files,
    isComplete,
    processed: allFiles.length,
    directories: processedDirs.size,
    total: allFiles.length,
    memoryUsage: process.memoryUsage().heapUsed
  });
  
  // Force garbage collection after large batches
  if (global.gc && currentBatchMemory > 5 * 1024 * 1024) {
    global.gc();
  }
  currentBatchMemory = 0;
};
```

#### 1.2 Optimize Renderer Process File Accumulation

**Current Issue**: Renderer keeps up to 50,000 files in memory
**Solution**: Implement sliding window with aggressive cleanup

```typescript
// electron-handlers.ts modifications
const SLIDING_WINDOW_SIZE = 10_000; // Reduced from 50,000
const MEMORY_PRESSURE_THRESHOLD = 0.7; // 70% of available memory

const getMemoryPressure = () => {
  if (window.performance && 'memory' in window.performance) {
    const memory = (window.performance as any).memory;
    return memory.usedJSHeapSize / memory.jsHeapSizeLimit;
  }
  return 0;
};

// In handleFileListData
if (getMemoryPressure() > MEMORY_PRESSURE_THRESHOLD) {
  // Aggressive cleanup
  accumulatedFiles = accumulatedFiles.slice(-SLIDING_WINDOW_SIZE / 2);
  
  // Clear file content cache
  fileContentCache.clear();
  
  // Notify user
  setProcessingStatus({
    status: "processing",
    message: "Optimizing memory usage...",
  });
}
```

### Phase 2: Enhanced Cache Management (Week 2)

#### 2.1 Migrate to Enhanced File Cache

**Action**: Replace basic cache with memory-aware enhanced cache throughout

```typescript
// utils/cache-factory.ts - New file
import { MemoryAwareFileCache, createEnhancedFileCache } from './enhanced-file-cache';

let cacheInstance: MemoryAwareFileCache | null = null;

export function getFileCache(): MemoryAwareFileCache {
  if (!cacheInstance) {
    // Detect environment and memory constraints
    const isElectron = window.electron !== undefined;
    const availableMemory = getAvailableMemory();
    
    const profile = isElectron ? 'electron' : 'development';
    cacheInstance = createEnhancedFileCache(profile);
    
    // Adjust based on available memory
    if (availableMemory < 4096) { // Less than 4GB
      cacheInstance.updateConfig({
        maxMemoryMB: Math.floor(availableMemory * 0.1), // Use 10% of RAM
        maxEntries: 500
      });
    }
  }
  return cacheInstance;
}
```

#### 2.2 Implement Content Compression

**Action**: Enable compression for cached content

```typescript
// enhanced-file-cache.ts modifications
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

private async compressContent(content: string): Promise<Buffer> {
  return await gzip(content, { level: 6 }); // Balanced compression
}

private async decompressContent(compressed: Buffer): Promise<string> {
  const buffer = await gunzip(compressed);
  return buffer.toString('utf8');
}

// In set method
if (sizeBytes > this.config.compressionThreshold) {
  const compressed = await this.compressContent(content);
  entry.content = compressed.toString('base64');
  entry.isCompressed = true;
  entry.sizeBytes = compressed.length;
}
```

### Phase 3: Memory Pressure Monitoring (Week 3)

#### 3.1 Implement Memory Monitor Service

```typescript
// utils/memory-monitor.ts - New file
export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  pressure: number;
  timestamp: number;
}

export class MemoryMonitor {
  private metrics: MemoryMetrics[] = [];
  private callbacks: Set<(metrics: MemoryMetrics) => void> = new Set();
  private interval: NodeJS.Timer | null = null;
  
  start(intervalMs: number = 5000) {
    this.interval = setInterval(() => {
      const metrics = this.collectMetrics();
      this.metrics.push(metrics);
      
      // Keep only last 100 metrics (8.3 minutes of history)
      if (this.metrics.length > 100) {
        this.metrics.shift();
      }
      
      // Notify listeners
      this.callbacks.forEach(cb => cb(metrics));
      
      // Trigger cleanup if pressure is high
      if (metrics.pressure > 0.8) {
        this.triggerMemoryCleanup();
      }
    }, intervalMs);
  }
  
  private collectMetrics(): MemoryMetrics {
    const memory = process.memoryUsage();
    const pressure = this.calculatePressure(memory);
    
    return {
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      pressure,
      timestamp: Date.now()
    };
  }
  
  private calculatePressure(memory: NodeJS.MemoryUsage): number {
    // Calculate based on heap usage and growth rate
    const heapUsageRatio = memory.heapUsed / memory.heapTotal;
    const growthRate = this.calculateGrowthRate();
    
    return Math.min(1, heapUsageRatio * 0.7 + growthRate * 0.3);
  }
  
  private triggerMemoryCleanup() {
    // Emit cleanup event
    const event = new CustomEvent('memory-pressure-high', {
      detail: { metrics: this.getLatestMetrics() }
    });
    window.dispatchEvent(event);
  }
}
```

#### 3.2 Integrate Memory Monitoring with UI

```typescript
// components/memory-indicator.tsx - New file
import React from 'react';
import { useMemoryMonitor } from '../hooks/use-memory-monitor';

export const MemoryIndicator: React.FC = () => {
  const { metrics, isHighPressure } = useMemoryMonitor();
  
  if (!metrics) return null;
  
  const usedMB = Math.round(metrics.heapUsed / 1024 / 1024);
  const pressurePercent = Math.round(metrics.pressure * 100);
  
  return (
    <div className={`memory-indicator ${isHighPressure ? 'high-pressure' : ''}`}>
      <span className="memory-usage">{usedMB}MB</span>
      <div className="pressure-bar">
        <div 
          className="pressure-fill" 
          style={{ width: `${pressurePercent}%` }}
        />
      </div>
      {isHighPressure && (
        <span className="pressure-warning">Memory pressure high</span>
      )}
    </div>
  );
};
```

### Phase 4: Aggressive Garbage Collection (Week 4)

#### 4.1 Implement Garbage Collection Scheduler

```typescript
// utils/gc-scheduler.ts - New file
export class GarbageCollectionScheduler {
  private lastGC: number = Date.now();
  private gcInterval: number = 30000; // 30 seconds base interval
  private memoryMonitor: MemoryMonitor;
  
  constructor(memoryMonitor: MemoryMonitor) {
    this.memoryMonitor = memoryMonitor;
    this.setupAutoGC();
  }
  
  private setupAutoGC() {
    // Adaptive GC based on memory pressure
    this.memoryMonitor.subscribe((metrics) => {
      const timeSinceLastGC = Date.now() - this.lastGC;
      const adaptiveInterval = this.calculateAdaptiveInterval(metrics.pressure);
      
      if (timeSinceLastGC > adaptiveInterval) {
        this.performGC();
      }
    });
  }
  
  private calculateAdaptiveInterval(pressure: number): number {
    // More frequent GC under pressure
    if (pressure > 0.8) return 5000;   // 5 seconds
    if (pressure > 0.6) return 15000;  // 15 seconds
    if (pressure > 0.4) return 30000;  // 30 seconds
    return 60000; // 1 minute
  }
  
  private performGC() {
    if (global.gc) {
      const before = process.memoryUsage().heapUsed;
      global.gc();
      const after = process.memoryUsage().heapUsed;
      
      console.log(`GC freed ${Math.round((before - after) / 1024 / 1024)}MB`);
      this.lastGC = Date.now();
    }
  }
  
  forceGC() {
    this.performGC();
  }
}
```

#### 4.2 Memory-Aware State Management

```typescript
// hooks/use-app-state.ts modifications
const useAppState = () => {
  // ... existing code ...
  
  // Add memory pressure listener
  useEffect(() => {
    const handleMemoryPressure = (event: CustomEvent) => {
      const { metrics } = event.detail;
      
      if (metrics.pressure > 0.8) {
        // Clear non-essential state
        setExpandedNodes({});
        
        // Clear file content for non-selected files
        const selectedPaths = new Set(fileSelection.selectedFiles.map(f => f.path));
        setAllFiles(files => files.map(file => ({
          ...file,
          content: selectedPaths.has(file.path) ? file.content : undefined,
          isContentLoaded: selectedPaths.has(file.path) ? file.isContentLoaded : false
        })));
        
        // Clear cache
        fileContentCache.clear();
      }
    };
    
    window.addEventListener('memory-pressure-high', handleMemoryPressure);
    return () => window.removeEventListener('memory-pressure-high', handleMemoryPressure);
  }, [fileSelection.selectedFiles]);
};
```

### Phase 5: Data Structure Optimization (Week 5)

#### 5.1 Implement Virtual File List

```typescript
// utils/virtual-file-list.ts - New file
export class VirtualFileList {
  private fileIndex: Map<string, number> = new Map();
  private visibleRange: { start: number; end: number } = { start: 0, end: 100 };
  private loadedFiles: Map<string, FileData> = new Map();
  
  constructor(private totalFiles: number) {}
  
  setVisibleRange(start: number, end: number) {
    this.visibleRange = { start, end };
    this.loadVisibleFiles();
    this.unloadInvisibleFiles();
  }
  
  private loadVisibleFiles() {
    for (let i = this.visibleRange.start; i <= this.visibleRange.end; i++) {
      // Request file data if not loaded
      if (!this.loadedFiles.has(this.getPathByIndex(i))) {
        this.requestFileData(i);
      }
    }
  }
  
  private unloadInvisibleFiles() {
    const buffer = 50; // Keep 50 files above and below visible range
    const keepStart = Math.max(0, this.visibleRange.start - buffer);
    const keepEnd = Math.min(this.totalFiles - 1, this.visibleRange.end + buffer);
    
    // Unload files outside buffer zone
    for (const [path, file] of this.loadedFiles) {
      const index = this.fileIndex.get(path);
      if (index && (index < keepStart || index > keepEnd)) {
        this.loadedFiles.delete(path);
      }
    }
  }
}
```

#### 5.2 Optimize Token Counting

```typescript
// utils/lazy-token-counter.ts - New file
export class LazyTokenCounter {
  private tokenCache = new Map<string, number>();
  private pendingCounts = new Map<string, Promise<number>>();
  
  async getTokenCount(filePath: string, content?: string): Promise<number> {
    // Check cache first
    if (this.tokenCache.has(filePath)) {
      return this.tokenCache.get(filePath)!;
    }
    
    // Check if already counting
    if (this.pendingCounts.has(filePath)) {
      return this.pendingCounts.get(filePath)!;
    }
    
    // Start counting
    const countPromise = this.countTokensAsync(filePath, content);
    this.pendingCounts.set(filePath, countPromise);
    
    const count = await countPromise;
    this.tokenCache.set(filePath, count);
    this.pendingCounts.delete(filePath);
    
    return count;
  }
  
  private async countTokensAsync(filePath: string, content?: string): Promise<number> {
    // Offload to web worker for large files
    if (content && content.length > 100000) {
      return await this.countInWorker(content);
    }
    
    return countTokens(content || '');
  }
}
```

## Performance Metrics and Monitoring

### Key Performance Indicators (KPIs)

1. **Memory Usage Reduction**
   - Target: 30% reduction in average heap usage
   - Measurement: Compare before/after implementation over 1-hour sessions

2. **File Processing Performance**
   - Target: < 3 seconds for 10,000 files
   - Current: ~5 seconds

3. **Cache Hit Rate**
   - Target: > 80% for frequently accessed files
   - Current: Not measured

4. **Memory Pressure Events**
   - Target: < 5 per hour during normal usage
   - Current: Not tracked

### Monitoring Implementation

```typescript
// utils/performance-tracker.ts
export class PerformanceTracker {
  private metrics: Map<string, number[]> = new Map();
  
  track(metric: string, value: number) {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    
    const values = this.metrics.get(metric)!;
    values.push(value);
    
    // Keep only last 1000 values
    if (values.length > 1000) {
      values.shift();
    }
  }
  
  getStats(metric: string) {
    const values = this.metrics.get(metric) || [];
    if (values.length === 0) return null;
    
    return {
      avg: values.reduce((a, b) => a + b) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      median: this.median(values),
      p95: this.percentile(values, 95)
    };
  }
}
```

## Testing Strategy

### Unit Tests

1. **Memory Limit Tests**
   - Test sliding window implementation
   - Verify memory pressure calculations
   - Test garbage collection triggers

2. **Cache Tests**
   - Test compression/decompression
   - Verify eviction policies
   - Test memory limit enforcement

3. **Performance Tests**
   - Large file set processing (50,000+ files)
   - Memory usage under pressure
   - Cache performance benchmarks

### Integration Tests

1. **End-to-End Memory Tests**
   - Load large repository
   - Monitor memory usage over time
   - Verify cleanup mechanisms

2. **Stress Tests**
   - Rapid file selection/deselection
   - Multiple large workspaces
   - Concurrent operations

## Risk Assessment and Mitigation

### Risks

1. **Performance Regression**
   - Risk: Aggressive GC may impact UI responsiveness
   - Mitigation: Adaptive GC scheduling, performance monitoring

2. **Data Loss**
   - Risk: Aggressive cleanup may lose user state
   - Mitigation: Protect selected files, implement state recovery

3. **Platform Differences**
   - Risk: Memory APIs vary across platforms
   - Mitigation: Feature detection, fallback strategies

### Rollback Plan

1. Feature flags for each optimization phase
2. A/B testing with subset of users
3. Automated performance regression detection
4. Quick revert capability via configuration

## Timeline and Milestones

| Week | Phase | Deliverables | Success Criteria |
|------|-------|--------------|------------------|
| 1 | Immediate Optimizations | Streaming file processing, Sliding window | 15% memory reduction |
| 2 | Cache Management | Enhanced cache migration, Compression | Cache hit rate > 70% |
| 3 | Memory Monitoring | Monitor service, UI indicators | Real-time pressure tracking |
| 4 | Garbage Collection | Adaptive GC, Memory-aware state | 25% memory reduction |
| 5 | Data Structures | Virtual lists, Lazy token counting | 30% total reduction |

## Conclusion

This comprehensive plan addresses PasteFlow's memory management challenges through a multi-phase approach combining immediate optimizations with long-term architectural improvements. The implementation focuses on maintaining application performance while achieving the target 30% memory reduction, with built-in monitoring and rollback capabilities to ensure a smooth transition.