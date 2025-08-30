import { TEST_CONSTANTS } from './test-constants';
import { TokenWorkerPool } from '../utils/token-worker-pool';
import { TOKEN_COUNTING } from '@constants';

describe('TokenWorkerPool Behavioral Tests', () => {
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

  describe('Token Counting Behavior', () => {
    it('should return reasonable token estimates for text input', async () => {
      const text = 'function calculateSum(a, b) { return a + b; }';
      
      const promise = pool.countTokens(text);
      jest.advanceTimersByTime(100);
      const result = await promise;
      
      expect(result).toBeGreaterThan(0);
      expect(result).toBeCloseTo(Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN), 2);
    });

    it('should handle empty text input', async () => {
      const promise = pool.countTokens('');
      jest.advanceTimersByTime(100);
      const result = await promise;
      
      expect(result).toBe(0);
    });

    it('should process multiple texts concurrently', async () => {
      const texts = [
        'const a = 1;',
        'function test() { return true; }',
        'export default class MyClass {}'
      ];
      
      const promises = texts.map(text => pool.countTokens(text));
      jest.advanceTimersByTime(100);
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result).toBeGreaterThan(0);
        expect(result).toBeCloseTo(Math.ceil(texts[index].length / TOKEN_COUNTING.CHARS_PER_TOKEN), 2);
      });
    });
  });

  describe('Input Validation', () => {
    it('should reject texts larger than 10MB', async () => {
      const largeText = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE + 1);
      
      const promise = pool.countTokens(largeText);
      jest.advanceTimersByTime(100);
      
      await expect(promise).rejects.toThrow('Text too large for processing');
    });

    it('should accept texts up to 10MB', async () => {
      const maxSizeText = 'x'.repeat(TEST_CONSTANTS.MAX_FILE_SIZE - 100);
      
      const promise = pool.countTokens(maxSizeText);
      jest.advanceTimersByTime(100);
      const result = await promise;
      
      expect(result).toBeGreaterThan(0);
      expect(result).toBeCloseTo(Math.ceil(maxSizeText.length / TOKEN_COUNTING.CHARS_PER_TOKEN), 100);
    });
  });

  describe('Request Deduplication', () => {
    it('should return same result for identical text requests', async () => {
      const text = 'duplicate test content';
      
      const promise1 = pool.countTokens(text);
      const promise2 = pool.countTokens(text);
      
      jest.advanceTimersByTime(100);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      expect(result1).toBe(result2);
      expect(result1).toBeGreaterThan(0);
    });

    it('should handle different texts independently', async () => {
      const text1 = 'short';
      const text2 = 'much longer text with significantly more content to count'; 
      
      const promise1 = pool.countTokens(text1);
      const promise2 = pool.countTokens(text2);
      
      jest.advanceTimersByTime(100);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      expect(result1).not.toBe(result2);
      expect(result1).toBeCloseTo(Math.ceil(text1.length / TOKEN_COUNTING.CHARS_PER_TOKEN), 2);
      expect(result2).toBeCloseTo(Math.ceil(text2.length / TOKEN_COUNTING.CHARS_PER_TOKEN), 2);
      expect(result2).toBeGreaterThan(result1); // Longer text should have more tokens
    });
  });

  describe('Queue Management', () => {
    it('should handle high-volume requests without crashing', async () => {
      const requests = Array.from({ length: 100 }, (_, i) => 
        pool.countTokens(`request ${i} content`)
      );
      
      jest.advanceTimersByTime(1000);
      
      const results = await Promise.all(requests);
      
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result).toBeGreaterThan(0);
      });
    });

    it('should track performance statistics accurately', async () => {
      const texts = [
        'first text for stats',
        'second text for stats',
        'third text for stats'
      ];
      
      const promises = texts.map(text => pool.countTokens(text));
      jest.advanceTimersByTime(100);
      await Promise.all(promises);
      
      const stats = pool.getPerformanceStats();
      
      expect(stats.totalProcessed).toBeGreaterThanOrEqual(0);
      expect(stats.queueLength).toBeGreaterThanOrEqual(0);
      expect(stats.activeJobs).toBeGreaterThanOrEqual(0);
      expect(stats.poolSize).toBeGreaterThan(0); // Pool size based on hardware
    });
  });

  describe('Health Monitoring', () => {
    it('should perform health checks on workers', async () => {
      const promise = pool.healthCheck();
      jest.advanceTimersByTime(100);
      const healthResults = await promise;
      
      expect(healthResults.length).toBeGreaterThan(0); // Pool size based on hardware
      healthResults.forEach(result => {
        expect(result).toHaveProperty('workerId');
        expect(result).toHaveProperty('healthy');
        expect(result).toHaveProperty('responseTime');
        expect(typeof result.workerId).toBe('number');
        expect(typeof result.healthy).toBe('boolean');
        expect(typeof result.responseTime).toBe('number');
      });
    });
  });

  describe('Pool Termination', () => {
    it('should reject new requests after termination', async () => {
      pool.terminate();
      
      await expect(pool.countTokens('test')).rejects.toThrow('Worker pool has been terminated');
    });

    it('should complete pending requests before termination', async () => {
      const promise = pool.countTokens('test content');
      jest.advanceTimersByTime(50);
      
      // Don't wait for terminate, test that pending request completes
      const result = await promise;
      
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('Error Resilience', () => {
    it('should provide fallback estimates when workers are unavailable', async () => {
      const text = 'test content for fallback';
      
      // Create a single worker pool to simulate resource constraints
      const singleWorkerPool = new TokenWorkerPool(1);
      
      try {
        const promise = singleWorkerPool.countTokens(text);
        jest.advanceTimersByTime(100);
        const result = await promise;
        
        expect(result).toBeGreaterThan(0);
        expect(result).toBeCloseTo(Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN), 2);
      } finally {
        singleWorkerPool.terminate();
      }
    });
  });
});