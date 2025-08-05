import { renderHook, act, waitFor } from '@testing-library/react';

import { usePersistentState } from '../use-persistent-state';

// Mock the useDatabaseState hook
const mockUpdateData = jest.fn<Promise<boolean>, [string, { key: string; value: unknown; encrypted?: boolean }]>();
const mockFetchData = jest.fn<Promise<unknown>, [{ key: string }]>();

jest.mock('../use-database-state', () => ({
  useDatabaseState: jest.fn(() => ({
    updateData: mockUpdateData,
    fetchData: mockFetchData
  }))
}));

describe('usePersistentState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    mockUpdateData.mockResolvedValue(true);
    mockFetchData.mockResolvedValue(null);
  });

  describe('Basic Functionality', () => {
    it('should return initial value when no persisted value exists', async () => {
      const initialValue = 'initial';
      mockFetchData.mockResolvedValueOnce(null);

      const { result } = renderHook(() => 
        usePersistentState('test-key', initialValue)
      );

      expect(result.current[0]).toBe(initialValue);
    });

    it('should return persisted value when it exists', async () => {
      const persistedValue = 'persisted';
      const initialValue = 'initial';
      
      mockFetchData.mockResolvedValueOnce(persistedValue);

      const { result } = renderHook(() => 
        usePersistentState('test-key', initialValue)
      );

      await waitFor(() => {
        expect(result.current[0]).toBe(persistedValue);
      });
    });

    it('should persist value when setValue is called', async () => {
      const { result } = renderHook(() => 
        usePersistentState('test-key', 'initial')
      );

      const newValue = 'new value';

      await act(async () => {
        result.current[1](newValue);
      });

      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'test-key',
        value: newValue,
        encrypted: false
      });

      expect(result.current[0]).toBe(newValue);
    });

    it('should handle functional updates', async () => {
      mockFetchData.mockResolvedValueOnce(5);

      const { result } = renderHook(() => 
        usePersistentState('counter', 0)
      );

      await waitFor(() => {
        expect(result.current[0]).toBe(5);
      });

      await act(async () => {
        result.current[1](prev => prev + 1);
      });

      expect(result.current[0]).toBe(6);
      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'counter',
        value: 6,
        encrypted: false
      });
    });
  });

  describe('Data Types Support', () => {
    it('should handle string values', async () => {
      const stringValue = 'test string';
      
      const { result } = renderHook(() => 
        usePersistentState('string-test', '')
      );

      await act(async () => {
        result.current[1](stringValue);
      });

      expect(result.current[0]).toBe(stringValue);
      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'string-test',
        value: stringValue,
        encrypted: false
      });
    });

    it('should handle number values', async () => {
      const numberValue = 42.5;
      
      const { result } = renderHook(() => 
        usePersistentState('number-test', 0)
      );

      await act(async () => {
        result.current[1](numberValue);
      });

      expect(result.current[0]).toBe(numberValue);
      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'number-test',
        value: numberValue,
        encrypted: false
      });
    });

    it('should handle boolean values', async () => {
      const booleanValue = true;
      
      const { result } = renderHook(() => 
        usePersistentState('boolean-test', false)
      );

      await act(async () => {
        result.current[1](booleanValue);
      });

      expect(result.current[0]).toBe(booleanValue);
      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'boolean-test',
        value: booleanValue,
        encrypted: false
      });
    });

    it('should handle array values', async () => {
      const arrayValue = ['item1', 'item2', 'item3'];
      
      const { result } = renderHook(() => 
        usePersistentState<string[]>('array-test', [])
      );

      await act(async () => {
        result.current[1](arrayValue);
      });

      expect(result.current[0]).toEqual(arrayValue);
      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'array-test',
        value: arrayValue,
        encrypted: false
      });
    });

    it('should handle object values', async () => {
      interface TestObject {
        name: string;
        count: number;
        enabled: boolean;
        settings: {
          theme: string;
          notifications: boolean;
        };
      }

      const objectValue: TestObject = {
        name: 'test',
        count: 10,
        enabled: true,
        settings: {
          theme: 'dark',
          notifications: false
        }
      };
      
      const { result } = renderHook(() => 
        usePersistentState<TestObject>('object-test', {
          name: '',
          count: 0,
          enabled: false,
          settings: { theme: 'light', notifications: true }
        })
      );

      await act(async () => {
        result.current[1](objectValue);
      });

      expect(result.current[0]).toEqual(objectValue);
      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'object-test',
        value: objectValue,
        encrypted: false
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockFetchData.mockRejectedValueOnce(new Error('Fetch failed'));

      const { result } = renderHook(() => 
        usePersistentState('error-test', 'default')
      );

      await waitFor(() => {
        expect(result.current[0]).toBe('default');
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading preference "error-test"'),
        expect.objectContaining({ message: 'Fetch failed' })
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle save errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockUpdateData.mockRejectedValueOnce(new Error('Save failed'));

      const { result } = renderHook(() => 
        usePersistentState('save-error-test', 'initial')
      );

      await act(async () => {
        result.current[1]('new value');
      });

      // Value should still be updated locally
      expect(result.current[0]).toBe('new value');

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error saving preference "save-error-test"'),
          expect.objectContaining({ message: 'Save failed' })
        );
      });
      
      consoleSpy.mockRestore();
    });

    it('should handle invalid key gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const { result } = renderHook(() => 
        usePersistentState('', 'default')
      );

      expect(result.current[0]).toBe('default');
      expect(consoleSpy).toHaveBeenCalledWith('usePersistentState: No key provided');
      
      consoleSpy.mockRestore();
    });

    it('should not save when key is invalid', async () => {
      const { result } = renderHook(() => 
        usePersistentState('', 'initial')
      );

      await act(async () => {
        result.current[1]('new value');
      });

      expect(mockUpdateData).not.toHaveBeenCalled();
      expect(result.current[0]).toBe('new value');
    });

    it('should handle key validation errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockFetchData.mockRejectedValueOnce({
        message: 'key is required'
      });

      const { result } = renderHook(() => 
        usePersistentState('valid-key', 'default')
      );

      await waitFor(() => {
        expect(result.current[0]).toBe('default');
      });

      // Should not log error for key validation issues
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Change Detection and Optimization', () => {
    it('should not trigger save when value has not changed', async () => {
      const initialValue = { count: 5, name: 'test' };
      
      const { result } = renderHook(() => 
        usePersistentState('optimization-test', initialValue)
      );

      await act(async () => {
        // Set the exact same value
        result.current[1]({ count: 5, name: 'test' });
      });

      // Should not call updateData because value hasn't changed
      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    it('should trigger save when value has changed', async () => {
      const initialValue = { count: 5, name: 'test' };
      
      const { result } = renderHook(() => 
        usePersistentState('change-test', initialValue)
      );

      await act(async () => {
        result.current[1]({ count: 6, name: 'test' });
      });

      expect(mockUpdateData).toHaveBeenCalledWith('/prefs/set', {
        key: 'change-test',
        value: { count: 6, name: 'test' },
        encrypted: false
      });
    });

    it('should handle deep object changes correctly', async () => {
      const initialValue = {
        settings: {
          theme: 'dark',
          features: { autoSave: true, linting: false }
        }
      };
      
      const { result } = renderHook(() => 
        usePersistentState('deep-change-test', initialValue)
      );

      await act(async () => {
        result.current[1]({
          settings: {
            theme: 'dark',
            features: { autoSave: false, linting: false }
          }
        });
      });

      expect(mockUpdateData).toHaveBeenCalledTimes(1);
    });
  });

  describe('Initialization Behavior', () => {
    it('should show initialized state correctly', async () => {
      const { result } = renderHook(() => 
        usePersistentState('init-test', 'initial')
      );

      // Before initialization
      expect(result.current[0]).toBe('initial');

      // After initialization (should still be initial since no persisted value)
      await waitFor(() => {
        expect(result.current[0]).toBe('initial');
      });
    });

    it('should handle rapid successive key changes', async () => {
      const { result, rerender } = renderHook(
        ({ key }) => usePersistentState(key, 'default'),
        { initialProps: { key: 'key1' } }
      );

      expect(result.current[0]).toBe('default');

      rerender({ key: 'key2' });
      rerender({ key: 'key3' });

      expect(mockFetchData).toHaveBeenCalledWith({ key: 'key1' });
      expect(mockFetchData).toHaveBeenCalledWith({ key: 'key2' });
      expect(mockFetchData).toHaveBeenCalledWith({ key: 'key3' });
    });

    it('should handle undefined/null key types correctly', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const { result } = renderHook(() => 
        usePersistentState(undefined as unknown as string, 'default')
      );

      expect(result.current[0]).toBe('default');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple setValue calls correctly', async () => {
      const { result } = renderHook(() => 
        usePersistentState('concurrent-test', 0)
      );

      await act(async () => {
        // Fire multiple updates rapidly
        result.current[1](1);
        result.current[1](2);
        result.current[1](3);
      });

      expect(result.current[0]).toBe(3);
      expect(mockUpdateData).toHaveBeenCalledTimes(3);
    });

    it('should handle functional updates with stale closures', async () => {
      const { result } = renderHook(() => 
        usePersistentState('closure-test', 0)
      );

      // Create multiple functions that increment from 0
      const increment1 = () => result.current[1](prev => prev + 1);
      const increment2 = () => result.current[1](prev => prev + 1);

      await act(async () => {
        increment1();
      });

      expect(result.current[0]).toBe(1);

      await act(async () => {
        increment2();
      });

      expect(result.current[0]).toBe(2);
    });
  });

  describe('Memory and Performance', () => {
    it('should not create infinite loops with setValue', async () => {
      const { result } = renderHook(() => 
        usePersistentState('loop-test', { count: 0 })
      );

      let callCount = 0;
      mockUpdateData.mockImplementation(async () => {
        callCount++;
        if (callCount > 10) {
          throw new Error('Potential infinite loop detected');
        }
        return true;
      });

      await act(async () => {
        result.current[1]({ count: 1 });
      });

      expect(callCount).toBe(1);
    });

    it('should handle large objects efficiently', async () => {
      const largeObject = {
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          metadata: {
            description: `Description for item ${i}`.repeat(10),
            tags: Array.from({ length: 10 }, (_, j) => `tag${i}-${j}`)
          }
        }))
      };

      const { result } = renderHook(() => 
        usePersistentState('large-object-test', { data: [] })
      );

      const startTime = Date.now();

      await act(async () => {
        result.current[1](largeObject);
      });

      const endTime = Date.now();

      expect(result.current[0]).toEqual(largeObject);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  describe('Type Safety', () => {
    it('should maintain type safety with generic types', async () => {
      interface UserPreferences {
        theme: 'light' | 'dark';
        fontSize: number;
        notifications: {
          email: boolean;
          push: boolean;
        };
      }

      const defaultPrefs: UserPreferences = {
        theme: 'light',
        fontSize: 14,
        notifications: {
          email: true,
          push: false
        }
      };

      const { result } = renderHook(() => 
        usePersistentState<UserPreferences>('user-prefs', defaultPrefs)
      );

      await act(async () => {
        result.current[1]({
          theme: 'dark',
          fontSize: 16,
          notifications: {
            email: false,
            push: true
          }
        });
      });

      expect(result.current[0].theme).toBe('dark');
      expect(result.current[0].fontSize).toBe(16);
      expect(result.current[0].notifications.push).toBe(true);
    });

    it('should handle union types correctly', async () => {
      type Status = 'loading' | 'success' | 'error' | null;

      const { result } = renderHook(() => 
        usePersistentState<Status>('status-test', null)
      );

      await act(async () => {
        result.current[1]('loading');
      });

      expect(result.current[0]).toBe('loading');

      await act(async () => {
        result.current[1]('success');
      });

      expect(result.current[0]).toBe('success');
    });
  });
});