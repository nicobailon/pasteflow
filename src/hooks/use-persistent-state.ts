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

  // Fetch initial value from database
  useEffect(() => {
    if (!key) {
      console.error('usePersistentState: No key provided');
      setHasInitialized(true);
      return;
    }

    const loadValue = async () => {
      try {
        // Double-check key is valid before fetching
        if (!key || typeof key !== 'string') {
          console.error('Invalid key in loadValue:', key);
          setHasInitialized(true);
          return;
        }
        
        const dbValue = await fetchData({ key });
        if (dbValue !== null) {
          setPersistedValue(dbValue as T);
        }
        setHasInitialized(true);
      } catch (error) {
        // Only log error if it's not about missing key
        const errorMessage = (error as Error)?.message;
        if (!errorMessage?.includes('key is required')) {
          console.error(`Error loading preference "${key}":`, error);
        }
        setHasInitialized(true);
      }
    };
    
    loadValue();
  }, [key]); // Only depend on key to avoid infinite loops

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
      if (JSON.stringify(prevValue) === JSON.stringify(newValue)) {
        return prevValue; // No change, don't trigger update
      }

      // Only save if key is valid
      if (key && typeof key === 'string') {
        // Save to database asynchronously
        updateData(updateChannel, {
          key,
          value: newValue,
          encrypted: false
        }).catch(error => {
          // Only log error if it's not about missing key
          const errorMessage = (error as Error)?.message;
          if (!errorMessage?.includes('key is required')) {
            console.error(`Error saving preference "${key}":`, error);
          }
        });
      }

      return newValue;
    });
  }, [key, updateData, updateChannel]);

  // Return the persisted value immediately, which will be updated when database loads
  return [hasInitialized ? persistedValue : initialValue, setValue];
}

// Default export for backward compatibility
export default usePersistentState;