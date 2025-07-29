# Web Workers for Token Counting - Implementation Plan

## Executive Summary

This document outlines the implementation plan for moving token counting operations to Web Workers in PasteFlow. The goal is to prevent UI freezing during large file processing by offloading the computationally expensive tiktoken operations to background threads, targeting a 50% reduction in UI freeze time.

## Current State Analysis

### Current Implementation
1. **Main Process Token Counting** (`main.js:334-358`)
   - Uses tiktoken with o200k_base encoding (GPT-4o)
   - Synchronous operation that blocks the main process
   - Falls back to character-based estimation (4 chars/token) on failure
   - Includes text sanitization to handle problematic tokens

2. **Renderer Process Estimation** (`src/utils/token-utils.ts`)
   - Simple character-based estimation only
   - No actual tiktoken usage in renderer
   - Used for real-time UI updates before accurate counts arrive

3. **Performance Bottlenecks**
   - Synchronous tiktoken.encode() blocks the main process
   - Large files (>1MB) cause noticeable UI freezes
   - Batch file selection compounds the blocking issue
   - No concurrency for multiple file token counting

## Proposed Architecture

### 1. Web Worker Strategy for Electron Renderer

Since Electron's renderer process supports Web Workers (unlike Node.js Worker Threads), we'll implement:

```
Renderer Process                    Web Worker Pool
┌─────────────────┐                ┌─────────────────┐
│                 │   postMessage   │                 │
│  useAppState    ├───────────────>│ Token Counter   │
│                 │                 │   Worker 1      │
│                 │<───────────────┤                 │
│                 │   onmessage     └─────────────────┘
│                 │                 ┌─────────────────┐
│ File Selection  ├───────────────>│ Token Counter   │
│     State       │                 │   Worker 2      │
│                 │<───────────────┤                 │
└─────────────────┘                 └─────────────────┘
```

### 2. Implementation Components

#### A. Token Worker Module (`src/workers/token-worker.ts`)
```typescript
// Web Worker script that will run tiktoken
import init, { Tiktoken } from 'tiktoken/web';

let encoder: Tiktoken | null = null;

self.onmessage = async (event) => {
  const { type, payload, id } = event.data;
  
  switch (type) {
    case 'INIT':
      await initializeEncoder();
      break;
    case 'COUNT_TOKENS':
      const count = await countTokens(payload.text);
      self.postMessage({ type: 'TOKEN_COUNT', id, result: count });
      break;
    case 'BATCH_COUNT':
      const results = await batchCountTokens(payload.texts);
      self.postMessage({ type: 'BATCH_RESULT', id, results });
      break;
  }
};
```

#### B. Worker Pool Manager (`src/utils/worker-pool.ts`)
```typescript
export class TokenWorkerPool {
  private workers: Worker[] = [];
  private queue: QueueItem[] = [];
  private activeJobs = new Map<string, ActiveJob>();
  
  constructor(poolSize = navigator.hardwareConcurrency || 4) {
    this.initializeWorkers(poolSize);
  }
  
  async countTokens(text: string): Promise<number> {
    // Queue management and worker assignment
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
    // Distribute batch across workers
  }
}
```

#### C. Integration Hook (`src/hooks/use-token-counter.ts`)
```typescript
export function useTokenCounter() {
  const workerPoolRef = useRef<TokenWorkerPool>();
  
  useEffect(() => {
    workerPoolRef.current = new TokenWorkerPool();
    return () => workerPoolRef.current?.terminate();
  }, []);
  
  const countTokens = useCallback(async (text: string) => {
    return workerPoolRef.current?.countTokens(text) ?? estimateTokenCount(text);
  }, []);
  
  return { countTokens, countTokensBatch };
}
```

### 3. Migration Strategy

#### Phase 1: Infrastructure Setup (2-3 days)
1. Configure Vite to support Web Workers
2. Create tiktoken Web Worker bundle
3. Implement basic worker pool infrastructure
4. Add worker lifecycle management

#### Phase 2: Core Implementation (3-4 days)
1. Implement token counting in workers
2. Create queue management system
3. Add graceful fallback mechanisms
4. Implement batch processing optimization

#### Phase 3: Integration (2-3 days)
1. Replace synchronous token counting in `loadFileContent`
2. Update `useAppState` to use worker pool
3. Maintain backward compatibility
4. Add progress indicators for long operations

#### Phase 4: Optimization & Testing (2-3 days)
1. Performance benchmarking
2. Memory leak testing
3. Error handling improvements
4. Documentation updates

## Technical Considerations

### 1. Vite Configuration Updates
```typescript
// vite-config.ts
export default defineConfig({
  // ... existing config
  worker: {
    format: 'es',
    plugins: [/* tiktoken wasm plugin */]
  },
  optimizeDeps: {
    exclude: ['tiktoken'] // Prevent pre-bundling
  }
});
```

### 2. Tiktoken in Web Workers
- Use tiktoken's web-compatible build
- Handle WASM initialization properly
- Implement proper error boundaries
- Cache encoder instances per worker

### 3. Memory Management
- Worker pool size based on hardware (max 4-8 workers)
- Implement worker recycling for long-running sessions
- Clear text data after processing
- Monitor memory usage and implement limits

### 4. Error Handling & Fallbacks
```typescript
try {
  const count = await workerPool.countTokens(content);
  return count;
} catch (error) {
  console.warn('Worker token counting failed, using fallback', error);
  return estimateTokenCount(content);
}
```

### 5. Progress Reporting
- Implement progress callbacks for large batches
- Show loading states in UI
- Cancel support for long operations

## Performance Targets

1. **UI Responsiveness**
   - Main thread blocking: <16ms (60fps maintained)
   - Token counting latency: <100ms for files under 100KB
   - Batch processing: Linear scaling with worker count

2. **Resource Usage**
   - Memory per worker: <50MB
   - CPU usage: Distributed across cores
   - Worker startup time: <200ms

3. **Benchmarks**
   - 1MB file: <500ms (vs current ~1000ms blocking)
   - 100 files batch: <2s (with 4 workers)
   - UI freeze reduction: >50% improvement

## Testing Strategy

### Unit Tests
- Worker initialization and termination
- Token counting accuracy
- Queue management logic
- Error handling paths

### Integration Tests
- File selection workflow with workers
- Concurrent operations handling
- Memory leak detection
- Performance regression tests

### E2E Tests
- Large repository processing
- UI responsiveness during token counting
- Cancel operation functionality
- Fallback mechanism verification

## Security Considerations

1. **Worker Isolation**
   - Workers have no file system access
   - Only process text data, no file paths
   - Implement input size limits

2. **Content Sanitization**
   - Maintain existing sanitization logic
   - Validate input before sending to workers
   - Prevent DOS through large inputs

## Rollback Plan

1. Feature flag for worker-based counting
2. Automatic fallback on worker failure
3. Metrics collection for success rates
4. Easy revert through configuration

## Success Metrics

1. **Performance**
   - 50% reduction in UI freeze time ✓
   - 60fps maintained during processing ✓
   - Sub-second response for typical files ✓

2. **Reliability**
   - <0.1% worker failure rate
   - 100% fallback success rate
   - No memory leaks in 24h operation

3. **User Experience**
   - Smooth file selection
   - Real-time token count updates
   - Clear progress indication

## Implementation Timeline

- **Week 1**: Infrastructure and basic implementation
- **Week 2**: Integration and optimization
- **Week 3**: Testing and refinement
- **Week 4**: Documentation and deployment

## Conclusion

Implementing Web Workers for token counting will significantly improve PasteFlow's performance and user experience. The architecture is designed to be robust, with proper fallbacks and progressive enhancement, ensuring the application remains functional even if workers fail.