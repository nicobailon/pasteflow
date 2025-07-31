import { useState, useEffect } from 'react';

function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // Get stored value from localStorage or use initialValue
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      // If there's no item in localStorage, return the initialValue
      if (!item) return initialValue;
      
      // If the item starts with a slash or drive letter, it's likely a file path
      // Mac/Linux paths start with /, Windows paths often start with a drive letter followed by :\
      if (item.startsWith('/') || /^[A-Za-z]:/.test(item)) {
        return item as unknown as T;
      }
      
      // For string type initialValues, don't try to parse as JSON
      if (typeof initialValue === 'string') {
        return item as unknown as T;
      }
      
      // For null/undefined values as initialValue
      if (initialValue === null || initialValue === undefined) {
        // Check if item might be "null" string
        if (item === "null") return null as unknown as T;
        // Otherwise treat as string
        return item as unknown as T;
      }
      
      // For other types, attempt to parse the JSON
      try {
        return JSON.parse(item) as unknown as T;
      } catch {
        // If JSON parsing fails, it might be a simple string value
        return item as unknown as T;
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Update localStorage when storedValue changes
  useEffect(() => {
    try {
      if (storedValue === null || storedValue === undefined) {
        localStorage.removeItem(key);
      } else if (typeof storedValue === 'string') {
        localStorage.setItem(key, storedValue);
      } else {
        localStorage.setItem(key, JSON.stringify(storedValue));
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

export default useLocalStorage;