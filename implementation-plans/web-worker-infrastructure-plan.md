# Web Worker Infrastructure Plan for Token Counting

## Executive Summary

This document outlines the implementation plan for the core Web Worker infrastructure to handle token counting operations in PasteFlow. The focus is on creating a robust worker pool system that offloads computationally expensive tiktoken operations to background threads, preventing UI freezing during large file processing.

## Current State Context

### Current Token Counting Implementation
- **Main Process**: Synchronous tiktoken operations in `main.js:334-358` block the main process
- **Renderer Process**: Only simple character-based estimation (`src/utils/token-utils.ts`)
- **Performance Issue**: Large files (>1MB) cause noticeable UI freezes
- **No Concurrency**: Sequential processing compounds the blocking issue

### Technical Constraints
- Must work within Electron's renderer process security model
- Requires WASM support for tiktoken operations
- Need to maintain fallback to character-based estimation
- Must integrate with existing file content caching system

## Core Architecture

### Web Worker Pool Design

```
Renderer Process                    Web Worker Pool
┌─────────────────┐                ┌─────────────────┐
│                 │   postMessage   │                 │
│  TokenWorkerPool├───────────────>│ Token Counter   │
│   Management    │                 │   Worker 1      │
│                 │<───────────────┤                 │
│                 │   onmessage     └─────────────────┘
│                 │                 ┌─────────────────┐
│   Queue &      ├───────────────>│ Token Counter   │
│   Scheduling   │                 │   Worker 2-N    │
│                 │<───────────────┤                 │
└─────────────────┘                 └─────────────────┘
```

## Implementation Components

### 1. Token Counter Worker (`src/workers/token-counter-worker.ts`)

This is the core worker script that handles actual token counting:

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

Key features:
- **Tiktoken/lite imports**: Uses the lightweight version suitable for browsers
- **Text sanitization**: Ports the exact logic from main process
- **Error handling**: Graceful fallback on initialization failure
- **Security**: Input size validation to prevent memory exhaustion
- **Health monitoring**: Supports health checks for pool management

### 2. Worker Pool Manager (`src/utils/token-worker-pool.ts`)

The pool manager handles worker lifecycle, job scheduling, and performance optimization:

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

Key features:
- **Dynamic pool sizing**: Adjusts based on hardware capabilities
- **Queue management**: Handles job scheduling and distribution
- **Performance tracking**: Monitors processing time and success rates
- **Memory management**: Automatic worker recycling on high memory usage
- **Graceful degradation**: Falls back to estimation when workers unavailable

### 3. React Hook Interface (`src/hooks/use-token-counter.ts`)

Provides a clean React integration for the worker pool:

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

## Build Configuration Requirements

### Vite Configuration (`vite.config.ts`)

```typescript
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

### Required Dependencies

```json
{
  "devDependencies": {
    "vite-plugin-wasm": "^3.3.0",
    "vite-plugin-top-level-await": "^1.4.1"
  }
}
```

### Electron-Specific Requirements

#### Content Security Policy Updates
```javascript
// main.js - Update CSP for workers and WASM
const cspHeader = `
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval' blob:;
  worker-src 'self' blob:;
  connect-src 'self';
`;
```

#### Worker Script Loading Helper
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

## Performance Characteristics

### Expected Performance
- **Worker initialization**: <500ms on first use
- **Token counting latency**: <100ms for files under 100KB
- **Batch processing**: Linear scaling with worker count
- **Memory per worker**: <50MB baseline, <100MB peak

### Resource Management
- **CPU usage**: Distributed across available cores
- **Worker pool size**: 2-8 workers based on hardware
- **Queue management**: FIFO with priority for smaller files
- **Memory recycling**: Automatic at 500MB threshold

### Fallback Behavior
- **No worker support**: Character-based estimation (4 chars/token)
- **Worker failure**: Automatic fallback with retry logic
- **Timeout handling**: 5-second timeout per operation
- **Pool recreation**: After 10 consecutive failures

## Security Considerations

### Input Validation
- Maximum file size: 10MB per file
- Text sanitization before processing
- Queue size limits to prevent memory exhaustion

### Worker Isolation
- No file system access in workers
- No network access in workers
- Input/output validation at boundaries
- Sandboxed execution environment

### Content Security Policy
- Updated CSP for worker-src and WASM
- Blob URLs properly configured
- No eval() or unsafe practices

## Summary

This Web Worker infrastructure provides a robust foundation for offloading token counting operations from the main thread. The implementation includes:

1. **Core worker implementation** with tiktoken/lite for browser compatibility
2. **Intelligent pool management** with dynamic sizing and job scheduling
3. **React integration** through a custom hook
4. **Comprehensive error handling** and fallback mechanisms
5. **Performance monitoring** and memory management
6. **Security considerations** for safe operation in Electron

The architecture is designed to be resilient, performant, and maintainable, with clear separation of concerns and extensive error handling to ensure a smooth user experience even in failure scenarios.