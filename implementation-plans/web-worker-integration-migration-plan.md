# Web Worker Integration and Migration Plan for Token Counting

## Executive Summary

This document outlines the integration strategy, migration approach, testing methodology, and deployment plan for implementing Web Worker-based token counting in PasteFlow. Building upon the Web Worker infrastructure plan, this focuses on seamlessly integrating the new system with existing functionality while ensuring zero disruption to users.

## Integration Context

### Current System Integration Points

1. **useAppState Hook** (`src/hooks/use-app-state.ts`)
   - Central state management for file operations
   - Currently calls synchronous token counting via IPC
   - Needs to integrate with async worker-based counting

2. **Enhanced File Cache** (`enhancedFileContentCache`)
   - Caches file content to avoid redundant reads
   - Must be updated to include token counts
   - Needs coordination with worker pool

3. **IPC Handlers** (`main.js`)
   - Currently performs token counting in main process
   - Must be modified to defer counting to renderer
   - Maintains backward compatibility during migration

4. **File Selection UI** (`src/components/sidebar.tsx`, `src/components/file-card.tsx`)
   - Displays token counts in real-time
   - Must show loading states during async counting
   - Needs smooth UI updates without flicker

## Integration Strategy

### 1. Enhanced File Cache Integration

Update the cache system to work with async token counting:

```typescript
// src/hooks/use-app-state.ts modifications
import { useTokenCounter } from './use-token-counter';

// In useAppState hook
const { countTokens, countTokensBatch } = useTokenCounter();

// Modify loadFileContent to use workers
const loadFileContent = useCallback(async (filePath: string) => {
  const file = files.find(f => f.path === filePath);
  if (!file || file.isContentLoaded) return;
  
  // Check cache first
  const cachedContent = enhancedFileContentCache.get(filePath);
  if (cachedContent) {
    // Count tokens using worker
    const tokenCount = await countTokens(cachedContent);
    
    setFiles(prev => prev.map(f => 
      f.path === filePath 
        ? { ...f, content: cachedContent, tokenCount, isContentLoaded: true }
        : f
    ));
    return;
  }
  
  // Load from backend
  const result = await window.electron.requestFileContent(filePath);
  if (result.success && result.content) {
    // Count tokens in worker
    const tokenCount = await countTokens(result.content);
    
    // Update cache with token count
    enhancedFileContentCache.set(filePath, result.content);
    
    setFiles(prev => prev.map(f => 
      f.path === filePath 
        ? { ...f, content: result.content, tokenCount, isContentLoaded: true }
        : f
    ));
  }
}, [files, countTokens]);
```

### 2. IPC Handler Updates

Modify main process to remove synchronous token counting:

```typescript
// main.js modifications
ipcMain.handle('request-file-content', async (event, filePath) => {
  try {
    // ... existing validation ...
    
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Remove synchronous token counting from main process
    // Let the renderer handle it with workers
    return {
      success: true,
      content: content,
      // tokenCount removed - will be calculated in renderer
    };
  } catch (error) {
    // ... error handling ...
  }
});
```

### 3. UI State Management

Add loading states and progress indicators:

```typescript
// src/types/file-types.ts additions
interface FileData {
  // ... existing fields ...
  isCountingTokens?: boolean;
  tokenCountError?: string;
}

// src/components/file-card.tsx modifications
export function FileCard({ file, onToggle }: FileCardProps) {
  return (
    <div className="file-card">
      <span className="file-name">{file.name}</span>
      {file.isCountingTokens ? (
        <span className="token-count loading">Counting...</span>
      ) : file.tokenCount !== undefined ? (
        <span className="token-count">{file.tokenCount} tokens</span>
      ) : file.tokenCountError ? (
        <span className="token-count error">Error</span>
      ) : null}
    </div>
  );
}
```

### 4. Batch Processing Integration

Optimize for multiple file selections:

```typescript
// src/hooks/use-app-state.ts - batch loading enhancement
const loadMultipleFileContents = useCallback(async (filePaths: string[]) => {
  // Set loading states
  setFiles(prev => prev.map(f => 
    filePaths.includes(f.path) 
      ? { ...f, isCountingTokens: true }
      : f
  ));
  
  // Load all contents
  const contents = await Promise.all(
    filePaths.map(path => window.electron.requestFileContent(path))
  );
  
  // Extract successful content loads
  const validContents = contents
    .filter(r => r.success && r.content)
    .map(r => r.content!);
  
  // Batch count tokens
  const tokenCounts = await countTokensBatch(validContents);
  
  // Update state with results
  setFiles(prev => prev.map(f => {
    const index = filePaths.indexOf(f.path);
    if (index === -1) return f;
    
    const result = contents[index];
    const tokenCount = result.success ? tokenCounts[index] : undefined;
    
    return {
      ...f,
      content: result.content,
      tokenCount,
      isContentLoaded: result.success,
      isCountingTokens: false,
      tokenCountError: result.success ? undefined : 'Failed to load'
    };
  }));
}, [countTokensBatch]);
```

## Migration Strategy

### Phase 1: Infrastructure Setup (2-3 days)

**Goal**: Establish the foundation without affecting existing functionality

1. **Install Dependencies**
   ```bash
   npm install --save-dev vite-plugin-wasm@^3.3.0 vite-plugin-top-level-await@^1.4.1
   ```

2. **Configure Build Tools**
   - Update `vite.config.ts` with worker and WASM support
   - Update `electron-builder.config.js` for WASM packaging
   - Test development and production builds

3. **Create Core Files**
   - `src/workers/token-counter-worker.ts`
   - `src/utils/token-worker-pool.ts`
   - `src/hooks/use-token-counter.ts`
   - `src/utils/worker-loader.ts`

4. **Initial Testing**
   - Verify worker initialization in development
   - Test WASM loading in Electron renderer
   - Benchmark performance vs current implementation

### Phase 2: Core Implementation (3-4 days)

**Goal**: Implement worker functionality with feature flag

1. **Worker Implementation**
   - Port sanitization functions from main process
   - Implement tiktoken encoder initialization
   - Add comprehensive error handling
   - Create health check mechanisms

2. **Pool Management**
   - Implement dynamic pool sizing
   - Create job queue system
   - Add performance monitoring
   - Implement memory management

3. **React Integration**
   - Create useTokenCounter hook
   - Add to useAppState behind feature flag
   - Implement loading states
   - Add error boundaries

4. **Feature Flag System**
   ```typescript
   // src/utils/feature-flags.ts
   export const FEATURES = {
     WORKER_TOKEN_COUNTING: localStorage.getItem('enable-worker-tokens') !== 'false'
   };
   ```

### Phase 3: Integration (2-3 days)

**Goal**: Integrate with existing systems maintaining backward compatibility

1. **Cache System Integration**
   - Update enhancedFileContentCache usage
   - Implement cache warming strategies
   - Add token count to cache entries

2. **UI Updates**
   - Add loading indicators
   - Implement progress feedback
   - Update file cards and selection UI
   - Add smooth transitions

3. **IPC Handler Modifications**
   - Remove main process token counting
   - Update response formats
   - Maintain compatibility layer

4. **Error Handling**
   - Implement comprehensive fallbacks
   - Add user-friendly error messages
   - Create recovery mechanisms

### Phase 4: Testing & Optimization (3-4 days)

**Goal**: Ensure reliability and performance meet targets

1. **Unit Testing**
   - Worker functionality tests
   - Pool management tests
   - Integration hook tests
   - Error scenario tests

2. **Integration Testing**
   - File selection workflows
   - Cache integration
   - Batch processing
   - Memory leak detection

3. **Performance Testing**
   - Large file handling
   - Concurrent operations
   - Memory usage patterns
   - UI responsiveness metrics

4. **Cross-Platform Testing**
   - Windows WASM loading
   - macOS ARM64 performance
   - Linux compatibility

### Phase 5: Production Readiness (2-3 days)

**Goal**: Prepare for safe production deployment

1. **Build Configuration**
   - Finalize electron-builder settings
   - Test production builds
   - Verify WASM packaging
   - Create build verification scripts

2. **Monitoring Setup**
   ```typescript
   // src/utils/worker-metrics.ts
   export class WorkerMetrics {
     private metrics = {
       initTime: 0,
       avgProcessingTime: 0,
       errorRate: 0,
       fallbackRate: 0
     };
     
     report() {
       // Send to analytics service
       console.log('[Metrics]', this.metrics);
     }
   }
   ```

3. **Documentation**
   - Update CLAUDE.md
   - Create troubleshooting guide
   - Document configuration options
   - Add performance tuning guide

4. **Rollout Planning**
   - Create feature flag controls
   - Plan gradual rollout strategy
   - Prepare rollback procedures
   - Set up monitoring alerts

## Testing Strategy

### Unit Tests

```typescript
// src/__tests__/token-worker-pool.test.ts
describe('TokenWorkerPool', () => {
  it('should count tokens accurately with tiktoken', async () => {
    const pool = new TokenWorkerPool(2);
    const text = 'Hello, world!';
    const count = await pool.countTokens(text);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });
  
  it('should handle worker failures gracefully', async () => {
    const pool = new TokenWorkerPool(1);
    // Simulate failure by sending huge text
    const hugeText = 'x'.repeat(11 * 1024 * 1024); // 11MB
    const count = await pool.countTokens(hugeText);
    // Should fall back to estimation
    expect(count).toBe(Math.ceil(hugeText.length / 4));
  });
  
  it('should process batches efficiently', async () => {
    const pool = new TokenWorkerPool(4);
    const texts = Array(100).fill('Sample text for token counting');
    const start = Date.now();
    const counts = await pool.countTokensBatch(texts);
    const duration = Date.now() - start;
    
    expect(counts).toHaveLength(100);
    expect(counts.every(c => c > 0)).toBe(true);
    expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds
  });
  
  it('should recover from worker crashes', async () => {
    const pool = new TokenWorkerPool(2);
    // Cause a worker crash
    await pool.countTokens('trigger-crash-somehow');
    // Should still work after crash
    const count = await pool.countTokens('normal text');
    expect(count).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```typescript
// src/__tests__/file-selection-with-workers.test.tsx
describe('File selection with worker-based token counting', () => {
  it('should maintain UI responsiveness during large file processing', async () => {
    const { result } = renderHook(() => useAppState());
    
    // Create mock large file
    const largeFile = {
      path: '/test/large.js',
      content: 'x'.repeat(1024 * 1024), // 1MB
      isDirectory: false
    };
    
    // Start monitoring frame time
    const frameMonitor = new FrameTimeMonitor();
    frameMonitor.start();
    
    // Load file content
    await act(async () => {
      await result.current.loadFileContent(largeFile.path);
    });
    
    // Check frame times stayed under 16ms (60fps)
    const maxFrameTime = frameMonitor.getMaxFrameTime();
    expect(maxFrameTime).toBeLessThan(16);
  });
  
  it('should handle concurrent file selections', async () => {
    const { result } = renderHook(() => useAppState());
    
    // Select multiple files rapidly
    const filePaths = Array(10).fill(0).map((_, i) => `/test/file${i}.js`);
    
    await act(async () => {
      // Load all files concurrently
      await Promise.all(
        filePaths.map(path => result.current.loadFileContent(path))
      );
    });
    
    // All files should have token counts
    const files = result.current.files;
    const loadedFiles = files.filter(f => filePaths.includes(f.path));
    expect(loadedFiles.every(f => f.tokenCount !== undefined)).toBe(true);
  });
  
  it('should integrate with file cache properly', async () => {
    const { result } = renderHook(() => useAppState());
    const testPath = '/test/cached.js';
    
    // First load
    await act(async () => {
      await result.current.loadFileContent(testPath);
    });
    
    const firstTokenCount = result.current.files
      .find(f => f.path === testPath)?.tokenCount;
    
    // Clear file state but not cache
    act(() => {
      result.current.setFiles(prev => 
        prev.map(f => f.path === testPath 
          ? { ...f, isContentLoaded: false, content: undefined, tokenCount: undefined }
          : f
        )
      );
    });
    
    // Second load should use cache
    const start = Date.now();
    await act(async () => {
      await result.current.loadFileContent(testPath);
    });
    const duration = Date.now() - start;
    
    const secondTokenCount = result.current.files
      .find(f => f.path === testPath)?.tokenCount;
    
    expect(secondTokenCount).toBe(firstTokenCount);
    expect(duration).toBeLessThan(50); // Cache hit should be fast
  });
});
```

### E2E Tests

```typescript
// e2e/token-counting-performance.test.ts
describe('Token counting performance', () => {
  it('should process large repository without UI freezing', async () => {
    // Open application
    await app.start();
    
    // Load a large codebase
    await app.selectFolder('/path/to/large/repo');
    
    // Monitor UI responsiveness
    const scrollContainer = await app.findElement('.file-tree');
    
    // Start scrolling
    await scrollContainer.scroll({ top: 1000 });
    
    // Select all files
    await app.click('[data-testid="select-all"]');
    
    // Verify smooth scrolling during processing
    let lastScrollTop = 0;
    for (let i = 0; i < 10; i++) {
      await scrollContainer.scroll({ top: lastScrollTop + 100 });
      const currentScrollTop = await scrollContainer.getScrollTop();
      
      // Scrolling should work (no UI freeze)
      expect(currentScrollTop).toBeGreaterThan(lastScrollTop);
      lastScrollTop = currentScrollTop;
      
      await app.wait(100);
    }
    
    // Eventually all files should have token counts
    await app.waitFor(() => {
      const tokenCounts = app.findAll('.token-count:not(.loading)');
      return tokenCounts.length === expectedFileCount;
    }, { timeout: 30000 });
  });
  
  it('should handle worker failures in production build', async () => {
    // Test with production build
    await app.startProduction();
    
    // Simulate worker failure conditions
    await app.evaluate(() => {
      // Override Worker constructor to fail
      window.Worker = class FailingWorker {
        constructor() {
          throw new Error('Worker creation failed');
        }
      };
    });
    
    // Load files - should fall back to estimation
    await app.selectFolder('/test/folder');
    await app.selectFile('/test/folder/file.js');
    
    // Should still show token count (from fallback)
    const tokenCount = await app.findElement('.token-count');
    expect(await tokenCount.getText()).toMatch(/\d+ tokens/);
  });
});
```

## Performance Monitoring

### Key Metrics to Track

1. **Performance Metrics**
   ```typescript
   interface PerformanceMetrics {
     tokenCountingDuration: number;      // Time to count tokens
     workerInitTime: number;             // Worker startup time
     queueDepth: number;                 // Pending jobs
     workerUtilization: number;          // % of time workers are busy
     cacheHitRate: number;               // % of cache hits
   }
   ```

2. **Error Metrics**
   ```typescript
   interface ErrorMetrics {
     workerInitFailures: number;         // Failed to create workers
     wasmLoadErrors: number;             // WASM loading failures
     tokenCountTimeouts: number;         // Operations that timed out
     fallbackCount: number;              // Times fallback was used
   }
   ```

3. **User Experience Metrics**
   ```typescript
   interface UXMetrics {
     frameRate: number;                  // FPS during processing
     timeToFirstToken: number;           // First result latency
     perceivedResponsiveness: number;    // Subjective score
   }
   ```

### Monitoring Implementation

```typescript
// src/utils/performance-monitor.ts
export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  
  record(metric: string, value: number) {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    this.metrics.get(metric)!.push(value);
    
    // Keep only last 1000 values
    const values = this.metrics.get(metric)!;
    if (values.length > 1000) {
      values.shift();
    }
  }
  
  getStats(metric: string) {
    const values = this.metrics.get(metric) || [];
    if (values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(values.length * 0.5)],
      p95: sorted[Math.floor(values.length * 0.95)],
      p99: sorted[Math.floor(values.length * 0.99)]
    };
  }
  
  generateReport() {
    const report: Record<string, any> = {};
    for (const [metric, _] of this.metrics) {
      report[metric] = this.getStats(metric);
    }
    return report;
  }
}
```

## Rollback Strategy

### Feature Flag Control

```typescript
// src/utils/feature-control.ts
export class FeatureControl {
  private static readonly FLAG_KEY = 'enable-worker-tokens';
  
  static isEnabled(): boolean {
    // Check multiple sources in priority order
    
    // 1. URL parameter (for testing)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('worker-tokens')) {
      return urlParams.get('worker-tokens') === 'true';
    }
    
    // 2. Local storage (user preference)
    const stored = localStorage.getItem(this.FLAG_KEY);
    if (stored !== null) {
      return stored !== 'false';
    }
    
    // 3. Remote config (if available)
    if (window.remoteConfig?.workerTokens !== undefined) {
      return window.remoteConfig.workerTokens;
    }
    
    // 4. Default to enabled
    return true;
  }
  
  static disable() {
    localStorage.setItem(this.FLAG_KEY, 'false');
    // Reload to apply changes
    window.location.reload();
  }
  
  static enable() {
    localStorage.setItem(this.FLAG_KEY, 'true');
    window.location.reload();
  }
}
```

### Automatic Rollback

```typescript
// src/utils/auto-rollback.ts
export class AutoRollback {
  private static readonly ERROR_THRESHOLD = 0.1; // 10% error rate
  private static readonly SAMPLE_SIZE = 100;
  
  static monitor(pool: TokenWorkerPool) {
    let sampleCount = 0;
    let errorCount = 0;
    
    // Monitor performance
    const checkPerformance = () => {
      const stats = pool.getPerformanceStats();
      sampleCount++;
      
      if (stats.failureCount > 0) {
        errorCount += stats.failureCount;
      }
      
      // Check if we should rollback
      if (sampleCount >= this.SAMPLE_SIZE) {
        const errorRate = errorCount / sampleCount;
        
        if (errorRate > this.ERROR_THRESHOLD) {
          console.error(`High error rate detected: ${errorRate * 100}%`);
          FeatureControl.disable();
          
          // Report to analytics
          window.analytics?.track('worker_tokens_auto_disabled', {
            errorRate,
            sampleCount,
            errorCount
          });
        }
        
        // Reset counters
        sampleCount = 0;
        errorCount = 0;
      }
    };
    
    // Check every minute
    setInterval(checkPerformance, 60000);
  }
}
```

### Manual Override

Add UI controls for users to manage the feature:

```typescript
// src/components/settings-modal.tsx
export function SettingsModal() {
  const [workerTokensEnabled, setWorkerTokensEnabled] = useState(
    FeatureControl.isEnabled()
  );
  
  return (
    <div className="settings-modal">
      <h2>Advanced Settings</h2>
      
      <label>
        <input
          type="checkbox"
          checked={workerTokensEnabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            setWorkerTokensEnabled(enabled);
            
            if (enabled) {
              FeatureControl.enable();
            } else {
              FeatureControl.disable();
            }
          }}
        />
        Use Web Workers for token counting (experimental)
      </label>
      
      <p className="help-text">
        Disabling this will use the legacy token counting method.
        Only disable if you experience issues.
      </p>
    </div>
  );
}
```

## Success Criteria

### Performance Targets
- ✓ 70% reduction in UI freeze time during large file processing
- ✓ Maintain 60fps during token counting operations
- ✓ Sub-second response time for files under 1MB
- ✓ Linear scaling with worker count for batch operations

### Reliability Targets
- ✓ <0.1% worker initialization failure rate
- ✓ 100% successful fallback when workers unavailable
- ✓ No memory leaks after 24 hours of operation
- ✓ Graceful degradation on unsupported platforms

### User Experience Targets
- ✓ Smooth, responsive file selection
- ✓ Real-time token count updates
- ✓ Clear progress indication
- ✓ No regression in token counting accuracy

## Implementation Timeline

### Week 1: Foundation
- Days 1-2: Infrastructure setup
- Days 3-5: Core implementation

### Week 2: Integration
- Days 6-7: System integration  
- Days 8-10: Testing and optimization

### Week 3: Production
- Days 11-12: Production readiness
- Days 13-14: Deployment and monitoring
- Day 15: Buffer for issues

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing (unit, integration, E2E)
- [ ] Performance benchmarks meet targets
- [ ] Cross-platform testing complete
- [ ] Documentation updated
- [ ] Feature flags configured
- [ ] Monitoring in place

### Deployment
- [ ] Deploy with feature flag disabled by default
- [ ] Enable for internal testing team
- [ ] Monitor metrics for 24 hours
- [ ] Gradual rollout to 10% of users
- [ ] Monitor for 48 hours
- [ ] Full rollout if metrics are good

### Post-Deployment
- [ ] Monitor error rates and performance
- [ ] Gather user feedback
- [ ] Address any issues quickly
- [ ] Document lessons learned
- [ ] Plan optimization iterations

## Risk Mitigation

### Technical Risks
1. **WASM Loading Failures**
   - Mitigation: Comprehensive fallback to estimation
   - Detection: Monitor WASM load success rate
   
2. **Memory Leaks**
   - Mitigation: Automatic worker recycling
   - Detection: Memory monitoring and alerts

3. **Platform Incompatibility**
   - Mitigation: Feature detection and graceful degradation
   - Detection: Platform-specific testing

### User Experience Risks
1. **Perceived Slowness**
   - Mitigation: Optimistic UI updates
   - Detection: User feedback and analytics

2. **Confusion During Migration**
   - Mitigation: Clear communication and UI indicators
   - Detection: Support ticket monitoring

## Summary

This integration and migration plan provides a comprehensive roadmap for successfully implementing Web Worker-based token counting in PasteFlow. The plan emphasizes:

1. **Gradual Integration** - Feature flags and phased rollout
2. **Comprehensive Testing** - Unit, integration, and E2E coverage
3. **Performance Monitoring** - Detailed metrics and automatic rollback
4. **User Experience** - Smooth transition with clear feedback
5. **Risk Management** - Multiple fallback mechanisms and monitoring

By following this plan, we can achieve the performance improvements while maintaining reliability and user trust throughout the migration process.