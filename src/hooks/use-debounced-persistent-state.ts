import { useCallback, useEffect, useRef, useState } from 'react';

import { usePersistentState } from './use-persistent-state';

/**
 * Debounced wrapper around usePersistentState.
 * - Updates UI state immediately
 * - Persists to DB after debounceMs of inactivity
 */
export function useDebouncedPersistentState<T>(
  key: string,
  initialValue: T,
  debounceMs = 300
): [T, (value: T | ((val: T) => T)) => void] {
  const [persistedValue, setPersistedValue] = usePersistentState<T>(key, initialValue);
  const [value, setValue] = useState<T>(persistedValue);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local value in sync when persisted value changes (e.g., initial load)
  useEffect(() => {
    setValue(persistedValue);
  }, [persistedValue]);

  const setDebounced = useCallback((next: T | ((val: T) => T)) => {
    setValue(prev => (next instanceof Function ? next(prev) : next));

    // Clear prior timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Schedule persistence
    timerRef.current = setTimeout(() => {
      setPersistedValue(prev => (next instanceof Function ? next(prev) : next));
      timerRef.current = null;
    }, debounceMs);
  }, [debounceMs, setPersistedValue]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return [value, setDebounced];
}

export default useDebouncedPersistentState;

