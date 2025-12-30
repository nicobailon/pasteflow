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
    // Avoid redundant updates that can cause re-render cascades
    setValue(prev => {
      if (Object.is(prev, persistedValue)) return prev;
      try {
        // Fallback deep compare for objects/arrays
        const prevJson = typeof prev === 'object' && prev !== null ? JSON.stringify(prev) : prev as unknown as string;
        const nextJson = typeof persistedValue === 'object' && persistedValue !== null ? JSON.stringify(persistedValue) : persistedValue as unknown as string;
        if (prevJson === nextJson) return prev;
      } catch {
        // If serialization fails, proceed to update to be safe
      }
      return persistedValue;
    });
  }, [persistedValue]);

  const setDebounced = useCallback((next: T | ((val: T) => T)) => {
    let resolvedValue: T;
    setValue(prev => {
      resolvedValue = next instanceof Function ? next(prev) : next;
      return resolvedValue;
    });

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      setPersistedValue(resolvedValue!);
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
