import { useCallback, useEffect, useState } from 'react';
import { useDatabaseState } from './use-database-state';

interface PreferenceGetParams {
  key: string;
}

interface PreferenceSetParams {
  key: string;
  value: unknown;
  encrypted?: boolean;
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  const channel = '/prefs/get';
  const updateChannel = '/prefs/set';
  
  const [localValue, setLocalValue] = useState<T>(initialValue);
  const [hasInitialized, setHasInitialized] = useState(false);
  
  const { 
    updateData,
    fetchData 
  } = useDatabaseState<T | null, PreferenceGetParams, PreferenceSetParams, boolean>(
    channel,
    null,
    {
      cache: true,
      cacheTTL: 300000, // 5 minutes
      optimisticUpdate: true
    }
  );

  // Fetch initial value from database
  useEffect(() => {
    const loadValue = async () => {
      try {
        const dbValue = await fetchData({ key });
        if (dbValue !== null) {
          setLocalValue(dbValue as T);
        }
        setHasInitialized(true);
        
        // Migrate from localStorage if exists and not in database
        if (dbValue === null && typeof window !== 'undefined' && window.localStorage) {
          try {
            const storageValue = localStorage.getItem(key);
            if (storageValue !== null) {
              let parsed: T;
              
              // Handle different types of stored values
              if (storageValue.startsWith('/') || /^[A-Za-z]:/.test(storageValue)) {
                parsed = storageValue as unknown as T;
              } else if (typeof initialValue === 'string') {
                parsed = storageValue as unknown as T;
              } else if (initialValue === null || initialValue === undefined) {
                parsed = (storageValue === "null" ? null : storageValue) as unknown as T;
              } else {
                try {
                  parsed = JSON.parse(storageValue) as T;
                } catch {
                  parsed = storageValue as unknown as T;
                }
              }
              
              // Save migrated value to database
              await updateData(updateChannel, {
                key,
                value: parsed,
                encrypted: false
              });
              
              setLocalValue(parsed);
            }
          } catch (migrationError) {
            console.error(`Failed to migrate localStorage key "${key}":`, migrationError);
          }
        }
      } catch (error) {
        console.error(`Error loading preference "${key}":`, error);
        setHasInitialized(true);
      }
    };
    
    loadValue();
  }, [key, fetchData, updateData, updateChannel, initialValue]);

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    const newValue = value instanceof Function ? value(localValue) : value;
    
    setLocalValue(newValue);
    
    updateData(updateChannel, {
      key,
      value: newValue,
      encrypted: false
    }).catch(error => {
      console.error(`Error saving preference "${key}":`, error);
    });
  }, [key, localValue, updateData, updateChannel]);

  // Return the local value immediately, which will be updated when database loads
  return [hasInitialized ? localValue : initialValue, setValue];
}

// Migration utility for explicit migration of localStorage keys
export async function migrateLocalStorageKey(key: string): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage || !window.electron) {
    return;
  }
  
  const value = localStorage.getItem(key);
  if (value === null) {
    return;
  }
  
  try {
    let parsed: unknown;
    
    // Try to parse as JSON first
    try {
      parsed = JSON.parse(value);
    } catch {
      // If parsing fails, use as-is
      parsed = value;
    }
    
    await window.electron.ipcRenderer.invoke('/prefs/set', {
      key,
      value: parsed,
      encrypted: false
    });
    
    // Don't delete from localStorage yet - Phase 3 will handle cleanup
    console.log(`Migrated localStorage key "${key}" to database`);
  } catch (error) {
    console.error(`Failed to migrate localStorage key "${key}":`, error);
  }
}

export default useLocalStorage;