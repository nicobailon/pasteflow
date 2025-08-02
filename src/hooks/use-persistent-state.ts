import { useCallback, useEffect, useState } from 'react';
import { useDatabaseState } from './use-database-state';

// Constants
const CACHE_TTL_MS = 300000; // 5 minutes in milliseconds

interface PreferenceGetParams {
  key: string;
}

interface PreferenceSetParams {
  key: string;
  value: unknown;
  encrypted?: boolean;
}

/**
 * Hook for persisting state in SQLite database
 * 
 * @param key - The storage key to use for this value
 * @param initialValue - The initial value if none exists in storage
 * @returns A tuple of [value, setValue] similar to useState
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
        if (!error?.message?.includes('key is required')) {
          console.error(`Error loading preference "${key}":`, error);
        }
        setHasInitialized(true);
      }
    };
    
    loadValue();
  }, [key]); // Only depend on key to avoid infinite loops

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
          if (!error?.message?.includes('key is required')) {
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