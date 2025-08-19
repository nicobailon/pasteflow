import { useCallback, useEffect, useState } from 'react';

import { useDatabaseState } from './use-database-state';

// Constants
/** Cache time-to-live for database preferences (5 minutes) */
const CACHE_TTL_MS = 300_000; // 5 minutes in milliseconds

/**
 * Parameters for retrieving a preference from the database.
 */
interface PreferenceGetParams {
  /** Preference key to retrieve */
  key: string;
}

/**
 * Parameters for storing a preference in the database.
 */
interface PreferenceSetParams {
  /** Preference key to store */
  key: string;
  /** Value to store (will be JSON serialized if not a string) */
  value: unknown;
  /** Whether to encrypt the value (currently unused) */
  encrypted?: boolean;
}

/**
 * React hook for persisting state in SQLite database with automatic synchronization.
 * Provides useState-like interface with database persistence and intelligent caching.
 * 
 * Features:
 * - Automatic JSON serialization/deserialization for complex types
 * - 5-minute cache TTL for performance optimization
 * - Optimistic updates for responsive UI
 * - Handles initialization from database values
 * - Prevents infinite loops with value change detection
 * 
 * @template T The type of the persisted value
 * @param {string} key - Unique storage key for this preference
 * @param {T} initialValue - Default value used until database loads
 * @returns {[T, (value: T | ((val: T) => T)) => void]} Tuple of [currentValue, setValue]
 * 
 * @throws {Error} If database operations fail (logged, doesn't throw to caller)
 * 
 * @example
 * // Simple string preference
 * const [theme, setTheme] = usePersistentState('ui.theme', 'light');
 * setTheme('dark'); // Persisted automatically
 * 
 * @example
 * // Complex object preference
 * const [settings, setSettings] = usePersistentState('app.settings', {
 *   autoSave: true,
 *   notifications: false
 * });
 * 
 * // Functional update
 * setSettings(prev => ({ ...prev, autoSave: false }));
 * 
 * @example
 * // Array preference
 * const [recentFiles, setRecentFiles] = usePersistentState<string[]>(
 *   'recent.files',
 *   []
 * );
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  const channel = '/prefs/get';
  const updateChannel = '/prefs/set';
  
  const [persistedValue, setPersistedValue] = useState<T>(initialValue);
  const [hasInitialized, setHasInitialized] = useState(false);
  
  const { 
    updateData,
    fetchData 
  } = useDatabaseState<T | null, PreferenceGetParams, PreferenceSetParams, boolean>(
    channel,
    null,
    {
      cache: true,
      cacheTTL: CACHE_TTL_MS,
      optimisticUpdate: true
    }
  );

  // Helper to validate key
  const isValidKey = useCallback((k: unknown): k is string => {
    return typeof k === 'string' && k.length > 0;
  }, []);

  // Helper to determine if error should be logged
  const shouldLogError = useCallback((error: unknown): boolean => {
    const errorMessage = (error as Error)?.message || '';
    return !errorMessage.includes('key is required') && 
           !errorMessage.includes('Rate limit exceeded');
  }, []);

  // Helper to add random delay for rate limiting prevention
  const addRandomDelay = useCallback(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
  }, []);

  // Fetch initial value from database
  useEffect(() => {
    if (!isValidKey(key)) {
      console.error('usePersistentState: No key provided');
      setHasInitialized(true);
      return;
    }

    const loadValue = async () => {
      try {
        // Add a small random delay (0-100ms) to stagger initial loads
        // This prevents rate limiting when multiple hooks initialize simultaneously
        await addRandomDelay();

        const dbValue = await fetchData({ key });
        if (dbValue !== null && dbValue !== undefined) {
          setPersistedValue(dbValue as T);
        } else {
          // Ensure we never propagate undefined/null to callers
          setPersistedValue(initialValue);
        }
        setHasInitialized(true);
      } catch (error) {
        if (shouldLogError(error)) {
          console.error(`Error loading preference "${key}":`, error);
        }
        setHasInitialized(true);
      }
    };
    
    loadValue();
  }, [key, fetchData, isValidKey, shouldLogError, addRandomDelay]); // Only depend on key and fetchData to avoid infinite loops

  // Helper to check if values are equal
  const valuesEqual = useCallback((a: T, b: T): boolean => {
    return JSON.stringify(a) === JSON.stringify(b);
  }, []);

  // Helper to save value to database
  const saveToDatabase = useCallback(async (k: string, value: T) => {
    try {
      await updateData(updateChannel, {
        key: k,
        value,
        encrypted: false
      });
    } catch (error) {
      if (shouldLogError(error)) {
        console.error(`Error saving preference "${k}":`, error);
      }
    }
  }, [updateData, updateChannel, shouldLogError]);

  /**
   * Updates the persisted value with automatic database synchronization.
   * Supports both direct values and functional updates.
   * Uses optimistic updates for immediate UI response.
   * 
   * @param {T | ((val: T) => T)} value - New value or update function
   */
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    // Use functional update to avoid stale closure issues
    setPersistedValue(prevValue => {
      const newValue = value instanceof Function ? value(prevValue) : value;
      
      // Check if value actually changed to prevent infinite loops
      if (valuesEqual(prevValue, newValue)) {
        return prevValue; // No change, don't trigger update
      }

      // Only save if key is valid
      if (isValidKey(key)) {
        // Save to database asynchronously
        void saveToDatabase(key, newValue);
      }

      return newValue;
    });
  }, [key, isValidKey, valuesEqual, saveToDatabase]);

  // Return the persisted value immediately, which will be updated when database loads
  // Extra safety: coalesce to initialValue to avoid undefined leaking to consumers
  return [hasInitialized ? (persistedValue ?? initialValue) : initialValue, setValue];
}

// Default export for backward compatibility
export default usePersistentState;