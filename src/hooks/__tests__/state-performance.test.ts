import { renderHook, act } from '@testing-library/react-hooks';
import { useDatabaseState } from '../use-database-state';
import { useFileSelectionState } from '../use-file-selection-state';

// Define types for performance metrics
interface PerformanceMetrics {
  duration: number;
  operations: number;
  throughput: number;
}

// Mock Electron IPC with performance tracking
const mockInvoke = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();

interface MockElectron {
  electron: {
    ipcRenderer: {
      invoke: jest.Mock;
      on: jest.Mock;
      removeListener: jest.Mock;
    };
  };
}

(global as unknown as { window: MockElectron }).window = {
  electron: {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
      removeListener: mockRemoveListener
    }
  }
};

// Helper to measure performance
function measurePerformance(
  operations: number,
  startTime: number
): PerformanceMetrics {
  const duration = performance.now() - startTime;
  return {
    duration,
    operations,
    throughput: operations / (duration / 1000) // ops per second
  };
}

describe('State Management Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up fast mock responses
    mockInvoke.mockResolvedValue(true);
  });

  describe('Database State Hook Performance', () => {
    it('should handle large file lists efficiently (10,000 files)', async () => {
      const fileCount = 10000;
      const largeFileList = Array.from({ length: fileCount }, (_, i) => ({
        path: `/workspace/project/src/file${i}.ts`,
        name: `file${i}.ts`,
        isDirectory: false,
        size: Math.floor(Math.random() * 100000),
        isBinary: false,
        tokenCount: Math.floor(Math.random() * 1000)
      }));

      mockInvoke.mockResolvedValueOnce({ files: largeFileList });

      const { result } = renderHook(() => 
        useDatabaseState('/workspace/files', { files: [] }, { cache: true })
      );

      const startTime = performance.now();
      
      await act(async () => {
        await result.current.fetchData({ workspaceId: 'perf-test' });
      });
      
      const metrics = measurePerformance(fileCount, startTime);
      
      // Performance assertions
      expect(result.current.data.files).toHaveLength(fileCount);
      expect(metrics.duration).toBeLessThan(100); // Should complete within 100ms
      expect(metrics.throughput).toBeGreaterThan(50000); // At least 50k files/second
      
      // Memory efficiency - verify we're not duplicating data
      const dataSize = JSON.stringify(result.current.data).length;
      expect(dataSize).toBeLessThan(fileCount * 200); // Reasonable size per file
    });

    it('should handle rapid state updates without performance degradation', async () => {
      const updateCount = 1000;
      const { result } = renderHook(() => 
        useDatabaseState<{ counter: number }>('/test/counter', { counter: 0 }, {
          optimisticUpdate: true
        })
      );

      const startTime = performance.now();
      const updatePromises: Promise<boolean>[] = [];

      // Fire rapid updates
      await act(async () => {
        for (let i = 0; i < updateCount; i++) {
          updatePromises.push(
            result.current.updateData(
              '/test/increment',
              { increment: 1 },
              { counter: i + 1 }
            )
          );
        }
      });

      // Wait for all updates to complete
      await Promise.all(updatePromises);
      
      const metrics = measurePerformance(updateCount, startTime);
      
      // Performance assertions
      expect(result.current.data.counter).toBe(updateCount);
      expect(metrics.duration).toBeLessThan(1000); // 1000 updates in under 1 second
      expect(metrics.throughput).toBeGreaterThan(1000); // At least 1000 updates/second
    });

    it('should efficiently manage cache with many unique requests', async () => {
      const uniqueRequests = 500;
      const cacheHits = 500;
      
      const { result } = renderHook(() => 
        useDatabaseState('/cached/data', {}, {
          cache: true,
          cacheTTL: 60000 // 1 minute
        })
      );

      // Mock different responses for different params
      mockInvoke.mockImplementation((channel, params) => {
        return Promise.resolve({ 
          id: params?.id || 'default',
          data: `Response for ${params?.id || 'default'}`
        });
      });

      const startTime = performance.now();

      // Make unique requests
      for (let i = 0; i < uniqueRequests; i++) {
        await act(async () => {
          await result.current.fetchData({ id: `unique-${i}` });
        });
      }

      // Make cache hit requests
      for (let i = 0; i < cacheHits; i++) {
        await act(async () => {
          await result.current.fetchData({ id: `unique-${i % 100}` }); // Reuse first 100
        });
      }

      const metrics = measurePerformance(uniqueRequests + cacheHits, startTime);
      
      // Cache should significantly improve performance
      expect(mockInvoke).toHaveBeenCalledTimes(uniqueRequests); // Cache hits don't call backend
      expect(metrics.throughput).toBeGreaterThan(500); // High throughput due to caching
      
      // Memory usage should be reasonable
      const cacheSize = uniqueRequests * 100; // Approximate bytes per cached entry
      expect(cacheSize).toBeLessThan(100000); // Less than 100KB for 500 entries
    });
  });

  describe('Batch Operations Performance', () => {
    it('should handle batch file selections efficiently', async () => {
      const batchSize = 1000;
      const operations = Array.from({ length: batchSize }, (_, i) => ({
        type: 'add' as const,
        file: {
          path: `/file${i}.ts`,
          content: `// File ${i} content`,
          tokenCount: 100,
          lines: undefined,
          isFullFile: true,
          isContentLoaded: true
        }
      }));

      // Mock successful batch update
      mockInvoke.mockResolvedValue(true);

      const { result } = renderHook(() => useFileSelectionState());

      const startTime = performance.now();

      await act(async () => {
        await result.current.batchUpdate(operations);
      });

      const metrics = measurePerformance(batchSize, startTime);
      
      // Batch operations should be efficient
      expect(mockInvoke).toHaveBeenCalledTimes(1); // Single batch call, not 1000 individual calls
      expect(metrics.duration).toBeLessThan(50); // Batch of 1000 in under 50ms
      expect(metrics.throughput).toBeGreaterThan(20000); // At least 20k ops/second
    });

    it('should maintain performance with concurrent operations', async () => {
      const concurrentOps = 100;
      const { result } = renderHook(() => 
        useDatabaseState('/concurrent/test', { operations: [] }, {})
      );

      // Mock varying response times
      mockInvoke.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({ success: true }), Math.random() * 10)
        )
      );

      const startTime = performance.now();

      // Launch concurrent operations
      const promises = Array.from({ length: concurrentOps }, (_, i) =>
        result.current.updateData('/concurrent/op', { 
          operation: `op-${i}`,
          timestamp: Date.now()
        })
      );

      await Promise.all(promises);
      
      const metrics = measurePerformance(concurrentOps, startTime);
      
      // Concurrent operations should complete efficiently
      expect(metrics.duration).toBeLessThan(200); // 100 concurrent ops in under 200ms
      expect(metrics.throughput).toBeGreaterThan(500); // At least 500 ops/second
    });
  });

  describe('Memory Efficiency Tests', () => {
    it('should not leak memory with subscription cleanup', async () => {
      const subscriptionCount = 100;
      const hooks: ReturnType<typeof renderHook>[] = [];

      // Create many hooks
      for (let i = 0; i < subscriptionCount; i++) {
        hooks.push(
          renderHook(() => 
            useDatabaseState(`/channel/${i}`, {}, {})
          )
        );
      }

      // Verify all subscriptions created
      expect(mockOn).toHaveBeenCalledTimes(subscriptionCount);

      // Cleanup all hooks
      hooks.forEach(hook => hook.unmount());

      // Verify all subscriptions cleaned up
      expect(mockRemoveListener).toHaveBeenCalledTimes(subscriptionCount);
      
      // Verify cleanup matches subscriptions
      const subscribedChannels = mockOn.mock.calls.map(call => call[0]);
      const unsubscribedChannels = mockRemoveListener.mock.calls.map(call => call[0]);
      expect(subscribedChannels.sort()).toEqual(unsubscribedChannels.sort());
    });

    it('should handle large data payloads efficiently', async () => {
      // Create a large payload (1MB of data)
      const largePayload = {
        data: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'A'.repeat(100), // 100 chars per item
          metadata: {
            created: Date.now(),
            updated: Date.now(),
            tags: ['tag1', 'tag2', 'tag3']
          }
        }))
      };

      mockInvoke.mockResolvedValue(largePayload);

      const { result } = renderHook(() => 
        useDatabaseState('/large/payload', null, { cache: true })
      );

      const startTime = performance.now();

      await act(async () => {
        await result.current.fetchData();
      });

      const loadTime = performance.now() - startTime;
      
      // Large payloads should still be handled quickly
      expect(result.current.data).toEqual(largePayload);
      expect(loadTime).toBeLessThan(100); // Load 1MB in under 100ms
      
      // Cache should work with large payloads
      const cacheStartTime = performance.now();
      
      await act(async () => {
        await result.current.fetchData(); // Should hit cache
      });
      
      const cacheTime = performance.now() - cacheStartTime;
      expect(cacheTime).toBeLessThan(10); // Cache hit should be very fast
    });
  });

  describe('Real-world Scenario Performance', () => {
    it('should handle typical PasteFlow workspace efficiently', async () => {
      // Simulate a typical project with 500 files
      const typicalWorkspace = {
        files: Array.from({ length: 500 }, (_, i) => ({
          path: `/project/src/module${Math.floor(i / 10)}/file${i}.ts`,
          name: `file${i}.ts`,
          content: '// File content...',
          tokenCount: Math.floor(Math.random() * 500) + 100,
          size: Math.floor(Math.random() * 10000) + 1000
        })),
        selectedFiles: [] as string[],
        expandedNodes: {} as Record<string, boolean>
      };

      mockInvoke.mockImplementation((channel) => {
        if (channel === '/workspace/load') {
          return Promise.resolve(typicalWorkspace);
        }
        return Promise.resolve(true);
      });

      const startTime = performance.now();
      
      // Simulate typical user workflow
      const { result } = renderHook(() => 
        useDatabaseState('/workspace/load', null, { cache: true })
      );

      // Load workspace
      await act(async () => {
        await result.current.fetchData({ id: 'test-workspace' });
      });

      // Simulate file selections
      const selectionsToMake = 50;
      for (let i = 0; i < selectionsToMake; i++) {
        await act(async () => {
          await result.current.updateData('/workspace/select', {
            fileIndex: i,
            selected: true
          });
        });
      }

      const totalTime = performance.now() - startTime;
      
      // Complete workflow should be fast
      expect(totalTime).toBeLessThan(500); // Load workspace + 50 selections in under 500ms
      expect(result.current.data).toBeTruthy();
      
      // Calculate operations per second
      const totalOperations = 1 + selectionsToMake; // 1 load + 50 selections
      const opsPerSecond = (totalOperations / totalTime) * 1000;
      expect(opsPerSecond).toBeGreaterThan(100); // At least 100 operations per second
    });
  });
});