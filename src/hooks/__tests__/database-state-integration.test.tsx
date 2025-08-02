import { renderHook, act } from '@testing-library/react-hooks';
import { useDatabaseState } from '../use-database-state';
import { useLocalStorage } from '../use-local-storage-migrated';

// Define proper types for the mock and handlers
type IpcUpdateHandler<T> = (event: Electron.IpcRendererEvent, data: T) => void;

interface MockElectron {
  electron: {
    ipcRenderer: {
      invoke: jest.Mock;
      on: jest.Mock;
      removeListener: jest.Mock;
    };
  };
}

// Helper to check if a value is a function with specific signature
function isUpdateHandler<T>(value: unknown): value is IpcUpdateHandler<T> {
  return typeof value === 'function';
}

// Create a properly typed mock event
function createMockIpcEvent(): Electron.IpcRendererEvent {
  return {
    sender: {
      send: jest.fn()
    } as unknown as Electron.IpcRenderer,
    senderId: 1,
    ports: [],
    reply: jest.fn()
  };
}

// Setup minimal IPC mock - we'll test behavior, not the mock
const mockInvoke = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();

(global as unknown as { window: MockElectron }).window = {
  electron: {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
      removeListener: mockRemoveListener
    }
  }
};

describe('Database State Integration - Real Behavior Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useDatabaseState - State Management Behavior', () => {
    it('should manage loading states correctly during async operations', async () => {
      // Setup a delayed response to test loading states
      let resolvePromise: (value: unknown) => void;
      const delayedPromise = new Promise(resolve => { resolvePromise = resolve; });
      mockInvoke.mockReturnValueOnce(delayedPromise);

      const { result } = renderHook(() => 
        useDatabaseState('/workspace/data', { items: [] }, {})
      );

      // Initial state assertions
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual({ items: [] });
      expect(result.current.error).toBeNull();

      // Start async operation
      act(() => {
        result.current.fetchData({ workspaceId: 'test-123' });
      });

      // Should be loading now
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();

      // Resolve the promise
      act(() => {
        resolvePromise!({ items: ['file1', 'file2'] });
      });

      // Wait for state updates
      await act(async () => {
        await delayedPromise;
      });

      // Final state assertions
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual({ items: ['file1', 'file2'] });
      expect(result.current.error).toBeNull();
    });

    it('should handle concurrent requests correctly', async () => {
      // Simulate different response times
      const responses = [
        { delay: 100, data: { version: 1 } },
        { delay: 50, data: { version: 2 } },
        { delay: 150, data: { version: 3 } }
      ];

      let callCount = 0;
      mockInvoke.mockImplementation(() => {
        const response = responses[callCount++];
        return new Promise(resolve => 
          setTimeout(() => resolve(response.data), response.delay)
        );
      });

      const { result } = renderHook(() => 
        useDatabaseState('/api/data', { version: 0 }, {})
      );

      // Fire multiple requests
      const promises = await act(async () => {
        return Promise.all([
          result.current.fetchData(),
          result.current.fetchData(),
          result.current.fetchData()
        ]);
      });

      // Should get the last completed request's data
      expect(promises[2]).toEqual({ version: 3 });
      expect(result.current.data).toEqual({ version: 3 });
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });

    it('should implement cache expiration correctly', async () => {
      const mockData = { content: 'cached-data', timestamp: Date.now() };
      mockInvoke.mockResolvedValue(mockData);

      const { result } = renderHook(() => 
        useDatabaseState('/cached/endpoint', null, {
          cache: true,
          cacheTTL: 100 // 100ms TTL
        })
      );

      // First fetch - should hit backend
      await act(async () => {
        const data1 = await result.current.fetchData({ id: 'same-params' });
        expect(data1).toEqual(mockData);
      });

      expect(mockInvoke).toHaveBeenCalledTimes(1);

      // Immediate second fetch - should use cache
      await act(async () => {
        const data2 = await result.current.fetchData({ id: 'same-params' });
        expect(data2).toEqual(mockData);
      });

      expect(mockInvoke).toHaveBeenCalledTimes(1); // No new call

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third fetch - cache expired, should hit backend again
      await act(async () => {
        const data3 = await result.current.fetchData({ id: 'same-params' });
        expect(data3).toEqual(mockData);
      });

      expect(mockInvoke).toHaveBeenCalledTimes(2); // New call made
    });

    it('should handle optimistic updates with rollback on failure', async () => {
      const initialData = { 
        items: ['item1', 'item2'],
        total: 2 
      };

      // First call succeeds, second fails
      mockInvoke
        .mockResolvedValueOnce(true) // update succeeds
        .mockResolvedValueOnce(initialData) // refresh returns original
        .mockRejectedValueOnce(new Error('Network error')) // update fails
        .mockResolvedValueOnce(initialData); // rollback refresh

      const { result } = renderHook(() => 
        useDatabaseState('/items', initialData, { optimisticUpdate: true })
      );

      // Successful optimistic update
      await act(async () => {
        const updatePromise = result.current.updateData(
          '/items/add',
          { item: 'item3' },
          { items: ['item1', 'item2', 'item3'], total: 3 }
        );

        // Should immediately show optimistic data
        expect(result.current.data.items).toHaveLength(3);
        expect(result.current.data.total).toBe(3);

        await updatePromise;
      });

      // Failed optimistic update with rollback
      await act(async () => {
        try {
          const failedPromise = result.current.updateData(
            '/items/add',
            { item: 'item4' },
            { items: ['item1', 'item2', 'item3', 'item4'], total: 4 }
          );

          // Should show optimistic data initially
          expect(result.current.data.items).toHaveLength(4);

          await failedPromise;
        } catch (error) {
          // After failure, should rollback to server state
          expect(result.current.data).toEqual(initialData);
          expect(result.current.error).toEqual(new Error('Network error'));
        }
      });
    });
  });

  describe('useLocalStorage - Database Migration Behavior', () => {
    beforeEach(() => {
      // Setup real localStorage behavior
      const store: Record<string, string> = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: jest.fn(key => store[key] || null),
          setItem: jest.fn((key, value) => { store[key] = value; }),
          removeItem: jest.fn(key => { delete store[key]; }),
          clear: jest.fn(() => { Object.keys(store).forEach(key => delete store[key]); })
        },
        writable: true
      });
    });

    it('should handle complex data migration from localStorage to database', async () => {
      // Setup complex data in localStorage
      const complexData = {
        user: { id: '123', name: 'Test User' },
        preferences: { theme: 'dark', language: 'en' },
        nested: { deep: { value: 42 } }
      };
      localStorage.setItem('complex-key', JSON.stringify(complexData));

      // Mock database responses
      mockInvoke
        .mockResolvedValueOnce(null) // Not in database yet
        .mockResolvedValueOnce(true); // Save succeeds

      const { result, waitForNextUpdate } = renderHook(() => 
        useLocalStorage('complex-key', {})
      );

      await waitForNextUpdate();

      // Verify migration happened correctly
      expect(mockInvoke).toHaveBeenCalledWith('/prefs/get', { key: 'complex-key' });
      expect(mockInvoke).toHaveBeenCalledWith('/prefs/set', {
        key: 'complex-key',
        value: complexData,
        encrypted: false
      });

      // Verify data is available in hook
      expect(result.current[0]).toEqual(complexData);
      expect(localStorage.getItem).toHaveBeenCalledWith('complex-key');
    });

    it('should handle special string formats without JSON parsing', async () => {
      const testCases = [
        { 
          stored: '/Users/test/file.txt',
          initial: '', 
          description: 'Unix file path'
        },
        { 
          stored: 'C:\\Windows\\System32\\file.dll',
          initial: '', 
          description: 'Windows file path'
        },
        { 
          stored: 'simple plain text value',
          initial: '', 
          description: 'Plain string'
        }
      ];

      for (const testCase of testCases) {
        localStorage.setItem('path-key', testCase.stored);
        mockInvoke
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(true);

        const { result, waitForNextUpdate } = renderHook(() => 
          useLocalStorage('path-key', testCase.initial)
        );

        await waitForNextUpdate();

        // Verify exact string preservation
        expect(result.current[0]).toBe(testCase.stored);
        expect(mockInvoke).toHaveBeenCalledWith('/prefs/set', {
          key: 'path-key',
          value: testCase.stored,
          encrypted: false
        });

        // Clean up for next iteration
        jest.clearAllMocks();
      }
    });

    it('should provide consistent state updates with function setters', async () => {
      mockInvoke
        .mockResolvedValueOnce(5) // Initial value from DB
        .mockResolvedValue(true); // All updates succeed

      const { result, waitForNextUpdate } = renderHook(() => 
        useLocalStorage<number>('counter', 0)
      );

      await waitForNextUpdate();

      expect(result.current[0]).toBe(5);

      // Test multiple sequential updates
      const updates = [1, 2, 3, 4, 5];
      for (const increment of updates) {
        await act(async () => {
          result.current[1](prev => prev + increment);
        });
      }

      // Final value should be sum of all increments
      const expectedFinal = 5 + updates.reduce((a, b) => a + b, 0);
      expect(result.current[0]).toBe(expectedFinal);

      // Verify all saves were attempted
      expect(mockInvoke.mock.calls.filter(call => call[0] === '/prefs/set')).toHaveLength(5);
    });

    it('should handle database errors gracefully without data loss', async () => {
      const testValue = { important: 'data' };
      localStorage.setItem('critical-key', JSON.stringify(testValue));

      // Database operations fail
      mockInvoke
        .mockRejectedValueOnce(new Error('DB connection failed')) // Get fails
        .mockRejectedValueOnce(new Error('DB write failed')); // Set fails

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const { result, waitForNextUpdate } = renderHook(() => 
        useLocalStorage('critical-key', null)
      );

      // Even with DB errors, localStorage data should be available
      await act(async () => {
        // Wait a bit for async operations
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      expect(result.current[0]).toEqual(testValue);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toContain('Error loading preference');

      consoleSpy.mockRestore();
    });

    it('should handle rapid sequential updates correctly', async () => {
      mockInvoke.mockResolvedValue(true);

      const { result } = renderHook(() => 
        useLocalStorage<string[]>('list-key', [])
      );

      // Perform rapid updates
      const items = ['a', 'b', 'c', 'd', 'e'];
      await act(async () => {
        for (const item of items) {
          result.current[1](prev => [...prev, item]);
        }
      });

      // Final state should contain all items
      expect(result.current[0]).toEqual(items);
      
      // Verify the final save has all items
      const lastSetCall = mockInvoke.mock.calls
        .filter(call => call[0] === '/prefs/set')
        .pop();
      
      expect(lastSetCall![1].value).toEqual(items);
    });
  });

  describe('Real-time updates and subscriptions', () => {
    it('should handle cross-window updates correctly', () => {
      const { result: hook1 } = renderHook(() => 
        useDatabaseState('/shared/data', { count: 0 }, {})
      );

      const { result: hook2 } = renderHook(() => 
        useDatabaseState('/shared/data', { count: 0 }, {})
      );

      // Both hooks should subscribe to updates
      expect(mockOn).toHaveBeenCalledTimes(2);
      expect(mockOn.mock.calls[0][0]).toBe('/shared/data:update');
      expect(mockOn.mock.calls[1][0]).toBe('/shared/data:update');
      
      // Verify handlers are functions
      const handler1 = mockOn.mock.calls[0][1];
      const handler2 = mockOn.mock.calls[1][1];
      expect(isUpdateHandler<{ count: number }>(handler1)).toBe(true);
      expect(isUpdateHandler<{ count: number }>(handler2)).toBe(true);
      
      // Type-safe casting after verification
      const typedHandler1 = handler1 as IpcUpdateHandler<{ count: number }>;
      const typedHandler2 = handler2 as IpcUpdateHandler<{ count: number }>;

      // Simulate a cross-window update
      const updateData = { count: 42 };
      const mockEvent = createMockIpcEvent();
      act(() => {
        typedHandler1(mockEvent, updateData);
        typedHandler2(mockEvent, updateData);
      });

      // Both hooks should reflect the update
      expect(hook1.current.data).toEqual(updateData);
      expect(hook2.current.data).toEqual(updateData);
    });

    it('should cleanup subscriptions properly to prevent memory leaks', () => {
      const { result, rerender, unmount } = renderHook(
        ({ channel }) => useDatabaseState(channel, {}, {}),
        { initialProps: { channel: '/test/1' } }
      );

      // Initial subscription
      expect(mockOn).toHaveBeenCalledTimes(1);
      expect(mockOn.mock.calls[0][0]).toBe('/test/1:update');
      const initialHandler = mockOn.mock.calls[0][1];
      expect(isUpdateHandler(initialHandler)).toBe(true);

      // Change channel - should cleanup old and subscribe to new
      rerender({ channel: '/test/2' });

      expect(mockRemoveListener).toHaveBeenCalledTimes(1);
      expect(mockRemoveListener.mock.calls[0][0]).toBe('/test/1:update');
      expect(mockRemoveListener.mock.calls[0][1]).toBe(initialHandler);
      
      expect(mockOn).toHaveBeenCalledTimes(2);
      expect(mockOn.mock.calls[1][0]).toBe('/test/2:update');
      const newHandler = mockOn.mock.calls[1][1];
      expect(isUpdateHandler(newHandler)).toBe(true);

      // Unmount - should cleanup final subscription
      unmount();

      expect(mockRemoveListener).toHaveBeenCalledTimes(2);
      expect(mockRemoveListener.mock.calls[1][0]).toBe('/test/2:update');
      expect(mockRemoveListener.mock.calls[1][1]).toBe(newHandler);
    });
  });
});