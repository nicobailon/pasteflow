import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';
import { TOKEN_COUNTING } from '../constants/app-constants';

// Mock Worker API
interface MockWorkerInstance {
  onmessage: ((event: MessageEvent) => void) | null;
  listeners: Map<string, Set<(event: Event) => void>>;
  terminated: boolean;
  responseDelay: number;
  postMessage: (data: unknown) => void;
  addEventListener: (event: string, handler: (event: Event) => void) => void;
  removeEventListener: (event: string, handler: (event: Event) => void) => void;
  terminate: () => void;
}

const mockWorkers: MockWorkerInstance[] = [];
const originalWorker = global.Worker;

class MockWorker implements MockWorkerInstance {
  onmessage: ((event: MessageEvent) => void) | null = null;
  listeners = new Map<string, Set<(event: Event) => void>>();
  terminated = false;
  responseDelay = 10; // Default delay for responses
  
  constructor() {
    mockWorkers.push(this);
    
    // Send WORKER_READY immediately
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({ data: { type: 'WORKER_READY' } } as MessageEvent);
      }
    }, 0);
  }
  
  postMessage(data: unknown) {
    if (this.terminated) {
      throw new Error('Worker has been terminated');
    }
    
    const message = data as { type: string; id?: string; payload?: { text: string } };
    
    // Simulate async message handling with configurable delay
    setTimeout(() => {
      if (this.onmessage && !this.terminated) {
        // Handle different message types
        switch (message.type) {
          case 'INIT':
            this.onmessage({ data: { type: 'INIT_COMPLETE', id: message.id, success: true } } as MessageEvent);
            break;
          case 'HEALTH_CHECK':
            this.onmessage({ data: { type: 'HEALTH_RESPONSE', id: message.id, healthy: true } } as MessageEvent);
            break;
          case 'COUNT_TOKENS':
            // Simulate token counting with delay
            if (message.payload?.text) {
              this.onmessage({ 
                data: { 
                  type: 'TOKEN_COUNT', 
                  id: message.id, 
                  result: Math.ceil(message.payload.text.length / TOKEN_COUNTING.CHARS_PER_TOKEN),
                  fallback: false 
                } 
              } as MessageEvent);
            }
            break;
        }
      }
    }, this.responseDelay);
  }
  
  addEventListener(event: string, handler: (event: Event) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    
    if (event === 'message' && !this.onmessage) {
      this.onmessage = (e: MessageEvent) => {
        this.listeners.get('message')?.forEach(h => h(e));
      };
    }
  }
  
  removeEventListener(event: string, handler: (event: Event) => void) {
    this.listeners.get(event)?.delete(handler);
  }
  
  terminate() {
    this.terminated = true;
    this.onmessage = null;
    this.listeners.clear();
  }
}

beforeEach(() => {
  mockWorkers.length = 0;
  (global as unknown as { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;
});

afterEach(() => {
  (global as unknown as { Worker: typeof Worker }).Worker = originalWorker;
});

describe('Token Worker Pool Race Condition Fix', () => {
  describe('Race Condition Prevention', () => {
    it('should prevent new jobs during recycling', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for init
      
      // Make workers slow to respond
      mockWorkers.forEach(worker => {
        worker.responseDelay = 200; // Slow responses
      });
      
      // Start a job that will be active during recycling
      const activeJobPromise = pool.countTokens('active job content');
      
      // Wait a bit to ensure job is processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Trigger recycling
      await pool.forceRecycle();
      
      // Try to add new jobs during recycling - they should use fallback
      const duringRecyclingPromise = pool.countTokens('job during recycling');
      const batchDuringRecycling = pool.countTokensBatch(['batch1', 'batch2', 'batch3']);
      
      // All results should be estimations
      const duringResult = await duringRecyclingPromise;
      expect(duringResult).toBe(estimateTokenCount('job during recycling'));
      
      const batchResults = await batchDuringRecycling;
      expect(batchResults).toEqual([
        estimateTokenCount('batch1'),
        estimateTokenCount('batch2'),
        estimateTokenCount('batch3')
      ]);
      
      // Original job should also complete (with estimation due to termination)
      const activeResult = await activeJobPromise;
      expect(activeResult).toBeGreaterThan(0);
    });
    
    it('should handle rapid job submissions during recycling', async () => {
      const pool = new TokenWorkerPool(1); // Single worker to make race more likely
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Start recycling
      const recyclePromise = pool.forceRecycle();
      
      // Rapidly submit jobs while recycling is happening
      const rapidJobs: Promise<number>[] = [];
      for (let i = 0; i < 20; i++) {
        rapidJobs.push(pool.countTokens(`rapid job ${i}`));
      }
      
      // Wait for recycling to complete
      await recyclePromise;
      
      // All jobs should complete successfully
      const results = await Promise.all(rapidJobs);
      results.forEach((result, index) => {
        expect(result).toBe(estimateTokenCount(`rapid job ${index}`));
      });
      
      // Verify pool is healthy after recycling
      const stats = pool.getPerformanceStats();
      expect(stats.isRecycling).toBe(false);
      expect(stats.availableWorkers).toBeGreaterThan(0);
    });
    
    it('should clear queued jobs during recycling', async () => {
      const pool = new TokenWorkerPool(1); // Single worker to force queuing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Submit many jobs to fill the queue
      // Since we have a single worker, most will be queued
      const queuedJobs: Promise<number>[] = [];
      for (let i = 0; i < 10; i++) {
        queuedJobs.push(pool.countTokens(`queued job ${i}`));
      }
      
      // Check that jobs are queued
      let stats = pool.getPerformanceStats();
      expect(stats.queueLength).toBeGreaterThan(0);
      
      // Start recycling
      await pool.forceRecycle();
      
      // All queued jobs should resolve with estimations
      const results = await Promise.all(queuedJobs);
      results.forEach((result, index) => {
        expect(result).toBe(estimateTokenCount(`queued job ${index}`));
      });
      
      // Queue should be empty after recycling
      stats = pool.getPerformanceStats();
      expect(stats.queueLength).toBe(0);
    });
    
    it('should handle recycling failure gracefully', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Mock Worker constructor to fail during reinitialization
      let failureCount = 0;
      const OriginalMockWorker = MockWorker;
      (global as unknown as { Worker: typeof Worker }).Worker = class FailingWorker extends OriginalMockWorker {
        constructor() {
          super();
          if (failureCount++ > 2) { // Fail after initial workers
            throw new Error('Worker creation failed');
          }
        }
      } as unknown as typeof Worker;
      
      // Start recycling
      await pool.forceRecycle();
      
      // Pool should clear recycling flag even if initialization partially fails
      const stats = pool.getPerformanceStats();
      expect(stats.isRecycling).toBe(false);
      
      // New jobs should still work (with fallback)
      const result = await pool.countTokens('test after failed recycling');
      expect(result).toBeGreaterThan(0);
    });
    
    it('should handle timeout during recycling', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Start multiple jobs to ensure some are active
      const jobs: Promise<number>[] = [];
      for (let i = 0; i < 5; i++) {
        jobs.push(pool.countTokens(`job ${i} that might hang`));
      }
      
      // Give it time to start
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Start recycling - it should timeout and continue
      const startTime = Date.now();
      await pool.forceRecycle();
      const recycleTime = Date.now() - startTime;
      
      // Recycling should complete within reasonable time (not wait forever)
      expect(recycleTime).toBeLessThan(11000); // 10s timeout + some buffer
      
      // Pool should be functional after recycling
      const stats = pool.getPerformanceStats();
      expect(stats.isRecycling).toBe(false);
    });
    
    it('should maintain data consistency during concurrent recycling attempts', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Attempt multiple concurrent recycling operations
      const recyclePromises = [
        pool.forceRecycle(),
        pool.forceRecycle(),
        pool.forceRecycle()
      ];
      
      // All should complete without errors
      await Promise.all(recyclePromises);
      
      // Pool should be in consistent state
      const stats = pool.getPerformanceStats();
      expect(stats.isRecycling).toBe(false);
      expect(stats.poolSize).toBe(2);
      expect(stats.availableWorkers).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Performance During Recycling', () => {
    it('should maintain reasonable performance with estimation fallback', async () => {
      const pool = new TokenWorkerPool(4);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const texts = Array(100).fill(null).map((_, i) => `performance test ${i}`);
      
      // Start recycling
      const recyclePromise = pool.forceRecycle();
      
      // Count tokens during recycling
      const startTime = Date.now();
      const results = await pool.countTokensBatch(texts);
      const duration = Date.now() - startTime;
      
      await recyclePromise;
      
      // Should complete reasonably quickly with estimations
      expect(duration).toBeLessThan(1000); // Within 1 second
      expect(results.length).toBe(100);
      results.forEach(result => expect(result).toBeGreaterThan(0));
    });
  });
  
  describe('Integration with Health Monitoring', () => {
    it('should not interfere with health checks during recycling', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Start recycling
      const recyclePromise = pool.forceRecycle();
      
      // Attempt health check during recycling
      let healthError = null;
      try {
        await pool.healthCheck();
      } catch (error) {
        healthError = error;
      }
      
      await recyclePromise;
      
      // Health check should not throw errors
      expect(healthError).toBeNull();
      
      // Health check after recycling should work
      const healthResults = await pool.healthCheck();
      expect(healthResults.length).toBe(2);
    });
  });
});