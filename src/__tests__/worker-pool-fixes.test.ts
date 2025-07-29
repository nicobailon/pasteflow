import { TEST_CONSTANTS } from './test-constants';
import { TokenWorkerPool } from '../utils/token-worker-pool';

describe('Worker Pool Critical Fixes', () => {
  let pool: TokenWorkerPool;
  
  beforeEach(() => {
    jest.useFakeTimers();
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
      
      const worker = mockWorkers[0];
      const addSpy = jest.spyOn(worker, 'addEventListener');
      const removeSpy = jest.spyOn(worker, 'removeEventListener');
      
      worker.postMessage = jest.fn().mockImplementation((data: any) => {
        if (data.type === 'INIT') {
          setTimeout(() => {
            worker.simulateMessage({ type: 'INIT_COMPLETE', id: data.id, success: true });
          }, 5);
        }
      });
      
      jest.advanceTimersByTime(50);
      
      const promise = pool.countTokens(text);
      
      await jest.advanceTimersByTimeAsync(10);
      
      expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('error', expect.any(Function));
      
      jest.advanceTimersByTime(TEST_CONSTANTS.WORKER_TIMEOUT);
      
      const result = await promise;
      
      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('error', expect.any(Function));
      
      expect(result).toBe(Math.ceil(text.length / 4));
    });
    
    it('should clean up listeners on worker error', async () => {
      const text = 'test content for error';
      const worker = mockWorkers[0];
      
      const removeSpy = jest.spyOn(worker, 'removeEventListener');
      
      worker.postMessage = jest.fn().mockImplementation((data: any) => {
        if (data.type === 'INIT') {
          setTimeout(() => {
            worker.simulateMessage({ type: 'INIT_COMPLETE', id: data.id, success: true });
          }, 5);
        } else if (data.type === 'COUNT_TOKENS') {
          setTimeout(() => {
            worker.simulateError(new Error('Worker crashed'));
          }, 10);
        }
      });
      
      jest.advanceTimersByTime(50);
      
      const promise = pool.countTokens(text);
      
      jest.advanceTimersByTime(20);
      
      const result = await promise;
      
      expect(removeSpy).toHaveBeenCalledTimes(2);
      expect(result).toBe(Math.ceil(text.length / 4));
    });
  });
  
  describe('Race Condition Prevention', () => {
    it('should handle concurrent updates atomically using Map', async () => {
      const files = [
        { path: 'file1.ts', content: 'const a = 1;' },
        { path: 'file2.ts', content: 'const b = 2;' },
        { path: 'file3.ts', content: 'const c = 3;' }
      ];
      
      // Test concurrent processing behavior
      const promises = files.map(async (file) => {
        return await pool.countTokens(file.content);
      });
      
      jest.advanceTimersByTime(100);
      
      const results = await Promise.all(promises);
      
      // Verify all files were processed
      expect(results).toHaveLength(3);
      expect(results[0]).toBeGreaterThan(0);
      expect(results[1]).toBeGreaterThan(0);
      expect(results[2]).toBeGreaterThan(0);
      
      // Verify token estimation is reasonable (approximately 1 token per 4 chars)
      expect(results[0]).toBeCloseTo(Math.ceil(files[0].content.length / 4), 1);
      expect(results[1]).toBeCloseTo(Math.ceil(files[1].content.length / 4), 1);
      expect(results[2]).toBeCloseTo(Math.ceil(files[2].content.length / 4), 1);
    });
  });
  
  describe('Input Size Validation', () => {
    it('should reject texts larger than 10MB before sending to worker', async () => {
      const largeText = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const worker = mockWorkers[0];
      const postMessageSpy = jest.spyOn(worker, 'postMessage');
      
      jest.advanceTimersByTime(50);
      
      const result = await pool.countTokens(largeText);
      
      const tokenCountingCalls = postMessageSpy.mock.calls.filter(
        call => call[0].type === 'COUNT_TOKENS'
      );
      expect(tokenCountingCalls.length).toBe(0);
      
      expect(result).toBe(Math.ceil(largeText.length / 4));
      
      consoleSpy.mockRestore();
    });
    
    it('should process texts up to 10MB through workers', async () => {
      const text = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE - 100);
      const worker = mockWorkers[0];
      
      worker.postMessage = jest.fn().mockImplementation((data: any) => {
        if (data.type === 'INIT') {
          setTimeout(() => {
            worker.simulateMessage({ type: 'INIT_COMPLETE', id: data.id, success: true });
          }, 5);
        } else if (data.type === 'COUNT_TOKENS') {
          setTimeout(() => {
            worker.simulateMessage({ 
              type: 'TOKEN_COUNT', 
              id: data.id, 
              result: 1000,
              fallback: false 
            });
          }, 10);
        }
      });
      
      jest.advanceTimersByTime(50);
      
      const result = await pool.countTokens(text);
      
      jest.advanceTimersByTime(20);
      
      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'COUNT_TOKENS',
        id: expect.any(String),
        payload: { text }
      });
      
      expect(result).toBe(1000);
    });
  });
  
  describe('Queue Management', () => {
    it('should enforce maximum queue size of 1000 requests', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const singleWorkerPool = new TokenWorkerPool(1);
      
      jest.advanceTimersByTime(50);
      
      const requests: Promise<number>[] = [];
      for (let i = 0; i < TEST_CONSTANTS.OVERFLOW_TEST_SIZE; i++) {
        requests.push(singleWorkerPool.countTokens(`text ${i}`));
      }
      
      jest.advanceTimersByTime(100);
      
      const results = await Promise.all(requests);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queue size limit reached')
      );
      
      expect(results.length).toBe(TEST_CONSTANTS.OVERFLOW_TEST_SIZE);
      
      consoleSpy.mockRestore();
      singleWorkerPool.terminate();
    });
    
    it('should drop oldest requests when queue is full', async () => {
      const singleWorkerPool = new TokenWorkerPool(1);
      
      jest.advanceTimersByTime(50);
      
      const slowWorker = mockWorkers[mockWorkers.length - 1];
      slowWorker.postMessage = jest.fn().mockImplementation((data: any) => {
        if (data.type === 'INIT') {
          setTimeout(() => {
            slowWorker.simulateMessage({ type: 'INIT_COMPLETE', id: data.id, success: true });
          }, 5);
        } else if (data.type === 'COUNT_TOKENS') {
          setTimeout(() => {
            slowWorker.simulateMessage({ 
              type: 'TOKEN_COUNT', 
              id: data.id, 
              result: 100,
              fallback: false 
            });
          }, 1000);
        }
      });
      
      const timestamps: number[] = [];
      
      for (let i = 0; i < TEST_CONSTANTS.MAX_QUEUE_SIZE; i++) {
        timestamps.push(Date.now());
        singleWorkerPool.countTokens(`request ${i}`);
      }
      
      singleWorkerPool.countTokens('overflow request');
      
      jest.advanceTimersByTime(50);
      
      const stats = singleWorkerPool.getPerformanceStats();
      expect(stats.droppedRequests).toBeGreaterThan(0);
      
      singleWorkerPool.terminate();
    });
  });
  
  describe('Worker Health Monitoring', () => {
    it('should detect and recover unhealthy workers', async () => {
      jest.advanceTimersByTime(50);
      
      const worker = mockWorkers[0];
      const originalPostMessage = worker.postMessage;
      
      worker.postMessage = jest.fn().mockImplementation((data: any) => {
        if (data.type === 'HEALTH_CHECK') {
          return;
        }
        originalPostMessage.call(worker, data);
      });
      
      const health = await pool.healthCheck();
      
      jest.advanceTimersByTime(1100);
      
      const unhealthyWorkers = health.filter((h: { healthy: boolean }) => !h.healthy);
      expect(unhealthyWorkers.length).toBeGreaterThan(0);
      expect(unhealthyWorkers[0].workerId).toBe(0);
      
      await jest.advanceTimersByTimeAsync(2100);
      
      const newWorkerCount = mockWorkers.length;
      expect(newWorkerCount).toBeGreaterThan(1);
    });
    
    it('should perform periodic health monitoring', () => {
      const healthCheckSpy = jest.spyOn(pool, 'healthCheck');
      
      jest.advanceTimersByTime(TEST_CONSTANTS.HEALTH_CHECK_INTERVAL);
      
      expect(healthCheckSpy).toHaveBeenCalled();
    });
  });
  
  describe('Request Deduplication', () => {
    it('should return same promise for identical concurrent requests', async () => {
      const text = 'duplicate request content';
      
      jest.advanceTimersByTime(50);
      
      const worker = mockWorkers[0];
      const postMessageSpy = jest.spyOn(worker, 'postMessage');
      
      const originalPostMessage = worker.postMessage;
      worker.postMessage = jest.fn().mockImplementation((data: any) => {
        if (data.type === 'COUNT_TOKENS') {
          setTimeout(() => {
            worker.simulateMessage({ 
              type: 'TOKEN_COUNT', 
              id: data.id, 
              result: 42,
              fallback: false 
            });
          }, 50);
        } else {
          originalPostMessage.call(worker, data);
        }
      });
      
      const promise1 = pool.countTokens(text);
      const promise2 = pool.countTokens(text);
      const promise3 = pool.countTokens(text);
      
      expect(promise1).toBe(promise2);
      expect(promise2).toBe(promise3);
      
      const tokenCountingCalls = postMessageSpy.mock.calls.filter(
        call => call[0].type === 'COUNT_TOKENS'
      );
      expect(tokenCountingCalls.length).toBe(1);
      
      jest.advanceTimersByTime(100);
      
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe(42);
    });
    
    it('should handle different requests independently', async () => {
      const text1 = 'first request';
      const text2 = 'second request';
      
      jest.advanceTimersByTime(50);
      
      const worker = mockWorkers[0];
      const postMessageSpy = jest.spyOn(worker, 'postMessage');
      
      const promise1 = pool.countTokens(text1);
      const promise2 = pool.countTokens(text2);
      
      expect(promise1).not.toBe(promise2);
      
      const tokenCountingCalls = postMessageSpy.mock.calls.filter(
        call => call[0].type === 'COUNT_TOKENS'
      );
      expect(tokenCountingCalls.length).toBe(2);
      
      jest.advanceTimersByTime(100);
      
      await Promise.all([promise1, promise2]);
    });
  });
});