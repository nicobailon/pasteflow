# Web Worker Token Counting - Comprehensive Test Implementation Plan

## Executive Summary

This enhanced implementation plan addresses the critical need for comprehensive, behavior-driven test coverage for the Web Worker token counting feature. The plan prioritizes fixing existing test violations, implementing missing test coverage, and establishing robust testing patterns that align with TESTING.md guidelines.

## Current State Analysis

### Critical Issues Identified
1. **Placeholder Tests**: `worker-pool-fixes.test.ts` contains only placeholder tests with `expect(true).toBe(true)`
2. **Missing Hook Tests**: `useTokenCounter` hook has no test coverage despite being the primary interface
3. **No Integration Tests**: Missing app state integration and E2E workflow tests
4. **Limited Error Scenarios**: Current tests don't cover all error recovery paths
5. **No Performance Benchmarks**: Missing performance regression detection

### Existing Test Coverage
- ✅ `token-worker-error-recovery.test.ts` - Basic error recovery scenarios
- ❌ `worker-pool-fixes.test.ts` - Placeholder tests only
- ❌ `use-token-counter.test.tsx` - Does not exist
- ❌ Integration tests - None
- ❌ Performance tests - None

## Implementation Phases

### Phase 1: Critical Violations (Day 1-3) 🚨

#### 1.1 Replace Placeholder Tests in worker-pool-fixes.test.ts
**Priority**: CRITICAL - Must be fixed immediately
**Time**: 4-6 hours

```typescript
// src/__tests__/worker-pool-fixes.test.ts

import { TokenWorkerPool } from '../utils/token-worker-pool';
import { MockWorker, createMockWorker } from './test-utils/mock-worker';
import { TEST_CONSTANTS } from './test-constants';

describe('Worker Pool Critical Fixes', () => {
  let pool: TokenWorkerPool;
  let mockWorkers: MockWorker[];
  
  beforeEach(() => {
    jest.useFakeTimers();
    mockWorkers = [];
    
    // Mock Worker constructor to use our MockWorker
    global.Worker = jest.fn().mockImplementation(() => {
      const worker = createMockWorker();
      mockWorkers.push(worker);
      return worker;
    });
    
    pool = new TokenWorkerPool();
  });
  
  afterEach(() => {
    pool.terminate();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Memory Leak Prevention', () => {
    it('should properly clean up event listeners on timeout', async () => {
      const text = 'test content for timeout';
      const messageHandler = jest.fn();
      const errorHandler = jest.fn();
      
      // Get the first worker
      const worker = mockWorkers[0];
      worker.addEventListener = jest.fn();
      worker.removeEventListener = jest.fn();
      
      // Start a request that will timeout
      const promise = pool.countTokens(text);
      
      // Verify listeners were added
      expect(worker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(worker.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
      
      // Advance timers to trigger timeout
      jest.advanceTimersByTime(TEST_CONSTANTS.WORKER_TIMEOUT);
      
      // Wait for promise to resolve with fallback
      const result = await promise;
      
      // Verify cleanup occurred
      expect(worker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
      
      // Verify fallback was used
      expect(result).toBe(Math.ceil(text.length / 4)); // estimateTokenCount formula
    });
    
    it('should clean up listeners on worker error', async () => {
      const text = 'test content for error';
      const worker = mockWorkers[0];
      
      worker.removeEventListener = jest.fn();
      
      // Configure worker to throw error
      worker.postMessage = jest.fn().mockImplementation(() => {
        setTimeout(() => {
          worker.simulateError(new Error('Worker crashed'));
        }, 10);
      });
      
      const promise = pool.countTokens(text);
      
      // Advance timers to trigger error
      jest.advanceTimersByTime(20);
      
      const result = await promise;
      
      // Verify cleanup occurred
      expect(worker.removeEventListener).toHaveBeenCalledTimes(2);
      expect(result).toBe(Math.ceil(text.length / 4)); // Fallback used
    });
  });
  
  describe('Race Condition Prevention', () => {
    it('should handle concurrent updates atomically using Map', async () => {
      const files = [
        { path: 'file1.ts', content: 'const a = 1;' },
        { path: 'file2.ts', content: 'const b = 2;' },
        { path: 'file3.ts', content: 'const c = 3;' }
      ];
      
      // Track state updates
      const stateUpdates: Map<string, number>[] = [];
      
      // Simulate batch processing with atomic updates
      const results = new Map<string, number>();
      
      // Process files concurrently
      const promises = files.map(async (file) => {
        const count = await pool.countTokens(file.content);
        
        // Atomic update using Map
        results.set(file.path, count);
        stateUpdates.push(new Map(results));
        
        return { path: file.path, count };
      });
      
      await Promise.all(promises);
      
      // Verify all updates were atomic and no intermediate states were lost
      expect(results.size).toBe(3);
      expect(stateUpdates.length).toBe(3);
      
      // Each update should have incrementally more entries
      expect(stateUpdates[0].size).toBe(1);
      expect(stateUpdates[1].size).toBe(2);
      expect(stateUpdates[2].size).toBe(3);
    });
  });
  
  describe('Input Size Validation', () => {
    it('should reject texts larger than 10MB before sending to worker', async () => {
      const largeText = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Worker should never receive the message
      const worker = mockWorkers[0];
      worker.postMessage = jest.fn();
      
      const result = await pool.countTokens(largeText);
      
      // Verify worker was never called
      expect(worker.postMessage).not.toHaveBeenCalled();
      
      // Verify estimation was used
      expect(result).toBe(Math.ceil(largeText.length / 4));
      
      consoleSpy.mockRestore();
    });
    
    it('should process texts up to 10MB through workers', async () => {
      const text = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE - 100);
      const worker = mockWorkers[0];
      
      // Configure worker to return a specific count
      worker.simulateMessage({ tokenCount: 1000 });
      
      const result = await pool.countTokens(text);
      
      // Verify worker was called
      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'COUNT_TOKENS',
        payload: { text }
      });
      
      expect(result).toBe(1000);
    });
  });
  
  describe('Queue Management', () => {
    it('should enforce maximum queue size of 1000 requests', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Generate more requests than queue limit
      const requests: Promise<number>[] = [];
      for (let i = 0; i < TEST_CONSTANTS.OVERFLOW_TEST_SIZE; i++) {
        requests.push(pool.countTokens(`text ${i}`));
      }
      
      // Process all requests
      const results = await Promise.all(requests);
      
      // Verify queue limit was enforced
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queue full')
      );
      
      // All requests should still complete (either processed or dropped)
      expect(results.length).toBe(TEST_CONSTANTS.OVERFLOW_TEST_SIZE);
      
      consoleSpy.mockRestore();
    });
    
    it('should drop oldest requests when queue is full', async () => {
      // This test would verify FIFO dropping behavior
      // Implementation depends on internal queue structure
      const timestamps: number[] = [];
      
      // Fill queue to capacity
      for (let i = 0; i < TEST_CONSTANTS.MAX_QUEUE_SIZE; i++) {
        timestamps.push(Date.now());
        pool.countTokens(`request ${i}`);
      }
      
      // Add one more request that should trigger dropping
      const overflowRequest = pool.countTokens('overflow request');
      
      // The oldest request should have been dropped
      // Verify through performance stats or internal state
      const stats = pool.getPerformanceStats();
      expect(stats.droppedRequests).toBeGreaterThan(0);
    });
  });
  
  describe('Worker Health Monitoring', () => {
    it('should detect and recover unhealthy workers', async () => {
      // Make worker unhealthy by not responding
      const worker = mockWorkers[0];
      worker.postMessage = jest.fn(); // Don't send response
      
      // Health check should detect unresponsive worker
      const health = await pool.performHealthCheck();
      
      expect(health.healthy).toBe(false);
      expect(health.unhealthyWorkers).toContain(0);
      
      // Pool should recover by creating new worker
      const newWorkerCount = mockWorkers.length;
      expect(newWorkerCount).toBeGreaterThan(1);
    });
    
    it('should perform periodic health monitoring', () => {
      const healthCheckSpy = jest.spyOn(pool, 'performHealthCheck');
      
      // Advance time to trigger health monitoring
      jest.advanceTimersByTime(TEST_CONSTANTS.HEALTH_CHECK_INTERVAL);
      
      expect(healthCheckSpy).toHaveBeenCalled();
    });
  });
  
  describe('Request Deduplication', () => {
    it('should return same promise for identical concurrent requests', async () => {
      const text = 'duplicate request content';
      
      // Make multiple identical requests
      const promise1 = pool.countTokens(text);
      const promise2 = pool.countTokens(text);
      const promise3 = pool.countTokens(text);
      
      // Should be the same promise instance
      expect(promise1).toBe(promise2);
      expect(promise2).toBe(promise3);
      
      // Worker should only receive one message
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(1);
      
      // All should resolve to same value
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
    
    it('should handle different requests independently', async () => {
      const text1 = 'first request';
      const text2 = 'second request';
      
      const promise1 = pool.countTokens(text1);
      const promise2 = pool.countTokens(text2);
      
      // Should be different promises
      expect(promise1).not.toBe(promise2);
      
      // Worker should receive both messages
      expect(mockWorkers[0].postMessage).toHaveBeenCalledTimes(2);
    });
  });
});
```

#### 1.2 Implement useTokenCounter Hook Tests
**Priority**: CRITICAL - Primary interface needs coverage
**Time**: 6-8 hours

```typescript
// src/__tests__/use-token-counter.test.tsx

import { renderHook, act } from '@testing-library/react';
import { useTokenCounter } from '../hooks/use-token-counter';
import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';
import { TEST_CONSTANTS } from './test-constants';

// Mock dependencies
jest.mock('../utils/token-worker-pool');
jest.mock('../utils/token-utils');

describe('useTokenCounter Hook', () => {
  let mockPool: jest.Mocked<TokenWorkerPool>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock pool
    mockPool = {
      countTokens: jest.fn(),
      terminate: jest.fn(),
      monitorWorkerMemory: jest.fn(),
      getPerformanceStats: jest.fn().mockReturnValue({
        totalProcessed: 0,
        totalTime: 0,
        failureCount: 0,
        averageTime: 0,
        successRate: 0
      })
    } as any;
    
    (TokenWorkerPool as jest.Mock).mockImplementation(() => mockPool);
    (estimateTokenCount as jest.Mock).mockImplementation(text => Math.ceil(text.length / 4));
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Hook Lifecycle', () => {
    it('should initialize worker pool on mount', () => {
      const { result } = renderHook(() => useTokenCounter());
      
      expect(TokenWorkerPool).toHaveBeenCalledTimes(1);
      expect(mockPool.monitorWorkerMemory).toHaveBeenCalledTimes(1);
      expect(result.current.isReady).toBe(true);
    });
    
    it('should terminate worker pool on unmount', () => {
      const { unmount } = renderHook(() => useTokenCounter());
      
      unmount();
      
      expect(mockPool.terminate).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Input Validation', () => {
    it('should use estimation for texts larger than 10MB', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const largeText = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1);
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens(largeText);
      });
      
      // Should not call worker pool
      expect(mockPool.countTokens).not.toHaveBeenCalled();
      
      // Should use estimation
      expect(estimateTokenCount).toHaveBeenCalledWith(largeText);
      expect(tokenCount).toBe(Math.ceil(largeText.length / 4));
    });
    
    it('should handle empty input gracefully', async () => {
      const { result } = renderHook(() => useTokenCounter());
      mockPool.countTokens.mockResolvedValue(0);
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens('');
      });
      
      expect(tokenCount).toBe(0);
    });
    
    it('should validate input types and handle null/undefined', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      // Test with various invalid inputs
      const invalidInputs = [null, undefined, 123, {}, []];
      
      for (const input of invalidInputs) {
        let tokenCount: number = 0;
        await act(async () => {
          // @ts-ignore - Testing invalid inputs
          tokenCount = await result.current.countTokens(input);
        });
        
        // Should handle gracefully and return 0 or use estimation
        expect(tokenCount).toBe(0);
      }
    });
  });
  
  describe('Error Handling', () => {
    it('should fall back to estimation on worker error', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const text = 'test content';
      
      mockPool.countTokens.mockRejectedValue(new Error('Worker failed'));
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens(text);
      });
      
      expect(estimateTokenCount).toHaveBeenCalledWith(text);
      expect(tokenCount).toBe(Math.ceil(text.length / 4));
    });
    
    it('should recreate pool after repeated failures', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      mockPool.countTokens.mockRejectedValue(new Error('Worker failed'));
      
      // Trigger 11 failures to exceed threshold
      for (let i = 0; i < 11; i++) {
        await act(async () => {
          await result.current.countTokens(`test ${i}`);
        });
      }
      
      // Pool should be recreated
      expect(mockPool.terminate).toHaveBeenCalled();
      expect(TokenWorkerPool).toHaveBeenCalledTimes(2); // Initial + recreation
    });
    
    it('should provide meaningful error context', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      mockPool.countTokens.mockRejectedValue(new Error('Specific error'));
      
      await act(async () => {
        await result.current.countTokens('test');
      });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Token counting error:',
        expect.objectContaining({ message: 'Specific error' })
      );
      
      consoleSpy.mockRestore();
    });
  });
  
  describe('Batch Processing', () => {
    it('should process multiple texts efficiently', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = ['text1', 'text2', 'text3'];
      
      mockPool.countTokens
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(30);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      expect(results).toEqual([10, 20, 30]);
      expect(mockPool.countTokens).toHaveBeenCalledTimes(3);
    });
    
    it('should handle mixed valid and oversized texts in batch', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = [
        'small text',
        'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1), // Too large
        'another small text'
      ];
      
      mockPool.countTokens
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(30); // Skip the large one
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      // Should use worker for small texts, estimation for large
      expect(mockPool.countTokens).toHaveBeenCalledTimes(2);
      expect(estimateTokenCount).toHaveBeenCalledWith(texts[1]);
      expect(results.length).toBe(3);
    });
    
    it('should handle partial batch failures gracefully', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = ['text1', 'text2', 'text3'];
      
      mockPool.countTokens
        .mockResolvedValueOnce(10)
        .mockRejectedValueOnce(new Error('Worker failed'))
        .mockResolvedValueOnce(30);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      // Should have results for all, with estimation for failed one
      expect(results.length).toBe(3);
      expect(results[0]).toBe(10);
      expect(results[1]).toBe(Math.ceil(texts[1].length / 4)); // Estimation
      expect(results[2]).toBe(30);
    });
  });
  
  describe('Performance Monitoring', () => {
    it('should expose performance statistics', () => {
      const { result } = renderHook(() => useTokenCounter());
      
      const mockStats = {
        totalProcessed: 100,
        totalTime: 5000,
        failureCount: 2,
        averageTime: 50,
        successRate: 0.98
      };
      
      mockPool.getPerformanceStats.mockReturnValue(mockStats);
      
      const stats = result.current.getPerformanceStats();
      
      expect(stats).toEqual(mockStats);
    });
    
    it('should return default stats when pool not initialized', () => {
      (TokenWorkerPool as jest.Mock).mockImplementation(() => null);
      
      const { result } = renderHook(() => useTokenCounter());
      
      const stats = result.current.getPerformanceStats();
      
      expect(stats).toEqual({
        totalProcessed: 0,
        totalTime: 0,
        failureCount: 0,
        averageTime: 0,
        successRate: 0
      });
    });
  });
  
  describe('Feature Flag Integration', () => {
    it('should respect disabled worker feature flag', async () => {
      // Mock feature flag check
      const originalEnv = process.env.DISABLE_WEB_WORKERS;
      process.env.DISABLE_WEB_WORKERS = 'true';
      
      const { result } = renderHook(() => useTokenCounter());
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens('test');
      });
      
      // Should use estimation when workers disabled
      expect(mockPool.countTokens).not.toHaveBeenCalled();
      expect(estimateTokenCount).toHaveBeenCalled();
      
      process.env.DISABLE_WEB_WORKERS = originalEnv;
    });
  });
});
```

### Phase 2: Test Infrastructure (Day 4-5)

#### 2.1 Create Shared Test Utilities
**Time**: 2-3 hours

```typescript
// src/__tests__/test-utils/mock-worker.ts

export interface MockWorkerOptions {
  autoRespond?: boolean;
  responseDelay?: number;
  errorOnMessage?: boolean;
  crashAfterMessages?: number;
}

export class MockWorker {
  private messageHandlers: ((event: MessageEvent) => void)[] = [];
  private errorHandlers: ((event: ErrorEvent) => void)[] = [];
  private messageCount = 0;
  
  constructor(private options: MockWorkerOptions = {}) {}
  
  addEventListener(event: string, handler: Function) {
    if (event === 'message') {
      this.messageHandlers.push(handler as any);
    } else if (event === 'error') {
      this.errorHandlers.push(handler as any);
    }
  }
  
  removeEventListener(event: string, handler: Function) {
    if (event === 'message') {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    } else if (event === 'error') {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    }
  }
  
  postMessage(data: any) {
    this.messageCount++;
    
    if (this.options.crashAfterMessages && this.messageCount >= this.options.crashAfterMessages) {
      this.simulateError(new Error('Worker crashed'));
      return;
    }
    
    if (this.options.errorOnMessage) {
      this.simulateError(new Error('Worker error'));
      return;
    }
    
    if (this.options.autoRespond) {
      setTimeout(() => {
        this.simulateMessage({ tokenCount: Math.floor(Math.random() * 1000) });
      }, this.options.responseDelay || 0);
    }
  }
  
  simulateMessage(data: any) {
    const event = new MessageEvent('message', { data });
    this.messageHandlers.forEach(handler => handler(event));
  }
  
  simulateError(error: Error) {
    const event = new ErrorEvent('error', { error });
    this.errorHandlers.forEach(handler => handler(event));
  }
  
  terminate() {
    this.messageHandlers = [];
    this.errorHandlers = [];
  }
}

export const createMockWorker = (options?: MockWorkerOptions) => new MockWorker(options);

export const createCrashingWorker = () => createMockWorker({ 
  crashAfterMessages: 1 
});

export const createSlowWorker = (delay: number) => createMockWorker({ 
  autoRespond: true, 
  responseDelay: delay 
});

export const createFailingWorker = () => createMockWorker({ 
  errorOnMessage: true 
});
```

```typescript
// src/__tests__/test-constants.ts

export const TEST_CONSTANTS = {
  // Size limits
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB - Worker processing limit
  LARGE_FILE_SIZE: 2 * 1024 * 1024, // 2MB - For stress testing
  MEDIUM_FILE_SIZE: 500 * 1024, // 500KB
  SMALL_FILE_SIZE: 10 * 1024, // 10KB
  
  // Performance targets
  MAX_PROCESSING_TIME_1MB: 500, // 500ms target for 1MB files
  MAX_PROCESSING_TIME_100KB: 50, // 50ms for 100KB files
  WORKER_TIMEOUT: 5000, // 5 second timeout
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  
  // Queue limits
  MAX_QUEUE_SIZE: 1000, // Maximum pending requests
  OVERFLOW_TEST_SIZE: 1010, // Just over queue limit
  BATCH_SIZE: 50, // Typical batch size
  
  // Memory constraints
  MAX_WORKER_MEMORY: 100 * 1024 * 1024, // 100MB per worker
  MEMORY_WARNING_THRESHOLD: 80 * 1024 * 1024, // 80MB warning
  
  // Worker pool settings
  MIN_WORKERS: 1,
  MAX_WORKERS: navigator.hardwareConcurrency || 4,
  
  // Test data
  SAMPLE_TEXT: 'The quick brown fox jumps over the lazy dog',
  SAMPLE_CODE: `
    function fibonacci(n: number): number {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
  `,
  SAMPLE_JSON: JSON.stringify({ key: 'value', nested: { array: [1, 2, 3] } }),
  
  // Token counts for known inputs (tiktoken cl100k_base)
  KNOWN_TOKEN_COUNTS: {
    'Hello, world!': 4,
    'The quick brown fox jumps over the lazy dog': 9,
    '': 0,
    ' ': 1,
    '\\n': 1,
    '😀': 1,
  },
  
  // Timing tolerances
  TIMING_TOLERANCE: 50, // 50ms tolerance for timing assertions
  
  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 100,
} as const;

// Test data generators
export const generateText = (size: number): string => {
  const chunk = TEST_CONSTANTS.SAMPLE_TEXT;
  const chunkSize = chunk.length;
  const repeats = Math.ceil(size / chunkSize);
  return chunk.repeat(repeats).substring(0, size);
};

export const generateCode = (size: number): string => {
  const base = TEST_CONSTANTS.SAMPLE_CODE;
  const functions: string[] = [];
  let currentSize = 0;
  let index = 0;
  
  while (currentSize < size) {
    functions.push(`
      function generatedFunction${index}() {
        ${base}
      }
    `);
    currentSize += base.length + 50;
    index++;
  }
  
  return functions.join('\\n').substring(0, size);
};
```

### Phase 3: Integration Testing (Day 6-8)

#### 3.1 App State Integration Tests

```typescript
// src/__tests__/integration/token-counter-app-state.test.tsx

import { renderHook, act } from '@testing-library/react';
import { useAppState } from '../../hooks/use-app-state';
import { useTokenCounter } from '../../hooks/use-token-counter';
import { TEST_CONSTANTS, generateText } from '../test-constants';

describe('Token Counter + App State Integration', () => {
  it('should atomically update file token counts in app state', async () => {
    const { result: appStateResult } = renderHook(() => useAppState());
    const { result: tokenCounterResult } = renderHook(() => useTokenCounter());
    
    // Select multiple files
    await act(async () => {
      appStateResult.current.toggleFileSelection({
        path: 'file1.ts',
        content: generateText(1000),
        isDirectory: false,
        size: 1000,
        isBinary: false,
        name: 'file1.ts'
      });
      
      appStateResult.current.toggleFileSelection({
        path: 'file2.ts',
        content: generateText(2000),
        isDirectory: false,
        size: 2000,
        isBinary: false,
        name: 'file2.ts'
      });
    });
    
    // Count tokens for all selected files
    await act(async () => {
      const promises = appStateResult.current.selectedFiles.map(async (file) => {
        if (file.content) {
          const count = await tokenCounterResult.current.countTokens(file.content);
          appStateResult.current.updateFileTokenCount(file.path, count);
        }
      });
      
      await Promise.all(promises);
    });
    
    // Verify atomic updates
    const { selectedFiles } = appStateResult.current;
    expect(selectedFiles).toHaveLength(2);
    expect(selectedFiles[0].tokenCount).toBeGreaterThan(0);
    expect(selectedFiles[1].tokenCount).toBeGreaterThan(0);
    
    // Verify consistency
    expect(selectedFiles[0].tokenCount).toBeLessThan(selectedFiles[1].tokenCount);
  });
  
  it('should handle race conditions during concurrent updates', async () => {
    const { result: appStateResult } = renderHook(() => useAppState());
    const { result: tokenCounterResult } = renderHook(() => useTokenCounter());
    
    // Create 10 files
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `file${i}.ts`,
      content: generateText(1000 * (i + 1)),
      isDirectory: false,
      size: 1000 * (i + 1),
      isBinary: false,
      name: `file${i}.ts`
    }));
    
    // Select all files
    await act(async () => {
      files.forEach(file => appStateResult.current.toggleFileSelection(file));
    });
    
    // Count tokens concurrently
    const updatePromises: Promise<void>[] = [];
    
    await act(async () => {
      files.forEach((file, index) => {
        const promise = tokenCounterResult.current.countTokens(file.content).then(count => {
          // Simulate random delays
          return new Promise<void>(resolve => {
            setTimeout(() => {
              appStateResult.current.updateFileTokenCount(file.path, count);
              resolve();
            }, Math.random() * 100);
          });
        });
        updatePromises.push(promise);
      });
      
      await Promise.all(updatePromises);
    });
    
    // Verify all updates were applied
    const { selectedFiles } = appStateResult.current;
    expect(selectedFiles).toHaveLength(10);
    selectedFiles.forEach(file => {
      expect(file.tokenCount).toBeGreaterThan(0);
    });
  });
  
  it('should propagate errors to UI state appropriately', async () => {
    const { result: appStateResult } = renderHook(() => useAppState());
    const { result: tokenCounterResult } = renderHook(() => useTokenCounter());
    
    // Mock worker failure
    jest.spyOn(tokenCounterResult.current, 'countTokens').mockRejectedValueOnce(
      new Error('Worker pool exhausted')
    );
    
    const file = {
      path: 'error-file.ts',
      content: 'This will fail',
      isDirectory: false,
      size: 100,
      isBinary: false,
      name: 'error-file.ts'
    };
    
    await act(async () => {
      appStateResult.current.toggleFileSelection(file);
      
      try {
        await tokenCounterResult.current.countTokens(file.content);
      } catch (error) {
        // Error should be handled gracefully
        appStateResult.current.setError('Failed to count tokens: Worker pool exhausted');
      }
    });
    
    // Verify error state
    expect(appStateResult.current.error).toBe('Failed to count tokens: Worker pool exhausted');
  });
});
```

#### 3.2 End-to-End Workflow Tests

```typescript
// src/__tests__/e2e/token-counting-workflow.test.tsx

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { App } from '../../App';
import { TEST_CONSTANTS } from '../test-constants';

// Mock electron API
global.window.electronAPI = {
  selectFolder: jest.fn(),
  readFile: jest.fn(),
  getDirectoryContents: jest.fn(),
  // ... other methods
};

describe('Token Counting E2E Workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should complete full workflow from folder selection to token display', async () => {
    // Mock folder selection
    window.electronAPI.selectFolder.mockResolvedValue('/test/project');
    
    // Mock directory contents
    window.electronAPI.getDirectoryContents.mockResolvedValue({
      files: [
        {
          name: 'index.ts',
          path: '/test/project/index.ts',
          isDirectory: false,
          size: 1000,
          isBinary: false
        },
        {
          name: 'utils.ts',
          path: '/test/project/utils.ts',
          isDirectory: false,
          size: 2000,
          isBinary: false
        }
      ]
    });
    
    // Mock file contents
    window.electronAPI.readFile.mockImplementation((path) => {
      if (path === '/test/project/index.ts') {
        return Promise.resolve('export const main = () => console.log("Hello");');
      }
      if (path === '/test/project/utils.ts') {
        return Promise.resolve('export const util = (x: number) => x * 2;');
      }
      return Promise.reject(new Error('File not found'));
    });
    
    render(<App />);
    
    // Step 1: Select folder
    const selectFolderButton = screen.getByText('Select Folder');
    fireEvent.click(selectFolderButton);
    
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument();
      expect(screen.getByText('utils.ts')).toBeInTheDocument();
    });
    
    // Step 2: Select files
    const file1Checkbox = screen.getByRole('checkbox', { name: /index.ts/ });
    const file2Checkbox = screen.getByRole('checkbox', { name: /utils.ts/ });
    
    fireEvent.click(file1Checkbox);
    fireEvent.click(file2Checkbox);
    
    // Step 3: Wait for token counting
    await waitFor(() => {
      const tokenDisplay = screen.getByTestId('total-tokens');
      expect(tokenDisplay).toHaveTextContent(/\\d+ tokens/);
      expect(parseInt(tokenDisplay.textContent || '0')).toBeGreaterThan(0);
    }, { timeout: 3000 });
    
    // Step 4: Verify individual file token counts
    const file1Card = screen.getByTestId('file-card-index.ts');
    const file2Card = screen.getByTestId('file-card-utils.ts');
    
    expect(file1Card).toHaveTextContent(/\\d+ tokens/);
    expect(file2Card).toHaveTextContent(/\\d+ tokens/);
  });
  
  it('should handle worker failures gracefully in UI', async () => {
    // Setup similar to above...
    
    // Mock worker failure
    const mockError = new Error('Worker crashed');
    jest.spyOn(console, 'error').mockImplementation();
    
    // Simulate worker crash by overriding postMessage
    const originalWorker = global.Worker;
    global.Worker = jest.fn().mockImplementation(() => ({
      postMessage: jest.fn().mockImplementation(() => {
        throw mockError;
      }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      terminate: jest.fn()
    }));
    
    render(<App />);
    
    // Perform file selection...
    
    // Should show fallback estimation
    await waitFor(() => {
      const tokenDisplay = screen.getByTestId('total-tokens');
      expect(tokenDisplay).toHaveTextContent(/\\d+ tokens \\(estimated\\)/);
    });
    
    // Restore
    global.Worker = originalWorker;
  });
});
```

### Phase 4: Performance Testing (Day 9-10)

```typescript
// src/__tests__/performance/token-counter-performance.test.ts

import { performance } from 'perf_hooks';
import { TokenWorkerPool } from '../../utils/token-worker-pool';
import { TEST_CONSTANTS, generateText, generateCode } from '../test-constants';

describe('Token Counter Performance', () => {
  let pool: TokenWorkerPool;
  
  beforeAll(() => {
    pool = new TokenWorkerPool();
  });
  
  afterAll(() => {
    pool.terminate();
  });
  
  describe('Processing Time Benchmarks', () => {
    it.each([
      ['10KB', 10 * 1024, 10],
      ['100KB', 100 * 1024, 50],
      ['500KB', 500 * 1024, 250],
      ['1MB', 1024 * 1024, 500],
      ['5MB', 5 * 1024 * 1024, 2500],
    ])('should process %s file within %dms', async (label, size, maxTime) => {
      const text = generateText(size);
      
      const startTime = performance.now();
      const result = await pool.countTokens(text);
      const duration = performance.now() - startTime;
      
      expect(duration).toBeLessThan(maxTime);
      expect(result).toBeGreaterThan(0);
      
      // Log for performance tracking
      console.log(`${label}: ${duration.toFixed(2)}ms (${result} tokens)`);
    });
    
    it('should maintain performance under concurrent load', async () => {
      const fileSize = 100 * 1024; // 100KB each
      const concurrentRequests = 20;
      const texts = Array.from({ length: concurrentRequests }, () => generateText(fileSize));
      
      const startTime = performance.now();
      const results = await Promise.all(
        texts.map(text => pool.countTokens(text))
      );
      const totalDuration = performance.now() - startTime;
      
      // Should process all within reasonable time
      expect(totalDuration).toBeLessThan(1000); // 1 second for 20 files
      
      // All should have results
      expect(results.every(r => r > 0)).toBe(true);
      
      // Calculate throughput
      const throughput = (concurrentRequests * fileSize) / (totalDuration / 1000) / 1024 / 1024;
      console.log(`Throughput: ${throughput.toFixed(2)} MB/s`);
    });
  });
  
  describe('Memory Usage', () => {
    it('should not exceed memory limits under sustained load', async () => {
      if (!performance.memory) {
        console.warn('Memory monitoring not available in this environment');
        return;
      }
      
      const initialMemory = performance.memory.usedJSHeapSize;
      const iterations = 100;
      const fileSize = 100 * 1024; // 100KB
      
      for (let i = 0; i < iterations; i++) {
        const text = generateText(fileSize);
        await pool.countTokens(text);
        
        // Check memory every 10 iterations
        if (i % 10 === 0) {
          global.gc?.(); // Force GC if available
          const currentMemory = performance.memory.usedJSHeapSize;
          const memoryIncrease = currentMemory - initialMemory;
          
          // Should not grow unbounded
          expect(memoryIncrease).toBeLessThan(TEST_CONSTANTS.MAX_WORKER_MEMORY);
        }
      }
    });
  });
  
  describe('Degradation Testing', () => {
    it('should degrade gracefully under extreme load', async () => {
      const requests: Promise<number>[] = [];
      const fileSize = 1024 * 1024; // 1MB
      const extremeLoad = 100;
      
      // Generate extreme load
      for (let i = 0; i < extremeLoad; i++) {
        const text = generateText(fileSize);
        requests.push(pool.countTokens(text).catch(() => -1));
      }
      
      const results = await Promise.all(requests);
      
      // Some may fail, but not all
      const successful = results.filter(r => r > 0).length;
      const failed = results.filter(r => r === -1).length;
      
      expect(successful).toBeGreaterThan(extremeLoad * 0.8); // At least 80% success
      
      // Check performance stats
      const stats = pool.getPerformanceStats();
      expect(stats.successRate).toBeGreaterThan(0.8);
    });
  });
});
```

### Phase 5: Test Quality Improvements (Day 11-12)

#### 5.1 Create Test Quality Utilities

```typescript
// src/__tests__/test-utils/test-quality.ts

export interface TestQualityMetrics {
  assertionCount: number;
  mockCount: number;
  hasSkippedTests: boolean;
  hasEmptyTryCatch: boolean;
  hasTautologicalAssertions: boolean;
}

export function analyzeTestQuality(testSuite: jest.Suite): TestQualityMetrics {
  let assertionCount = 0;
  let mockCount = 0;
  let hasSkippedTests = false;
  let hasEmptyTryCatch = false;
  let hasTautologicalAssertions = false;
  
  // Analyze test suite...
  
  return {
    assertionCount,
    mockCount,
    hasSkippedTests,
    hasEmptyTryCatch,
    hasTautologicalAssertions
  };
}

export function enforceTestQuality(metrics: TestQualityMetrics): void {
  if (metrics.assertionCount < 2) {
    throw new Error('Test must have at least 2 assertions');
  }
  
  if (metrics.mockCount > 3) {
    throw new Error('Test has too many mocks (max 3)');
  }
  
  if (metrics.hasSkippedTests) {
    throw new Error('Skipped tests are not allowed');
  }
  
  if (metrics.hasEmptyTryCatch) {
    throw new Error('Empty try-catch blocks are not allowed');
  }
  
  if (metrics.hasTautologicalAssertions) {
    throw new Error('Tautological assertions (expect(true).toBe(true)) are not allowed');
  }
}
```

## Implementation Schedule

### Week 1 (Days 1-5)
- **Day 1-2**: Fix critical violations (worker-pool-fixes.test.ts)
- **Day 3**: Implement useTokenCounter tests
- **Day 4**: Create test utilities and infrastructure
- **Day 5**: Refactor existing tests to use utilities

### Week 2 (Days 6-10)
- **Day 6-7**: Implement integration tests
- **Day 8**: Create E2E workflow tests
- **Day 9-10**: Add performance benchmarks

### Week 3 (Days 11-15)
- **Day 11-12**: Quality improvements and assertion specificity
- **Day 13**: Feature flag and edge case testing
- **Day 14**: Documentation and cleanup
- **Day 15**: Final review and quality audit

## Success Metrics

### Test Quality Metrics
- ✅ 100% of tests have ≥2 meaningful assertions
- ✅ No test file has >3 mocks
- ✅ 0 placeholder or tautological tests
- ✅ All tests pass consistently (no flaky tests)
- ✅ TypeScript compilation with zero errors

### Coverage Metrics
- ✅ >90% code coverage for worker features
- ✅ 100% coverage of critical paths
- ✅ All error scenarios tested
- ✅ Performance baselines established

### Behavioral Coverage
- ✅ Input validation boundaries tested
- ✅ Error recovery mechanisms verified
- ✅ Race conditions handled properly
- ✅ Memory limits enforced
- ✅ Feature flags properly tested

## Maintenance Guidelines

### Continuous Quality Enforcement
1. Run test quality audit on every PR
2. Enforce minimum assertion requirements
3. Monitor and fix flaky tests immediately
4. Update performance baselines quarterly

### Documentation Requirements
1. Document any new test patterns
2. Update TESTING.md with worker examples
3. Maintain test utility documentation
4. Create troubleshooting guides

## Conclusion

This comprehensive plan transforms the Web Worker token counting feature from having minimal test coverage to being one of the best-tested features in the codebase. By following this plan, we ensure:

1. **Reliability**: All critical paths are tested with realistic scenarios
2. **Performance**: Baselines prevent regression
3. **Maintainability**: Clear patterns and utilities for future tests
4. **Quality**: Enforced standards prevent test decay

The investment in proper testing will pay dividends through reduced bugs, faster development cycles, and increased confidence in the feature's behavior.