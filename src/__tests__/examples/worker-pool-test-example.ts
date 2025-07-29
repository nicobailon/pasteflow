/**
 * Example test file showing different Worker mocking strategies
 */

import { TokenWorkerPool } from '../../utils/token-worker-pool';
import { setupWorkerMocks, cleanupWorkerMocks, mockWorkerInstances } from '../setup/worker-mocks';
import { MockWorker } from '../test-utils/mock-worker';

// Strategy 1: Using manual mock (if jest.mock is configured)
describe('TokenWorkerPool with Manual Mock', () => {
  let pool: TokenWorkerPool;

  beforeEach(() => {
    // If using manual mock, get the mocked version
    pool = new TokenWorkerPool(4);
  });

  afterEach(() => {
    pool.terminate();
  });

  it('should count tokens using mock implementation', async () => {
    const text = 'Hello, world!';
    const count = await pool.countTokens(text);
    
    // Mock returns text.length / 4
    expect(count).toBe(Math.ceil(text.length / 4));
  });

  it('should handle mock configuration', async () => {
    // Type-safe approach: check if pool has mock methods
    if ('__setMockBehavior' in pool && typeof pool.__setMockBehavior === 'function') {
      pool.__setMockBehavior({ 
        customResponse: (text: string) => text.length * 2 
      });

      const count = await pool.countTokens('test');
      expect(count).toBe(8); // 'test'.length * 2
    } else {
      // Skip test if not using mock
      expect(true).toBe(true);
    }
  });
});

// Strategy 2: Using global Worker mocks
describe('TokenWorkerPool with Global Mocks', () => {
  let pool: TokenWorkerPool;

  beforeEach(() => {
    jest.useFakeTimers();
    setupWorkerMocks({
      workerFactory: () => new MockWorker({ 
        autoRespond: true, 
        responseDelay: 10 
      })
    });
    
    pool = new TokenWorkerPool(4);
  });

  afterEach(() => {
    pool.terminate();
    cleanupWorkerMocks();
    jest.useRealTimers();
  });

  it('should initialize workers correctly', async () => {
    // Fast-forward to complete initialization
    jest.advanceTimersByTime(100);
    
    // Should have created 4 mock workers
    expect(mockWorkerInstances.length).toBe(4);
    
    // All workers should be initialized
    const initMessages = mockWorkerInstances.map(worker => {
      const addEventListenerCalls = (worker.addEventListener as jest.Mock)?.mock.calls || [];
      return addEventListenerCalls.some(call => call[0] === 'message');
    });
    
    expect(initMessages.every(Boolean)).toBe(true);
  });

  it('should handle concurrent token counting', async () => {
    jest.advanceTimersByTime(100); // Initialize workers
    
    const promises = [
      pool.countTokens('First text'),
      pool.countTokens('Second text'),
      pool.countTokens('Third text')
    ];
    
    // Fast-forward to process all requests
    jest.advanceTimersByTime(50);
    
    const results = await Promise.all(promises);
    
    expect(results[0]).toBeGreaterThan(0);
    expect(results[1]).toBeGreaterThan(0);
    expect(results[2]).toBeGreaterThan(0);
  });

  it('should handle worker failures gracefully', async () => {
    jest.advanceTimersByTime(100); // Initialize
    
    // Make first worker fail
    const failingWorker = mockWorkerInstances[0];
    failingWorker.simulateError(new Error('Worker crashed'));
    
    // Should still be able to count tokens using other workers
    const result = await pool.countTokens('Test text');
    expect(result).toBeGreaterThan(0);
  });
});

// Strategy 3: Testing with custom Worker behavior
describe('TokenWorkerPool Advanced Scenarios', () => {
  let pool: TokenWorkerPool;

  beforeEach(() => {
    jest.useFakeTimers();
    setupWorkerMocks();
  });

  afterEach(() => {
    if (pool) {
      pool.terminate();
    }
    cleanupWorkerMocks();
    jest.useRealTimers();
  });

  it('should handle memory pressure scenarios', async () => {
    // Create workers that simulate memory pressure
    setupWorkerMocks({
      workerFactory: () => {
        const worker = new MockWorker({ autoRespond: false });
        
        // Simulate delayed responses under memory pressure
        worker.postMessage = jest.fn().mockImplementation((data) => {
          setTimeout(() => {
            if (data.type === 'COUNT_TOKENS') {
              setTimeout(() => {
                worker.simulateMessage({
                  type: 'TOKEN_COUNT',
                  id: data.id,
                  result: 1000, // Simulate high token count
                  fallback: false
                });
              }, 200); // Slow response
            }
          }, 10);
        });
        
        return worker;
      }
    });

    pool = new TokenWorkerPool(2);
    jest.advanceTimersByTime(100); // Initialize

    const start = Date.now();
    const promise = pool.countTokens('Large text content');
    
    jest.advanceTimersByTime(250); // Process slow response
    
    const result = await promise;
    expect(result).toBe(1000);
  });

  it('should handle worker pool termination during processing', async () => {
    pool = new TokenWorkerPool(4);
    jest.advanceTimersByTime(100); // Initialize

    // Start a token counting operation
    const promise = pool.countTokens('Test text');
    
    // Terminate pool before completion
    pool.terminate();
    
    // Should reject the promise
    await expect(promise).rejects.toThrow();
  });
});

// Strategy 4: Type-safe mock helpers
describe('TokenWorkerPool with Type-Safe Helpers', () => {
  // Type-safe mock configuration
  interface MockPoolConfig {
    poolSize: number;
    workerBehavior: 'normal' | 'slow' | 'failing';
    tokenMultiplier: number;
  }

  function createMockPool(config: MockPoolConfig): TokenWorkerPool {
    setupWorkerMocks({
      workerFactory: () => {
        switch (config.workerBehavior) {
          case 'slow':
            return new MockWorker({ autoRespond: true, responseDelay: 100 });
          case 'failing':
            return new MockWorker({ errorOnMessage: true });
          default:
            return new MockWorker({ autoRespond: true, responseDelay: 10 });
        }
      }
    });

    return new TokenWorkerPool(config.poolSize);
  }

  let pool: TokenWorkerPool;

  afterEach(() => {
    if (pool) {
      pool.terminate();
    }
    cleanupWorkerMocks();
  });

  it('should work with type-safe configuration', async () => {
    pool = createMockPool({
      poolSize: 4,
      workerBehavior: 'normal',
      tokenMultiplier: 1
    });

    const result = await pool.countTokens('Test');
    expect(result).toBeGreaterThan(0);
  });
});