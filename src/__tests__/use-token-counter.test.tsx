// Mock the TokenWorkerPool to use our test-friendly version
jest.mock('../utils/token-worker-pool', () => ({
  TokenWorkerPool: jest.fn()
}));
jest.mock('../utils/token-utils');

import { renderHook, act } from '@testing-library/react';
import { useTokenCounter, forceCleanupTokenWorkerPool } from '../hooks/use-token-counter';

import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';
import { TEST_CONSTANTS } from './test-constants';

// Create mock pool instance
const createMockPool = () => ({
  countTokens: jest.fn().mockResolvedValue(10),
  terminate: jest.fn(),
  getPerformanceStats: jest.fn().mockReturnValue({
    totalProcessed: 1,
    totalTime: 100,
    failureCount: 0,
    averageTime: 100,
    successRate: 1.0
  }),
  monitorWorkerMemory: jest.fn()
});

describe('useTokenCounter Hook', () => {
  let mockPool: ReturnType<typeof createMockPool>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Reset TokenWorkerPool mock
    (TokenWorkerPool as jest.Mock).mockReset();
    
    // Create fresh mock pool for each test
    mockPool = createMockPool();
    (TokenWorkerPool as jest.Mock).mockImplementation(() => mockPool);
    
    // Mock estimateTokenCount
    (estimateTokenCount as jest.Mock).mockImplementation(text => {
      if (!text || typeof text !== 'string') return 0;
      return Math.ceil(text.length / 4);
    });
  });
  
  afterEach(() => {
    // Clean up singleton state
    act(() => {
      forceCleanupTokenWorkerPool();
    });
    
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });
  
  describe('Hook Lifecycle', () => {
    it('should initialize and provide token counting functionality', async () => {
      const { result, rerender } = renderHook(() => useTokenCounter());
      
      // Verify functions are available immediately
      expect(result.current.countTokens).toBeDefined();
      expect(result.current.countTokensBatch).toBeDefined();
      expect(result.current.getPerformanceStats).toBeDefined();
      expect(result.current.forceCleanup).toBeDefined();
      
      // Force a rerender to ensure effect has run
      rerender();
      
      // Verify pool was created and hook is ready
      expect(result.current.isReady).toBe(true);
      expect(TokenWorkerPool).toHaveBeenCalledTimes(1);
      expect(mockPool.monitorWorkerMemory).toHaveBeenCalled();
    });
    
    it('should cleanup resources on unmount and idle timeout', async () => {
      const { unmount, rerender } = renderHook(() => useTokenCounter());
      
      // Force initial render
      rerender();
      
      // Unmount the hook
      unmount();
      
      // Advance time past idle timeout (5 minutes)
      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000 + 1000);
      });
      
      // Verify pool was terminated
      expect(mockPool.terminate).toHaveBeenCalled();
      
      // Verify new instance is created on next use
      const { result: newResult, rerender: newRerender } = renderHook(() => useTokenCounter());
      newRerender();
      
      expect(TokenWorkerPool).toHaveBeenCalledTimes(2);
      expect(newResult.current.isReady).toBe(true);
    });
  });
  
  describe('Token Counting Behavior', () => {
    it('should count tokens for valid text input', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const testText = 'Hello world, this is a test';
      
      mockPool.countTokens.mockResolvedValue(15);
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens(testText);
      });
      
      expect(tokenCount).toBe(15);
      expect(mockPool.countTokens).toHaveBeenCalledWith(testText);
      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe('number');
    });
    
    it('should use estimation for oversized text', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const largeText = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1);
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens(largeText);
      });
      
      // Should not call worker pool for oversized text
      expect(mockPool.countTokens).not.toHaveBeenCalled();
      expect(estimateTokenCount).toHaveBeenCalledWith(largeText);
      expect(tokenCount).toBe(Math.ceil(largeText.length / 4));
      expect(tokenCount).toBeGreaterThan(0);
    });
    
    it('should handle empty and invalid inputs gracefully', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      // Test empty string
      mockPool.countTokens.mockResolvedValue(0);
      let emptyCount: number = 0;
      await act(async () => {
        emptyCount = await result.current.countTokens('');
      });
      
      expect(emptyCount).toBe(0);
      expect(emptyCount).toBeGreaterThanOrEqual(0);
      expect(typeof emptyCount).toBe('number');
      
      // Test invalid inputs
      const invalidInputs = [null, undefined, 123, {}, []];
      for (const input of invalidInputs) {
        let count: number = 0;
        await act(async () => {
          count = await result.current.countTokens(input as string);
        });
        // Invalid inputs should use estimation which returns a small value
        expect(count).toBeGreaterThanOrEqual(0);
        expect(typeof count).toBe('number');
      }
    });
  });
  
  describe('Error Handling and Resilience', () => {
    it('should fallback to estimation when workers fail', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const testText = 'test content for error handling';
      
      // Make worker fail
      mockPool.countTokens.mockRejectedValue(new Error('Worker failed'));
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens(testText);
      });
      
      expect(estimateTokenCount).toHaveBeenCalledWith(testText);
      expect(tokenCount).toBe(Math.ceil(testText.length / 4));
      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe('number');
    });
    
    it('should recreate pool after repeated failures', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      // Make worker fail repeatedly
      mockPool.countTokens.mockRejectedValue(new Error('Worker failed'));
      
      // Trigger 11 failures to exceed threshold
      const results: number[] = [];
      for (let i = 0; i < 11; i++) {
        await act(async () => {
          const count = await result.current.countTokens(`test ${i}`);
          results.push(count);
        });
      }
      
      // Verify all requests got fallback values
      expect(results.every(r => r > 0)).toBe(true);
      expect(results.length).toBe(11);
      
      // Verify pool was recreated
      expect(mockPool.terminate).toHaveBeenCalled();
      expect(TokenWorkerPool).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('Batch Processing', () => {
    it('should process multiple texts efficiently', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = ['short text', 'medium length text here', 'a much longer text with many words'];
      
      mockPool.countTokens
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(30);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      expect(results).toEqual([10, 20, 30]);
      expect(results.length).toBe(texts.length);
      expect(results.every(r => r > 0)).toBe(true);
      expect(mockPool.countTokens).toHaveBeenCalledTimes(3);
    });
    
    it('should handle mixed valid and oversized texts in batch', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = [
        'small text',
        'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1), // Oversized
        'another small text'
      ];
      
      mockPool.countTokens
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(30); // Won't be called for oversized
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      expect(results.length).toBe(3);
      expect(results[0]).toBe(10);
      expect(results[1]).toBe(Math.ceil(texts[1].length / 4)); // Estimation
      expect(results[2]).toBe(30);
      
      // Verify oversized text used estimation
      expect(estimateTokenCount).toHaveBeenCalledWith(texts[1]);
      expect(mockPool.countTokens).toHaveBeenCalledTimes(2);
    });
    
    it('should gracefully handle partial batch failures', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = ['text1', 'text2', 'text3'];
      
      // Mix success and failure
      mockPool.countTokens
        .mockResolvedValueOnce(10)
        .mockRejectedValueOnce(new Error('Worker failed'))
        .mockResolvedValueOnce(30);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      expect(results.length).toBe(3);
      expect(results[0]).toBe(10);
      expect(results[1]).toBe(Math.ceil(texts[1].length / 4)); // Fallback
      expect(results[2]).toBe(30);
      expect(results.every(r => r > 0)).toBe(true);
    });
  });
  
  describe('Performance Monitoring', () => {
    it('should track and expose performance statistics', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      // Process some tokens first
      await act(async () => {
        await result.current.countTokens('test content');
      });
      
      const stats = result.current.getPerformanceStats();
      
      expect(stats.totalProcessed).toBeGreaterThan(0);
      expect(stats.averageTime).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
      expect(typeof stats.totalProcessed).toBe('number');
      expect(typeof stats.failureCount).toBe('number');
    });
    
    it('should return default stats when pool not initialized', () => {
      // Create a separate mock pool that returns null
      const originalImpl = (TokenWorkerPool as jest.Mock).getMockImplementation();
      (TokenWorkerPool as jest.Mock).mockImplementationOnce(() => null);
      
      const { result } = renderHook(() => useTokenCounter());
      const stats = result.current.getPerformanceStats();
      
      expect(stats.totalProcessed).toBe(0);
      expect(stats.totalTime).toBe(0);
      expect(stats.failureCount).toBe(0);
      expect(stats.averageTime).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(result.current.isReady).toBe(false);
      
      // Restore original implementation
      (TokenWorkerPool as jest.Mock).mockImplementation(originalImpl);
    });
  });
  
  describe('Memory Management and Cleanup', () => {
    it('should provide force cleanup functionality', async () => {
      const { result, rerender } = renderHook(() => useTokenCounter());
      
      // Ensure hook is initialized
      rerender();
      
      // Verify pool is created and ready
      expect(result.current.isReady).toBe(true);
      
      // Use the hook and verify it works
      mockPool.countTokens.mockResolvedValue(42);
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens('test');
      });
      
      expect(tokenCount).toBe(42);
      expect(mockPool.countTokens).toHaveBeenCalledWith('test');
      
      // Force cleanup
      await act(async () => {
        result.current.forceCleanup();
      });
      
      // Verify cleanup happened
      expect(mockPool.terminate).toHaveBeenCalled();
      
      // Create a new mock pool for the next use
      const newMockPool = createMockPool();
      newMockPool.countTokens.mockResolvedValue(84);
      (TokenWorkerPool as jest.Mock).mockImplementation(() => newMockPool);
      
      // Use the hook again - should create new pool and return new value
      let newTokenCount: number = 0;
      await act(async () => {
        newTokenCount = await result.current.countTokens('test again');
      });
      
      // Verify behavior with new pool
      expect(newTokenCount).toBe(84);
      expect(TokenWorkerPool).toHaveBeenCalledTimes(2);
      expect(newMockPool.countTokens).toHaveBeenCalledWith('test again');
    });
    
    it('should handle concurrent instances with reference counting', async () => {
      // Create multiple hook instances
      const { result: result1, rerender: rerender1 } = renderHook(() => useTokenCounter());
      const { result: result2, rerender: rerender2 } = renderHook(() => useTokenCounter());
      
      // Force render to ensure initialization
      rerender1();
      rerender2();
      
      // Both should share the same pool
      expect(TokenWorkerPool).toHaveBeenCalledTimes(1);
      expect(result1.current.isReady).toBe(true);
      expect(result2.current.isReady).toBe(true);
      
      // Use both instances
      await act(async () => {
        await result1.current.countTokens('test1');
        await result2.current.countTokens('test2');
      });
      
      expect(mockPool.countTokens).toHaveBeenCalledTimes(2);
      expect(mockPool.terminate).not.toHaveBeenCalled();
    });
    
    it('should reset activity timer on usage preventing premature cleanup', async () => {
      const { unmount } = renderHook(() => useTokenCounter());
      
      // Unmount to start idle timer
      unmount();
      
      // Advance time but less than idle timeout
      await act(async () => {
        jest.advanceTimersByTime(4 * 60 * 1000); // 4 minutes
      });
      
      // Create new instance and use it
      const { result: newResult } = renderHook(() => useTokenCounter());
      await act(async () => {
        await newResult.current.countTokens('test');
      });
      
      // Advance time past original timeout
      await act(async () => {
        jest.advanceTimersByTime(2 * 60 * 1000); // 2 more minutes
      });
      
      // Pool should still be active
      expect(mockPool.terminate).not.toHaveBeenCalled();
      expect(newResult.current.isReady).toBe(true);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle very large batch processing', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const batchSize = 100;
      const largeBatch = Array(batchSize).fill('test content');
      
      // Mock consistent response
      mockPool.countTokens.mockResolvedValue(10);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(largeBatch);
      });
      
      expect(results.length).toBe(batchSize);
      expect(results.every(r => r === 10)).toBe(true);
      expect(mockPool.countTokens).toHaveBeenCalledTimes(batchSize);
      
      // Verify performance is tracked
      const stats = result.current.getPerformanceStats();
      expect(stats.totalProcessed).toBeGreaterThan(0);
    });
    
    it('should handle worker returning undefined gracefully', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      // Mock undefined response
      mockPool.countTokens.mockResolvedValue(undefined as any);
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens('test');
      });
      
      // Should fallback to estimation
      expect(estimateTokenCount).toHaveBeenCalledWith('test');
      expect(tokenCount).toBe(Math.ceil('test'.length / 4));
      expect(tokenCount).toBeGreaterThan(0);
    });
  });
});