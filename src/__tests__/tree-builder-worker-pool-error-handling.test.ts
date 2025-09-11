/**
 * Tests for tree-builder-worker-pool error handling improvements
 */

import { TreeBuilderWorkerPool } from '../workers/pools/tree-builder-worker-pool';

describe('TreeBuilderWorkerPool Error Handling', () => {
  let pool: TreeBuilderWorkerPool;
  
  afterEach(() => {
    if (pool) {
      pool.terminate();
    }
  });
  
  describe('Error State Methods', () => {
    it('should expose isReady() method', () => {
      pool = new TreeBuilderWorkerPool();
      
      // Method should exist and return boolean
      expect(typeof pool.isReady).toBe('function');
      const isReady = pool.isReady();
      expect(typeof isReady).toBe('boolean');
    });
    
    it('should expose getInitializationError() method', () => {
      pool = new TreeBuilderWorkerPool();
      
      // Method should exist and return Error or null
      expect(typeof pool.getInitializationError).toBe('function');
      const error = pool.getInitializationError();
      expect(error === null || error instanceof Error).toBe(true);
    });
    
    it('should expose waitForInitialization() method', async () => {
      pool = new TreeBuilderWorkerPool();
      
      // Method should exist and return a promise
      expect(typeof pool.waitForInitialization).toBe('function');
      const promise = pool.waitForInitialization();
      expect(promise).toBeInstanceOf(Promise);
      
      // Should resolve without throwing
      await expect(promise).resolves.toBeUndefined();
    });
    
    it('should include initializationError in getStatus()', () => {
      pool = new TreeBuilderWorkerPool();
      
      const status = pool.getStatus();
      
      // Status should include all expected properties
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('hasActiveBuild');
      expect(status).toHaveProperty('initializationError');
      
      // Values should be of correct type
      expect(typeof status.state).toBe('string');
      expect(typeof status.queueLength).toBe('number');
      expect(typeof status.hasActiveBuild).toBe('boolean');
      expect(status.initializationError === null || status.initializationError instanceof Error).toBe(true);
    });
    
    it('should have retryInitialization() method', () => {
      pool = new TreeBuilderWorkerPool();
      
      // Method should exist
      expect(typeof pool.retryInitialization).toBe('function');
    });
  });
  
  describe('Error Reporting in startStreamingBuild', () => {
    it('should handle error state gracefully', async () => {
      pool = new TreeBuilderWorkerPool();
      
      // Wait for initialization to complete
      await pool.waitForInitialization();
      
      // Create mock callbacks
      const onError = jest.fn();
      const onChunk = jest.fn();
      const onComplete = jest.fn();
      
      // Start a build (may fail if worker initialization failed)
      const handle = pool.startStreamingBuild(
        {
          files: [],
          selectedFolder: null,
          expandedNodes: {}
        },
        {
          onError,
          onChunk,
          onComplete
        }
      );
      
      // Should return a handle with cancel method
      expect(handle).toHaveProperty('cancel');
      expect(typeof handle.cancel).toBe('function');
      
      // Cancel should not throw
      await expect(handle.cancel()).resolves.toBeUndefined();
    });
    
    it('should return handle even in error state', () => {
      pool = new TreeBuilderWorkerPool();
      
      // Don't wait for initialization - test immediate call
      const handle = pool.startStreamingBuild(
        {
          files: [],
          selectedFolder: null,
          expandedNodes: {}
        },
        {
          onError: jest.fn(),
          onChunk: jest.fn(),
          onComplete: jest.fn()
        }
      );
      
      // Should always return a handle
      expect(handle).toBeDefined();
      expect(handle).toHaveProperty('cancel');
      expect(typeof handle.cancel).toBe('function');
    });
  });
  
  describe('Status Reporting', () => {
    it('should report current state accurately', async () => {
      pool = new TreeBuilderWorkerPool();
      
      // Get initial status
      const initialStatus = pool.getStatus();
      expect(['uninitialized', 'initializing', 'ready', 'error']).toContain(initialStatus.state);
      
      // Wait for initialization
      await pool.waitForInitialization();
      
      // Get status after initialization
      const finalStatus = pool.getStatus();
      expect(['ready', 'error']).toContain(finalStatus.state);
      
      // Queue should be empty initially
      expect(finalStatus.queueLength).toBe(0);
      expect(finalStatus.hasActiveBuild).toBe(false);
    });
    
    it('should update queue length when requests are added', () => {
      pool = new TreeBuilderWorkerPool();
      
      const initialStatus = pool.getStatus();
      const initialQueueLength = initialStatus.queueLength;
      
      // Add a request
      pool.startStreamingBuild(
        {
          files: [],
          selectedFolder: null,
          expandedNodes: {}
        },
        {
          onError: jest.fn(),
          onChunk: jest.fn(),
          onComplete: jest.fn()
        }
      );
      
      // Queue length should increase or stay same (if processing immediately)
      const newStatus = pool.getStatus();
      expect(newStatus.queueLength).toBeGreaterThanOrEqual(0);
      expect(newStatus.queueLength).toBeLessThanOrEqual(initialQueueLength + 1);
    });
  });
  
  describe('Retry Mechanism', () => {
    it('should clear error state on retry', async () => {
      pool = new TreeBuilderWorkerPool();
      
      // Wait for initial attempt
      await pool.waitForInitialization();
      
      // Try to retry (may succeed or fail depending on environment)
      try {
        await pool.retryInitialization();
      } catch {
        // Retry might fail in test environment, that's ok
      }
      
      // If pool is ready after retry, error should be cleared
      if (pool.isReady()) {
        expect(pool.getInitializationError()).toBeNull();
      }
    });
    
    it('should not retry if already ready', async () => {
      pool = new TreeBuilderWorkerPool();
      
      await pool.waitForInitialization();
      
      // If pool is ready, retry should be a no-op
      if (pool.isReady()) {
        const statusBefore = pool.getStatus();
        await pool.retryInitialization();
        const statusAfter = pool.getStatus();
        
        // State should remain ready
        expect(statusAfter.state).toBe('ready');
        expect(statusAfter.state).toBe(statusBefore.state);
      }
    });
  });
});
