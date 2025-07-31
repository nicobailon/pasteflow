export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

export interface StorageOptions {
  logErrors?: boolean;
  notifyUser?: boolean;
  key?: string; // For better error messages
}

/**
 * Safely parse JSON with fallback value
 */
export function safeJsonParse<T>(
  value: string | null,
  fallback: T,
  options?: StorageOptions
): T {
  if (!value) return fallback;
  
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    if (options?.logErrors !== false) {
      console.error('[safeJsonParse] Failed to parse JSON:', error);
    }
    return fallback;
  }
}

/**
 * Safely get and parse item from localStorage
 */
export function safeGetItem<T>(
  key: string,
  fallback: T,
  options?: StorageOptions
): T {
  try {
    const value = localStorage.getItem(key);
    return safeJsonParse(value, fallback, options);
  } catch (error) {
    if (options?.logErrors !== false) {
      console.error(`[safeGetItem] Failed to get item "${key}":`, error);
    }
    return fallback;
  }
}

/**
 * Safely set item in localStorage with quota handling
 */
export function safeSetItem<T>(
  key: string,
  value: T,
  options?: StorageOptions
): StorageResult<void> {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    return { success: true };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    if (options?.logErrors !== false) {
      console.error(`[safeSetItem] Failed to set item "${key}":`, errorObj);
    }
    
    if (errorObj.name === 'QuotaExceededError' && options?.notifyUser) {
      alert('Storage quota exceeded. Please clear some workspace data.');
    }
    
    return { success: false, error: errorObj };
  }
}

/**
 * Remove corrupted items from localStorage
 */
export function cleanupCorruptedStorage(
  keys: string[],
  options?: StorageOptions
): number {
  let cleanedCount = 0;
  
  for (const key of keys) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) {
        JSON.parse(value);
      }
    } catch (error) {
      if (options?.logErrors !== false) {
        console.error(`[cleanupCorruptedStorage] Removing corrupted item "${key}"`);
      }
      localStorage.removeItem(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0 && options?.notifyUser) {
    alert(`Cleaned up ${cleanedCount} corrupted storage items.`);
  }
  
  return cleanedCount;
}

/**
 * Get all localStorage keys matching a pattern
 */
export function getStorageKeys(pattern?: RegExp): string[] {
  const keys: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (!pattern || pattern.test(key))) {
      keys.push(key);
    }
  }
  
  return keys;
}