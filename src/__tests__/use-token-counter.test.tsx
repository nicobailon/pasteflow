import { renderHook, act } from '@testing-library/react';
import { useTokenCounter } from '../hooks/use-token-counter';
import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';
import { TEST_CONSTANTS } from './test-constants';

jest.mock('../utils/token-worker-pool');
jest.mock('../utils/token-utils');

describe('useTokenCounter Hook', () => {
  let mockPool: Partial<jest.Mocked<TokenWorkerPool>>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockPool = {
      countTokens: jest.fn(),
      terminate: jest.fn(),
      monitorWorkerMemory: jest.fn(),
      getPerformanceStats: jest.fn().mockReturnValue({
        totalProcessed: 0,
        totalTime: 0,
        failureCount: 0,
        averageTime: 0,
        successRate: 0,
        queueLength: 0,
        activeJobs: 0,
        droppedRequests: 0,
        maxQueueSize: 1000,
        poolSize: 4,
        availableWorkers: 4
      }),
      countTokensBatch: jest.fn(),
      healthCheck: jest.fn(),
      performHealthMonitoring: jest.fn()
    };
    
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
      
      expect(mockPool.countTokens).not.toHaveBeenCalled();
      
      expect(estimateTokenCount).toHaveBeenCalledWith(largeText);
      expect(tokenCount).toBe(Math.ceil(largeText.length / 4));
    });
    
    it('should handle empty input gracefully', async () => {
      const { result } = renderHook(() => useTokenCounter());
      mockPool.countTokens?.mockResolvedValue(0);
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens('');
      });
      
      expect(tokenCount).toBe(0);
    });
    
    it('should validate input types and handle null/undefined', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      // Test with various invalid inputs
      const invalidInputs: unknown[] = [null, undefined, 123, {}, []];
      
      for (const input of invalidInputs) {
        let tokenCount: number = 0;
        await act(async () => {
          // Testing invalid input handling - this is intentional
          tokenCount = await result.current.countTokens(input as string);
        });
        
        expect(tokenCount).toBe(0);
      }
    });
  });
  
  describe('Error Handling', () => {
    it('should fall back to estimation on worker error', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const text = 'test content';
      
      mockPool.countTokens?.mockRejectedValue(new Error('Worker failed'));
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens(text);
      });
      
      expect(estimateTokenCount).toHaveBeenCalledWith(text);
      expect(tokenCount).toBe(Math.ceil(text.length / 4));
    });
    
    it('should recreate pool after repeated failures', async () => {
      const { result } = renderHook(() => useTokenCounter());
      
      mockPool.countTokens?.mockRejectedValue(new Error('Worker failed'));
      
      for (let i = 0; i < 11; i++) {
        await act(async () => {
          await result.current.countTokens(`test ${i}`);
        });
      }
      
      expect(mockPool.terminate).toHaveBeenCalled();
      expect(TokenWorkerPool).toHaveBeenCalledTimes(2);
    });
    
    it('should provide meaningful error context', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      mockPool.countTokens?.mockRejectedValue(new Error('Specific error'));
      
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
        ?.mockResolvedValueOnce(10)
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
        'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1),
        'another small text'
      ];
      
      mockPool.countTokens
        ?.mockResolvedValueOnce(10)
        .mockResolvedValueOnce(30);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      expect(mockPool.countTokens).toHaveBeenCalledTimes(2);
      expect(estimateTokenCount).toHaveBeenCalledWith(texts[1]);
      expect(results.length).toBe(3);
    });
    
    it('should handle partial batch failures gracefully', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const texts = ['text1', 'text2', 'text3'];
      
      mockPool.countTokens
        ?.mockResolvedValueOnce(10)
        .mockRejectedValueOnce(new Error('Worker failed'))
        .mockResolvedValueOnce(30);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(texts);
      });
      
      expect(results.length).toBe(3);
      expect(results[0]).toBe(10);
      expect(results[1]).toBe(Math.ceil(texts[1].length / 4));
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
        successRate: 0.98,
        queueLength: 0,
        activeJobs: 0,
        droppedRequests: 0,
        maxQueueSize: 1000,
        poolSize: 4,
        availableWorkers: 3
      };
      
      mockPool.getPerformanceStats?.mockReturnValue(mockStats);
      
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
      const originalEnv = process.env.DISABLE_WEB_WORKERS;
      process.env.DISABLE_WEB_WORKERS = 'true';
      
      const { result } = renderHook(() => useTokenCounter());
      
      await act(async () => {
        await result.current.countTokens('test');
      });
      
      expect(mockPool.countTokens).not.toHaveBeenCalled();
      expect(estimateTokenCount).toHaveBeenCalled();
      
      process.env.DISABLE_WEB_WORKERS = originalEnv;
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle undefined return from worker pool', async () => {
      const { result } = renderHook(() => useTokenCounter());
      // Test that the hook handles undefined from pool.countTokens
      // In reality, the pool returns a number, but we're testing the hook's defensive code
      jest.spyOn(mockPool, 'countTokens').mockImplementation(() => Promise.resolve(undefined as unknown as number));
      
      let tokenCount: number = 0;
      await act(async () => {
        tokenCount = await result.current.countTokens('test');
      });
      
      expect(estimateTokenCount).toHaveBeenCalledWith('test');
      expect(tokenCount).toBe(Math.ceil('test'.length / 4));
    });
    
    it('should handle worker pool not being initialized', async () => {
      (TokenWorkerPool as jest.Mock).mockImplementation(() => undefined);
      
      const { result } = renderHook(() => useTokenCounter());
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await act(async () => {
        await result.current.countTokens('test');
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Worker pool not initialized, using estimation');
      expect(estimateTokenCount).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
    
    it('should handle very large batch processing', async () => {
      const { result } = renderHook(() => useTokenCounter());
      const largeBatch = Array(100).fill('test content');
      
      mockPool.countTokens?.mockResolvedValue(10);
      
      let results: number[] = [];
      await act(async () => {
        results = await result.current.countTokensBatch(largeBatch);
      });
      
      expect(results.length).toBe(100);
      expect(results.every(r => r === 10)).toBe(true);
    });
  });
});