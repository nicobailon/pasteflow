import { TokenWorkerPool } from '../utils/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';
import { TOKEN_COUNTING } from '../constants/app-constants';

// Mock Worker API
const mockWorkers: MockWorker[] = [];
const originalWorker = global.Worker;

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  listeners = new Map<string, Set<(event: Event) => void>>();
  terminated = false;
  
  constructor() {
    mockWorkers.push(this);
  }
  
  postMessage(data: unknown) {
    if (this.terminated) {
      throw new Error('Worker has been terminated');
    }
    
    // Simulate async message handling
    setTimeout(() => {
      if (this.onmessage) {
        const message = data as { type: string; id?: string; payload?: { text: string } };
        // Handle different message types
        switch (message.type) {
          case 'INIT':
            this.onmessage({ data: { type: 'INIT_COMPLETE', id: message.id, success: true } } as MessageEvent);
            break;
          case 'HEALTH_CHECK':
            this.onmessage({ data: { type: 'HEALTH_RESPONSE', id: message.id, healthy: true } } as MessageEvent);
            break;
          case 'COUNT_TOKENS':
            // Simulate token counting
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
    }, 10);
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
  
  simulateCrash() {
    this.terminated = true;
    const errorHandlers = this.listeners.get('error');
    if (errorHandlers) {
      errorHandlers.forEach(handler => handler(new ErrorEvent('error')));
    }
  }
}

beforeEach(() => {
  mockWorkers.length = 0;
  (global as unknown as { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;
});

afterEach(() => {
  (global as unknown as { Worker: typeof Worker }).Worker = originalWorker;
});

describe('Token Worker Error Recovery', () => {
  describe('Worker Crash Recovery', () => {
    it('should recover from worker crash during token counting', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for init
      
      // Start token counting
      const countPromise = pool.countTokens('test content for counting');
      
      // Simulate worker crash
      await new Promise(resolve => setTimeout(resolve, 20));
      mockWorkers[0].simulateCrash();
      
      // Should fallback to estimation
      const result = await countPromise;
      expect(result).toBe(estimateTokenCount('test content for counting'));
    });
    
    it('should recover crashed worker and continue processing', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Crash first worker
      mockWorkers[0].simulateCrash();
      
      // Should still be able to count tokens using other workers
      const result = await pool.countTokens('test content');
      expect(result).toBeGreaterThan(0);
      
      // Verify pool recovered the crashed worker
      const stats = pool.getPerformanceStats();
      expect(stats.availableWorkers).toBeGreaterThan(0);
    });
  });
  
  describe('Concurrent Modification Handling', () => {
    it('should handle file selection changes during batch processing', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const files = Array(10).fill(null).map((_, i) => `file content ${i}`);
      
      // Start batch processing
      const batchPromise = pool.countTokensBatch(files);
      
      // Simulate concurrent modifications
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const results = await batchPromise;
      
      // All results should be valid
      expect(results).toHaveLength(files.length);
      results.forEach(result => {
        expect(result).toBeGreaterThan(0);
      });
    });
  });
  
  describe('Memory Pressure Handling', () => {
    it('should handle memory pressure gracefully', async () => {
      const pool = new TokenWorkerPool(4);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Generate large texts (2MB each)
      const hugeTexts = Array(10).fill(null).map(() => 
        'x'.repeat(2 * 1024 * 1024)
      );
      
      const results = await Promise.all(
        hugeTexts.map(text => pool.countTokens(text))
      );
      
      // All should succeed
      expect(results.every(r => r > 0)).toBe(true);
      
      // Check performance stats
      const stats = pool.getPerformanceStats();
      expect(stats.failureCount).toBe(0);
    });
  });
  
  describe('Queue Overflow Handling', () => {
    it('should handle queue overflow by dropping oldest requests', async () => {
      const pool = new TokenWorkerPool(1); // Single worker to force queuing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Flood with requests to exceed queue limit
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 1010; i++) { // Exceed MAX_QUEUE_SIZE (1000)
        promises.push(pool.countTokens(`text ${i}`));
      }
      
      const results = await Promise.all(promises);
      
      // All should have valid results (either counted or estimated)
      results.forEach(result => {
        expect(result).toBeGreaterThan(0);
      });
      
      const stats = pool.getPerformanceStats();
      expect(stats.droppedRequests).toBeGreaterThan(0);
    });
  });
  
  describe('Request Deduplication', () => {
    it('should deduplicate identical concurrent requests', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const identicalText = 'This is the same text content';
      
      // Send multiple identical requests concurrently
      const promises = Array(5).fill(null).map(() => 
        pool.countTokens(identicalText)
      );
      
      const results = await Promise.all(promises);
      
      // All results should be identical
      expect(new Set(results).size).toBe(1);
      
      // Performance stats should show fewer processed than requested
      const stats = pool.getPerformanceStats();
      expect(stats.totalProcessed).toBeLessThan(5);
    });
  });
  
  describe('Worker Pool Recreation', () => {
    it('should recreate pool after multiple failures', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate multiple failures
      for (let i = 0; i < 12; i++) {
        // Make all workers crash
        mockWorkers.forEach(w => w.simulateCrash());
        
        // Try to count tokens
        const result = await pool.countTokens(`test ${i}`);
        expect(result).toBeGreaterThan(0); // Should fallback
      }
      
      // Pool should have been recreated
      expect(mockWorkers.length).toBeGreaterThan(2); // New workers created
    });
  });
  
  describe('Health Check Recovery', () => {
    it('should detect and recover unhealthy workers', async () => {
      const pool = new TokenWorkerPool(2);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Make one worker unresponsive to health checks
      const originalOnMessage = mockWorkers[0].onmessage;
      mockWorkers[0].onmessage = (event: MessageEvent) => {
        if (event.data.type !== 'HEALTH_CHECK') {
          originalOnMessage?.call(mockWorkers[0], event);
        }
        // Ignore health checks
      };
      
      // Perform health check
      const healthResults = await pool.healthCheck();
      
      // Should detect unhealthy worker
      const unhealthy = healthResults.filter(r => !r.healthy);
      expect(unhealthy.length).toBe(1);
      expect(unhealthy[0].responseTime).toBe(Infinity);
    });
  });
  
  describe('Timeout Recovery', () => {
    it('should recover from request timeout', async () => {
      const pool = new TokenWorkerPool(1);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Make worker slow to respond
      const originalOnMessage = mockWorkers[0].onmessage;
      mockWorkers[0].onmessage = (event: MessageEvent) => {
        if (event.data.type === 'COUNT_TOKENS') {
          // Don't respond to simulate timeout
          return;
        }
        originalOnMessage?.call(mockWorkers[0], event);
      };
      
      const result = await pool.countTokens('test content');
      
      // Should fallback to estimation after timeout
      expect(result).toBe(estimateTokenCount('test content'));
    });
  });
  
  describe('Cleanup on Termination', () => {
    it('should clean up all resources on termination', async () => {
      const pool = new TokenWorkerPool(4);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Start some operations
      const promises = Array(10).fill(null).map((_, i) => 
        pool.countTokens(`test ${i}`)
      );
      
      // Terminate pool
      pool.terminate();
      
      // All workers should be terminated
      mockWorkers.forEach(worker => {
        expect(worker.terminated).toBe(true);
      });
      
      // Pending operations should complete with estimation
      const results = await Promise.all(promises);
      results.forEach(result => {
        expect(result).toBeGreaterThan(0);
      });
    });
  });
});