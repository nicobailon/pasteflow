# Web Workers for Token Counting - Implementation Plan v2

## Executive Summary

This document outlines the comprehensive implementation plan for moving token counting operations to Web Workers in PasteFlow. The goal is to prevent UI freezing during large file processing by offloading the computationally expensive tiktoken operations to background threads, targeting a 50% reduction in UI freeze time while ensuring compatibility with Electron's renderer process and maintaining fallback capabilities.

## Current State Analysis

### Current Implementation

1. **Main Process Token Counting**
   - **Tiktoken Initialization** (`main.js:32-59`): Sets up o200k_base encoding (GPT-4o)
   - **Text Sanitization** (`main.js:314-331`): Removes problematic tokens and control characters
   - **Token Counting Function** (`main.js:334-358`): Synchronous operation that blocks the main process
   - **File Content Loading** (`main.js:670-691`): Integrates with IPC handlers
   - Falls back to character-based estimation (4 chars/token) on failure

2. **Renderer Process Estimation** (`src/utils/token-utils.ts`)
   - Simple character-based estimation only
   - No actual tiktoken usage in renderer
   - Used for real-time UI updates before accurate counts arrive

3. **Existing Infrastructure**
   - **Enhanced File Cache**: `enhancedFileContentCache` for content caching
   - **Worker Threads**: Existing `worker.js` for Node.js Worker Threads (potential naming conflict)
   - **IPC Handlers**: `request-file-content` handler manages file loading

4. **Performance Bottlenecks**
   - Synchronous tiktoken.encode() blocks the main process
   - Large files (>1MB) cause noticeable UI freezes
   - Batch file selection compounds the blocking issue
   - No concurrency for multiple file token counting

## Proposed Architecture

### 1. Web Worker Strategy for Electron Renderer

```
Renderer Process                    Web Worker Pool
┌─────────────────┐                ┌─────────────────┐
│                 │   postMessage   │                 │
│  useAppState    ├───────────────>│ Token Counter   │
│                 │                 │   Worker 1      │
│                 │<───────────────┤                 │
│                 │   onmessage     └─────────────────┘
│                 │                 ┌─────────────────┐
│ Enhanced File   ├───────────────>│ Token Counter   │
│     Cache       │                 │   Worker 2      │
│                 │<───────────────┤                 │
└─────────────────┘                 └─────────────────┘
```

### 2. Implementation Components

#### A. Token Worker Module (`src/workers/token-counter-worker.ts`)
```typescript
// Web Worker script using correct tiktoken imports
import { Tiktoken } from 'tiktoken/lite';
import o200k_base from 'tiktoken/encoders/o200k_base.json';

let encoder: Tiktoken | null = null;

// Port control character detection from main process
function isControlOrBinaryChar(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  // Control characters: 0x00-0x1F (excluding tab, newline, carriage return) and 0x7F-0x9F
  if ((codePoint >= 0x00 && codePoint <= 0x08) ||
      (codePoint >= 0x0B && codePoint <= 0x0C) ||
      (codePoint >= 0x0E && codePoint <= 0x1F) ||
      (codePoint >= 0x7F && codePoint <= 0x9F)) {
    return true;
  }
  // Additional ranges for other non-printable or binary-indicative characters
  if (codePoint > 0xFFFF) return false;
  return false;
}

// Port sanitization function from main process
function sanitizeTextForTokenCount(text: string): string {
  // Remove special tiktoken end-of-text markers
  let sanitizedText = text.replace(/<\|endoftext\|>/g, "");
  
  // Remove control and binary characters except tab, newline, carriage return
  let result = "";
  for (let i = 0; i < sanitizedText.length; i++) {
    const codePoint = sanitizedText.codePointAt(i);
    if (!isControlOrBinaryChar(codePoint) || 
        codePoint === 9 || codePoint === 10 || codePoint === 13) {
      result += sanitizedText[i];
    }
  }
  return result;
}

// Initialize encoder with proper error handling
async function initializeEncoder(): Promise<boolean> {
  try {
    encoder = new Tiktoken(
      o200k_base.bpe_ranks,
      o200k_base.special_tokens,
      o200k_base.pat_str
    );
    return true;
  } catch (error) {
    console.error('[Worker] Failed to initialize tiktoken encoder:', error);
    encoder = null;
    return false;
  }
}

// Security: Input validation
const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB limit

self.onmessage = async (event) => {
  const { type, payload, id } = event.data;
  
  try {
    switch (type) {
      case 'INIT':
        const success = await initializeEncoder();
        self.postMessage({ type: 'INIT_COMPLETE', id, success });
        break;
        
      case 'COUNT_TOKENS':
        // Validate input size
        if (payload.text.length > MAX_TEXT_SIZE) {
          self.postMessage({ 
            type: 'ERROR', 
            id, 
            error: 'Text too large for processing' 
          });
          return;
        }
        
        const sanitizedText = sanitizeTextForTokenCount(payload.text);
        const count = encoder ? encoder.encode(sanitizedText).length : -1;
        
        self.postMessage({ 
          type: 'TOKEN_COUNT', 
          id, 
          result: count,
          fallback: count === -1 
        });
        break;
        
      case 'BATCH_COUNT':
        const results = await Promise.all(
          payload.texts.map(text => {
            const sanitized = sanitizeTextForTokenCount(text);
            return encoder ? encoder.encode(sanitized).length : -1;
          })
        );
        self.postMessage({ type: 'BATCH_RESULT', id, results });
        break;
        
      case 'HEALTH_CHECK':
        self.postMessage({ 
          type: 'HEALTH_RESPONSE', 
          id, 
          healthy: encoder !== null 
        });
        break;
    }
  } catch (error) {
    self.postMessage({ 
      type: 'ERROR', 
      id, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
};
```

#### B. Worker Pool Manager (`src/utils/token-worker-pool.ts`)
```typescript
import { estimateTokenCount } from './token-utils';

interface QueueItem {
  id: string;
  text: string;
  resolve: (count: number) => void;
  reject: (error: Error) => void;
}

interface ActiveJob {
  workerId: number;
  startTime: number;
  size: number;
}

export class TokenWorkerPool {
  private workers: Worker[] = [];
  private queue: QueueItem[] = [];
  private activeJobs = new Map<string, ActiveJob>();
  private workerStatus: boolean[] = [];
  private isTerminated = false;
  
  // Performance monitoring
  private performanceStats = {
    totalProcessed: 0,
    totalTime: 0,
    failureCount: 0
  };
  
  constructor(private poolSize = Math.min(navigator.hardwareConcurrency || 4, 8)) {
    this.initializeWorkers();
  }
  
  private async initializeWorkers() {
    // Progressive enhancement check
    const supportsWorkers = typeof Worker !== 'undefined';
    const supportsWasm = typeof WebAssembly !== 'undefined';
    
    if (!supportsWorkers || !supportsWasm) {
      console.warn('Web Workers or WASM not supported, falling back to estimation');
      this.isTerminated = true;
      return;
    }
    
    for (let i = 0; i < this.poolSize; i++) {
      try {
        // Note: Webpack/Vite will handle worker bundling
        const worker = new Worker(
          new URL('../workers/token-counter-worker.ts', import.meta.url),
          { type: 'module' }
        );
        
        worker.onerror = (error) => {
          console.error(`Worker ${i} error:`, error);
          this.workerStatus[i] = false;
        };
        
        worker.onmessage = (event) => {
          this.handleWorkerMessage(i, event);
        };
        
        // Initialize the worker
        worker.postMessage({ type: 'INIT', id: `init-${i}` });
        
        this.workers.push(worker);
        this.workerStatus.push(false); // Will be set to true on successful init
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }
    
    // Wait for workers to initialize
    await this.waitForWorkerInit();
  }
  
  private async waitForWorkerInit(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.workerStatus.filter(Boolean).length > 0) {
        return; // At least one worker is ready
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.warn('Worker initialization timeout - falling back to estimation');
  }
  
  private handleWorkerMessage(workerId: number, event: MessageEvent) {
    const { type, id, result, success, error } = event.data;
    
    switch (type) {
      case 'INIT_COMPLETE':
        this.workerStatus[workerId] = success;
        break;
        
      case 'TOKEN_COUNT':
        const job = this.activeJobs.get(id);
        if (job) {
          // Update performance stats
          const duration = Date.now() - job.startTime;
          this.performanceStats.totalProcessed++;
          this.performanceStats.totalTime += duration;
          
          this.activeJobs.delete(id);
          this.processNextInQueue(workerId);
        }
        break;
        
      case 'ERROR':
        this.performanceStats.failureCount++;
        this.activeJobs.delete(id);
        this.processNextInQueue(workerId);
        break;
    }
  }
  
  private processNextInQueue(workerId: number) {
    if (this.queue.length === 0) return;
    
    const item = this.queue.shift();
    if (!item) return;
    
    this.activeJobs.set(item.id, {
      workerId,
      startTime: Date.now(),
      size: item.text.length
    });
    
    this.workers[workerId].postMessage({
      type: 'COUNT_TOKENS',
      id: item.id,
      payload: { text: item.text }
    });
  }
  
  async countTokens(text: string): Promise<number> {
    // Fast path for terminated or no workers
    if (this.isTerminated || this.workers.length === 0) {
      return estimateTokenCount(text);
    }
    
    // Find available worker
    const availableWorkerIndex = this.workerStatus.findIndex(
      (status, index) => status && !Array.from(this.activeJobs.values())
        .some(job => job.workerId === index)
    );
    
    return new Promise((resolve, reject) => {
      const id = `count-${Date.now()}-${Math.random()}`;
      
      if (availableWorkerIndex !== -1) {
        // Direct processing
        this.activeJobs.set(id, {
          workerId: availableWorkerIndex,
          startTime: Date.now(),
          size: text.length
        });
        
        const worker = this.workers[availableWorkerIndex];
        
        // Set up one-time message handler
        const messageHandler = (event: MessageEvent) => {
          if (event.data.id === id) {
            worker.removeEventListener('message', messageHandler);
            
            if (event.data.type === 'TOKEN_COUNT') {
              resolve(event.data.fallback ? estimateTokenCount(text) : event.data.result);
            } else if (event.data.type === 'ERROR') {
              console.warn('Worker error, falling back:', event.data.error);
              resolve(estimateTokenCount(text));
            }
            
            const job = this.activeJobs.get(id);
            if (job) {
              const duration = Date.now() - job.startTime;
              this.performanceStats.totalProcessed++;
              this.performanceStats.totalTime += duration;
              this.activeJobs.delete(id);
              this.processNextInQueue(availableWorkerIndex);
            }
          }
        };
        
        worker.addEventListener('message', messageHandler);
        worker.postMessage({
          type: 'COUNT_TOKENS',
          id,
          payload: { text }
        });
        
        // Timeout fallback
        setTimeout(() => {
          if (this.activeJobs.has(id)) {
            worker.removeEventListener('message', messageHandler);
            this.activeJobs.delete(id);
            resolve(estimateTokenCount(text));
          }
        }, 5000);
      } else {
        // Queue for later processing
        this.queue.push({ id, text, resolve, reject });
      }
    });
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
    // For small batches, process in parallel
    if (texts.length <= this.poolSize * 2) {
      return Promise.all(texts.map(text => this.countTokens(text)));
    }
    
    // For large batches, chunk and process
    const chunkSize = Math.ceil(texts.length / this.poolSize);
    const chunks: string[][] = [];
    
    for (let i = 0; i < texts.length; i += chunkSize) {
      chunks.push(texts.slice(i, i + chunkSize));
    }
    
    const chunkResults = await Promise.all(
      chunks.map(chunk => Promise.all(chunk.map(text => this.countTokens(text))))
    );
    
    return chunkResults.flat();
  }
  
  // Memory management
  monitorWorkerMemory() {
    if ('performance' in self && 'measureUserAgentSpecificMemory' in performance) {
      // Periodic memory monitoring
      setInterval(async () => {
        try {
          const memory = await (performance as any).measureUserAgentSpecificMemory();
          console.log('Worker pool memory usage:', memory);
          
          // Recycle workers if memory usage is high
          if (memory.bytes > 500 * 1024 * 1024) { // 500MB threshold
            this.recycleWorkers();
          }
        } catch (error) {
          // Memory API might not be available
        }
      }, 30000); // Check every 30 seconds
    }
  }
  
  private async recycleWorkers() {
    // Wait for active jobs to complete
    while (this.activeJobs.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Terminate and recreate workers
    this.terminate();
    this.workers = [];
    this.workerStatus = [];
    this.isTerminated = false;
    await this.initializeWorkers();
  }
  
  getPerformanceStats() {
    return {
      ...this.performanceStats,
      averageTime: this.performanceStats.totalProcessed > 0 
        ? this.performanceStats.totalTime / this.performanceStats.totalProcessed 
        : 0,
      successRate: this.performanceStats.totalProcessed > 0
        ? (this.performanceStats.totalProcessed - this.performanceStats.failureCount) / this.performanceStats.totalProcessed
        : 0
    };
  }
  
  terminate() {
    this.isTerminated = true;
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.queue = [];
    this.activeJobs.clear();
  }
}
```

#### C. Integration Hook (`src/hooks/use-token-counter.ts`)
```typescript
import { useEffect, useRef, useCallback } from 'react';
import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';

export function useTokenCounter() {
  const workerPoolRef = useRef<TokenWorkerPool>();
  const fallbackCountRef = useRef(0);
  
  useEffect(() => {
    // Initialize worker pool
    workerPoolRef.current = new TokenWorkerPool();
    
    // Start memory monitoring
    workerPoolRef.current.monitorWorkerMemory();
    
    // Cleanup on unmount
    return () => {
      workerPoolRef.current?.terminate();
    };
  }, []);
  
  const countTokens = useCallback(async (text: string): Promise<number> => {
    try {
      const count = await workerPoolRef.current?.countTokens(text);
      if (count !== undefined) {
        fallbackCountRef.current = 0; // Reset fallback counter
        return count;
      }
    } catch (error) {
      console.warn('Token counting error:', error);
      fallbackCountRef.current++;
      
      // If too many failures, recreate the pool
      if (fallbackCountRef.current > 10) {
        workerPoolRef.current?.terminate();
        workerPoolRef.current = new TokenWorkerPool();
        fallbackCountRef.current = 0;
      }
    }
    
    // Fallback to estimation
    return estimateTokenCount(text);
  }, []);
  
  const countTokensBatch = useCallback(async (texts: string[]): Promise<number[]> => {
    try {
      const counts = await workerPoolRef.current?.countTokensBatch(texts);
      if (counts) return counts;
    } catch (error) {
      console.warn('Batch token counting error:', error);
    }
    
    // Fallback to estimation
    return texts.map(text => estimateTokenCount(text));
  }, []);
  
  const getPerformanceStats = useCallback(() => {
    return workerPoolRef.current?.getPerformanceStats() ?? {
      totalProcessed: 0,
      totalTime: 0,
      failureCount: 0,
      averageTime: 0,
      successRate: 0
    };
  }, []);
  
  return { 
    countTokens, 
    countTokensBatch, 
    getPerformanceStats,
    isReady: !!workerPoolRef.current 
  };
}
```

### 3. Integration with Existing Systems

#### A. Enhanced File Cache Integration
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

#### B. IPC Handler Updates
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

### 4. Build Configuration

#### A. Vite Configuration Updates
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
  worker: {
    format: 'es',
    plugins: [wasm(), topLevelAwait()]
  },
  optimizeDeps: {
    exclude: ['tiktoken'],
    include: ['tiktoken/lite']
  },
  build: {
    rollupOptions: {
      output: {
        // Ensure workers are properly bundled
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/wasm/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
```

#### B. Package.json Dependencies
```json
{
  "devDependencies": {
    "vite-plugin-wasm": "^3.3.0",
    "vite-plugin-top-level-await": "^1.4.1"
  }
}
```

#### C. Electron Builder Configuration
```javascript
// electron-builder.config.js updates
{
  "build": {
    "asarUnpack": [
      "node_modules/tiktoken/**/*",
      "dist/assets/wasm/**/*"
    ],
    "files": [
      "dist/**/*",
      "dist/assets/wasm/**/*",
      "main.js",
      "preload.js"
    ]
  }
}
```

### 5. Electron-Specific Considerations

#### A. Content Security Policy
```javascript
// main.js - Update CSP for workers and WASM
const cspHeader = `
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval' blob:;
  worker-src 'self' blob:;
  connect-src 'self';
`;
```

#### B. Worker Script Loading in Production
```typescript
// src/utils/worker-loader.ts
export function getWorkerUrl(): string {
  if (import.meta.env.PROD) {
    // In production, workers are bundled
    return new URL('../workers/token-counter-worker.ts', import.meta.url).href;
  } else {
    // In development, use direct import
    return new URL('../workers/token-counter-worker.ts', import.meta.url).href;
  }
}
```

### 6. Migration Strategy

#### Phase 1: Infrastructure Setup (2-3 days)
1. Install required dependencies (vite-plugin-wasm, vite-plugin-top-level-await)
2. Configure Vite for Web Workers and WASM support
3. Create token-counter-worker.ts with tiktoken/lite imports
4. Implement TokenWorkerPool class with proper error handling
5. Create useTokenCounter hook

#### Phase 2: Core Implementation (3-4 days)
1. Port sanitization functions to workers
2. Implement proper encoder initialization with o200k_base
3. Add batch processing optimization
4. Implement memory monitoring and worker recycling
5. Add performance tracking

#### Phase 3: Integration (2-3 days)
1. Integrate useTokenCounter into useAppState
2. Update loadFileContent to use worker-based counting
3. Modify IPC handlers to remove main process token counting
4. Update enhancedFileContentCache integration
5. Add progress indicators for long operations

#### Phase 4: Testing & Optimization (3-4 days)
1. Unit tests for worker functionality
2. Integration tests with file selection workflow
3. Performance benchmarking against current implementation
4. Memory leak testing
5. Cross-platform compatibility testing
6. Documentation updates

#### Phase 5: Production Readiness (2-3 days)
1. Update electron-builder configuration
2. Test WASM bundling in production builds
3. Implement feature flags for gradual rollout
4. Add monitoring and metrics collection
5. Create rollback procedures

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
});
```

### Integration Tests
```typescript
// src/__tests__/file-selection-with-workers.test.tsx
describe('File selection with worker-based token counting', () => {
  it('should maintain UI responsiveness during large file processing', async () => {
    // Test that UI remains at 60fps during token counting
  });
  
  it('should handle concurrent file selections', async () => {
    // Test multiple files being selected rapidly
  });
  
  it('should integrate with file cache properly', async () => {
    // Test that cached files skip redundant token counting
  });
});
```

### E2E Tests
```typescript
// e2e/token-counting-performance.test.ts
describe('Token counting performance', () => {
  it('should process large repository without UI freezing', async () => {
    // Load a large codebase
    // Verify smooth scrolling during processing
    // Check that token counts are accurate
  });
  
  it('should handle worker failures in production build', async () => {
    // Test fallback mechanisms in packaged app
  });
});
```

### Cross-Platform Testing
- Windows: Test WASM loading in packaged app
- macOS: Verify worker performance on ARM64
- Linux: Test with different glibc versions

## Performance Targets

1. **UI Responsiveness**
   - Main thread blocking: <16ms (60fps maintained)
   - Token counting latency: <100ms for files under 100KB
   - Batch processing: Linear scaling with worker count
   - Worker initialization: <500ms on first use

2. **Resource Usage**
   - Memory per worker: <50MB baseline, <100MB peak
   - CPU usage: Distributed across available cores
   - Worker pool size: 2-8 workers based on hardware
   - Cache hit rate: >80% for repeated file access

3. **Benchmarks**
   - 1MB file: <300ms (vs current ~1000ms blocking)
   - 100 files batch: <1.5s with 4 workers
   - UI freeze reduction: >70% improvement
   - Fallback performance: <50ms for estimation

## Security Considerations

1. **Input Validation**
   - Maximum file size: 10MB per file
   - Text sanitization before processing
   - Queue size limits to prevent memory exhaustion

2. **Worker Isolation**
   - No file system access in workers
   - No network access in workers
   - Input/output validation at boundaries

3. **Content Security Policy**
   - Updated CSP for worker-src and WASM
   - Blob URLs properly configured
   - No eval() or unsafe practices

## Monitoring and Metrics

1. **Performance Metrics**
   - Token counting duration per file size
   - Worker utilization rates
   - Queue depth over time
   - Fallback usage frequency

2. **Error Tracking**
   - Worker initialization failures
   - WASM loading errors
   - Token counting timeouts
   - Memory pressure events

3. **User Experience Metrics**
   - Frame rate during processing
   - Time to first token count
   - Perceived responsiveness scores

## Rollback Plan

1. **Feature Flags**
   ```typescript
   const ENABLE_WORKER_TOKEN_COUNTING = 
     localStorage.getItem('enable-worker-tokens') !== 'false';
   ```

2. **Automatic Fallback**
   - Detect worker failures and switch to estimation
   - Monitor success rates and auto-disable if <90%

3. **Manual Override**
   - Settings option to disable workers
   - Command-line flag for troubleshooting

## Success Criteria

1. **Performance**
   - ✓ 70% reduction in UI freeze time
   - ✓ 60fps maintained during processing
   - ✓ Sub-second response for typical files

2. **Reliability**
   - ✓ <0.1% worker failure rate
   - ✓ 100% fallback success rate
   - ✓ No memory leaks in 24h operation

3. **User Experience**
   - ✓ Smooth file selection
   - ✓ Real-time token count updates
   - ✓ Clear progress indication
   - ✓ No regression in accuracy

## Implementation Checklist

### Pre-Implementation
- [ ] Create proof-of-concept with tiktoken/lite in web worker
- [ ] Verify WASM loading in Electron renderer
- [ ] Performance baseline measurement
- [ ] Design review and approval

### Implementation
- [ ] Install required dependencies
- [ ] Configure Vite for workers and WASM
- [ ] Implement token-counter-worker.ts
- [ ] Create TokenWorkerPool class
- [ ] Develop useTokenCounter hook
- [ ] Integrate with useAppState
- [ ] Update file loading flow
- [ ] Add progress indicators
- [ ] Implement monitoring

### Testing
- [ ] Unit tests for all components
- [ ] Integration tests with file system
- [ ] E2E performance tests
- [ ] Cross-platform compatibility
- [ ] Memory leak testing
- [ ] Production build verification

### Deployment
- [ ] Update build configuration
- [ ] Document configuration options
- [ ] Create troubleshooting guide
- [ ] Deploy with feature flag
- [ ] Monitor metrics for 1 week
- [ ] Gradual rollout to all users

## Conclusion

This enhanced implementation plan addresses all identified issues from the initial review. By using the correct tiktoken/lite imports, proper Vite configuration, and comprehensive error handling, we can successfully implement Web Workers for token counting while maintaining reliability and performance. The architecture includes proper fallbacks, monitoring, and gradual rollout capabilities to ensure a smooth transition for users.