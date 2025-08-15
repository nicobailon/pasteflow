import { renderHook, act } from '@testing-library/react';

import { usePersistentState } from '../use-persistent-state';

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

describe('Preference Update Broadcasting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Multiple usePersistentState Hooks', () => {
    it('should register multiple listeners for /prefs/get:update without memory leak', () => {
      // Simulate multiple components using usePersistentState
      const hook1 = renderHook(() => usePersistentState('theme', 'light'));
      const hook2 = renderHook(() => usePersistentState('sortOrder', 'name'));
      const hook3 = renderHook(() => usePersistentState('searchTerm', ''));

      // Each hook should register a listener for /prefs/get:update
      expect(mockOn).toHaveBeenCalledTimes(3);
      expect(mockOn).toHaveBeenNthCalledWith(1, '/prefs/get:update', expect.any(Function));
      expect(mockOn).toHaveBeenNthCalledWith(2, '/prefs/get:update', expect.any(Function));
      expect(mockOn).toHaveBeenNthCalledWith(3, '/prefs/get:update', expect.any(Function));

      // Cleanup should remove all listeners
      hook1.unmount();
      hook2.unmount();
      hook3.unmount();

      expect(mockRemoveListener).toHaveBeenCalledTimes(3);
    });

    it('should handle preference updates across multiple hooks', async () => {
      mockInvoke.mockResolvedValue(null); // Return null initially

      const hook1 = renderHook(() => usePersistentState('theme', 'light'));
      const hook2 = renderHook(() => usePersistentState('sortOrder', 'name'));

      // Wait for initial loads
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Should use initial values since database returned null
      expect(hook1.result.current[0]).toBe('light');
      expect(hook2.result.current[0]).toBe('name');

      // Get the update handlers
      const updateHandler1 = mockOn.mock.calls[0][1];
      const updateHandler2 = mockOn.mock.calls[1][1];

      // Verify that update handlers are functions and can be called
      expect(typeof updateHandler1).toBe('function');
      expect(typeof updateHandler2).toBe('function');

      // Simulate a preference update broadcast
      await act(async () => {
        // Call the handlers - this should trigger cache clear and refetch
        updateHandler1(null);
        updateHandler2(null);
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // The main test is that the handlers can be called without error
      // and that listeners are properly managed
      expect(mockOn).toHaveBeenCalledTimes(2);
      expect(mockOn).toHaveBeenCalledWith('/prefs/get:update', expect.any(Function));
    });
  });

  describe('Preference Setting and Broadcasting', () => {
    it('should call /prefs/set when setting values', async () => {
      mockInvoke.mockResolvedValue(true);

      const { result } = renderHook(() => usePersistentState('testKey', 'initial'));

      await act(async () => {
        result.current[1]('newValue');
      });

      expect(mockInvoke).toHaveBeenCalledWith('/prefs/set', {
        key: 'testKey',
        value: 'newValue',
        encrypted: false
      });
    });

    it('should handle functional updates correctly', async () => {
      mockInvoke.mockImplementation((channel) => {
        if (channel === '/prefs/get') {
          return Promise.resolve(5);
        }
        return Promise.resolve(true);
      });

      const { result } = renderHook(() => usePersistentState('counter', 0));

      // Wait for initial load
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      await act(async () => {
        result.current[1](prev => prev + 1);
      });

      expect(mockInvoke).toHaveBeenCalledWith('/prefs/set', {
        key: 'counter',
        value: 6,
        encrypted: false
      });
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not accumulate listeners when components remount', () => {
      // Mount and unmount multiple times
      for (let i = 0; i < 5; i++) {
        const hook = renderHook(() => usePersistentState('testKey', 'value'));
        hook.unmount();
      }

      // Should have equal number of adds and removes
      expect(mockOn).toHaveBeenCalledTimes(5);
      expect(mockRemoveListener).toHaveBeenCalledTimes(5);

      // Each remove should use the same handler that was added
      for (let i = 0; i < 5; i++) {
        const addedHandler = mockOn.mock.calls[i][1];
        const removedHandler = mockRemoveListener.mock.calls[i][1];
        expect(addedHandler).toBe(removedHandler);
      }
    });

    it('should handle rapid mount/unmount cycles', () => {
      const hooks = [];

      // Rapidly mount multiple hooks
      for (let i = 0; i < 10; i++) {
        hooks.push(renderHook(() => usePersistentState(`key${i}`, `value${i}`)));
      }

      expect(mockOn).toHaveBeenCalledTimes(10);

      // Rapidly unmount in reverse order
      for (let i = 9; i >= 0; i--) {
        hooks[i].unmount();
      }

      expect(mockRemoveListener).toHaveBeenCalledTimes(10);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle IPC errors gracefully', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC Error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { result } = renderHook(() => usePersistentState('testKey', 'initial'));

      await act(async () => {
        result.current[1]('newValue');
      });

      // Should not throw and should log error
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle invalid keys gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Test with empty key
      const { result } = renderHook(() => usePersistentState('', 'value'));

      await act(async () => {
        result.current[1]('newValue');
      });

      // Should still update the local state even with invalid key
      expect(result.current[0]).toBe('newValue');
      consoleSpy.mockRestore();
    });
  });
});
