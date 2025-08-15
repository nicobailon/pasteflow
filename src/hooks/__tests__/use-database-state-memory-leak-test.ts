import { renderHook, act } from '@testing-library/react';

import { useDatabaseState } from '../use-database-state';

// Test constants
const TEST_CHANNEL = '/prefs/get';
const TEST_UPDATE_EVENT = 'test-update-event';

// Mock electron IPC
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();
const mockInvoke = jest.fn();

const mockElectron = {
  ipcRenderer: {
    on: mockOn,
    removeListener: mockRemoveListener,
    invoke: mockInvoke,
  },
};

// Mock window.electron
Object.defineProperty(window, 'electron', {
  value: mockElectron,
  writable: true,
});

describe('useDatabaseState Memory Leak Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Listener Management', () => {
    it('should add listener on mount and remove on unmount', () => {
      const { unmount } = renderHook(() => 
        useDatabaseState(TEST_CHANNEL, null)
      );

      // Verify listener was added
      expect(mockOn).toHaveBeenCalledWith(
        TEST_UPDATE_EVENT,
        expect.any(Function)
      );
      expect(mockOn).toHaveBeenCalledTimes(1);

      // Get the handler function that was registered
      const registeredHandler = mockOn.mock.calls[0][1];

      // Unmount the hook
      unmount();

      // Verify listener was removed with the same function
      expect(mockRemoveListener).toHaveBeenCalledWith(
        TEST_UPDATE_EVENT,
        registeredHandler
      );
      expect(mockRemoveListener).toHaveBeenCalledTimes(1);
    });

    it('should use stable function reference for listener cleanup', () => {
      const { rerender, unmount } = renderHook(
        ({ channel }) => useDatabaseState(channel, null),
        { initialProps: { channel: TEST_CHANNEL } }
      );

      const firstHandler = mockOn.mock.calls[0][1];

      // Rerender with same channel - should not add new listener
      rerender({ channel: TEST_CHANNEL });
      
      // Should still only have one listener registration
      expect(mockOn).toHaveBeenCalledTimes(1);

      unmount();

      // Should remove with the same handler
      expect(mockRemoveListener).toHaveBeenCalledWith(
        TEST_UPDATE_EVENT,
        firstHandler
      );
    });

    it('should handle channel changes correctly', () => {
      const { rerender, unmount } = renderHook(
        ({ channel }) => useDatabaseState(channel, null),
        { initialProps: { channel: TEST_CHANNEL } }
      );

      const firstHandler = mockOn.mock.calls[0][1];

      // Change channel
      rerender({ channel: '/workspace/current' });

      // Should remove old listener and add new one
      expect(mockRemoveListener).toHaveBeenCalledWith(
        TEST_UPDATE_EVENT,
        firstHandler
      );
      expect(mockOn).toHaveBeenCalledWith(
        '/workspace/current:update',
        expect.any(Function)
      );
      expect(mockOn).toHaveBeenCalledTimes(2);

      unmount();

      // Should remove the second listener
      const secondHandler = mockOn.mock.calls[1][1];
      expect(mockRemoveListener).toHaveBeenCalledWith(
        '/workspace/current:update',
        secondHandler
      );
    });
  });

  describe('Multiple Hook Instances', () => {
    it('should handle multiple hooks with same channel without interference', () => {
      const { unmount: unmount1 } = renderHook(() => 
        useDatabaseState(TEST_CHANNEL, null)
      );
      const { unmount: unmount2 } = renderHook(() => 
        useDatabaseState(TEST_CHANNEL, null)
      );
      const { unmount: unmount3 } = renderHook(() => 
        useDatabaseState(TEST_CHANNEL, null)
      );

      // Should have 3 separate listeners
      expect(mockOn).toHaveBeenCalledTimes(3);
      expect(mockOn).toHaveBeenNthCalledWith(1, TEST_UPDATE_EVENT, expect.any(Function));
      expect(mockOn).toHaveBeenNthCalledWith(2, TEST_UPDATE_EVENT, expect.any(Function));
      expect(mockOn).toHaveBeenNthCalledWith(3, TEST_UPDATE_EVENT, expect.any(Function));

      // Get all handlers
      const handler1 = mockOn.mock.calls[0][1];
      const handler2 = mockOn.mock.calls[1][1];
      const handler3 = mockOn.mock.calls[2][1];

      // Handlers should be different functions
      expect(handler1).not.toBe(handler2);
      expect(handler2).not.toBe(handler3);
      expect(handler1).not.toBe(handler3);

      // Unmount in different order
      unmount2();
      expect(mockRemoveListener).toHaveBeenCalledWith(TEST_UPDATE_EVENT, handler2);

      unmount1();
      expect(mockRemoveListener).toHaveBeenCalledWith(TEST_UPDATE_EVENT, handler1);

      unmount3();
      expect(mockRemoveListener).toHaveBeenCalledWith(TEST_UPDATE_EVENT, handler3);

      // Should have removed all 3 listeners
      expect(mockRemoveListener).toHaveBeenCalledTimes(3);
    });
  });

  describe('Update Handling', () => {
    it('should handle update broadcasts correctly', async () => {
      const { result } = renderHook(() => 
        useDatabaseState(TEST_CHANNEL, { initial: 'value' })
      );

      // Get the registered handler
      const updateHandler = mockOn.mock.calls[0][1];

      // Simulate an update broadcast
      const updatedData = { updated: 'value' };
      act(() => {
        updateHandler(null, updatedData);
      });

      // Data should be updated
      expect(result.current.data).toEqual(updatedData);
    });

    it('should clear cache on update', async () => {
      mockInvoke.mockResolvedValue({ cached: 'data' });

      const { result } = renderHook(() => 
        useDatabaseState(TEST_CHANNEL, null, { cache: true, cacheTTL: 60_000 })
      );

      // Fetch data to populate cache
      await act(async () => {
        await result.current.fetchData({ key: 'test' });
      });

      expect(result.current.data).toEqual({ cached: 'data' });

      // Get the registered handler and simulate update
      const updateHandler = mockOn.mock.calls[0][1];
      const updatedData = { updated: 'data' };
      
      act(() => {
        updateHandler(null, updatedData);
      });

      // Data should be updated and cache should be cleared
      expect(result.current.data).toEqual(updatedData);

      // Next fetch should call invoke again (cache was cleared)
      mockInvoke.mockResolvedValue({ fresh: 'data' });
      await act(async () => {
        await result.current.fetchData({ key: 'test' });
      });

      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle removeListener errors gracefully', () => {
      // Mock the electron removeListener to throw an error
      const originalRemoveListener = mockElectron.ipcRenderer.removeListener;
      mockElectron.ipcRenderer.removeListener = jest.fn(() => {
        throw new Error('Remove listener failed');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { unmount } = renderHook(() =>
        useDatabaseState(TEST_CHANNEL, null)
      );

      // Should not throw when unmounting
      expect(() => unmount()).not.toThrow();

      // Should have logged the error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error removing listener for channel /prefs/get:update:'),
        expect.any(Error)
      );

      // Restore mocks
      mockElectron.ipcRenderer.removeListener = originalRemoveListener;
      consoleSpy.mockRestore();
    });
  });
});
