import { useCallback, useEffect, useRef, useState } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface DatabaseStateOptions {
  cache?: boolean;
  cacheTTL?: number;
  optimisticUpdate?: boolean;
}

interface DatabaseStateReturn<T, P = unknown, U = unknown, R = unknown> {
  data: T;
  loading: boolean;
  error: Error | null;
  fetchData: (params?: P) => Promise<T>;
  updateData: (updateChannel: string, params: U, optimisticData?: Partial<T>) => Promise<R>;
  refresh: () => Promise<T>;
}

const isRateLimitError = (error: unknown): boolean => {
  const msg = (error as Error)?.message || String(error || '');
  return msg.includes('Rate limit exceeded');
};

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Unwraps standardized IPC envelopes { success, data } | { success, error }
 * Falls back to legacy raw values for backward compatibility.
 */
function unwrapIpcResult<R>(res: unknown): R {
  const obj = res as { success?: boolean; data?: unknown; error?: unknown };
  if (obj && typeof obj === 'object' && 'success' in obj) {
    if (obj.success !== true) {
      const errMsg = (obj.error as string) || 'IPC request failed';
      throw new Error(errMsg);
    }
    return (obj.data as R) ?? (undefined as unknown as R);
  }
  return res as R;
}

export function useDatabaseState<T, P = unknown, U = unknown, R = unknown>(
  channel: string,
  initialData: T,
  options: DatabaseStateOptions = {}
): DatabaseStateReturn<T, P, U, R> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cache = useRef<Map<string, CacheEntry<T>>>(new Map());
  const pendingUpdates = useRef<Map<string, Partial<T>>>(new Map());
  const lastParamsRef = useRef<P | undefined>();

  const getCached = useCallback((key: string): T | null => {
    if (!options.cache) return null;

    const entry = cache.current.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      cache.current.delete(key);
      return null;
    }

    return entry.data;
  }, [options.cache]);

  const setCached = useCallback((key: string, value: T) => {
    if (!options.cache) return;

    cache.current.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl: options.cacheTTL || 60_000
    });
  }, [options.cache, options.cacheTTL]);

  const fetchData = useCallback(async (params?: P): Promise<T> => {
    // Remember last params for callers that invoke updateData without providing fetch params
    if (params !== undefined) {
      lastParamsRef.current = params;
    }

    const cacheKey = JSON.stringify(params || {});

    const cached = getCached(cacheKey);
    if (cached !== null) {
      setData(cached);
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const raw = await window.electron.ipcRenderer.invoke(channel, params || {});
      const result = unwrapIpcResult<T>(raw);
      setData(result);
      setCached(cacheKey, result);
      return result;
    } catch (error_) {
      // Suppress noisy logs on rate limiting; let caller decide what to do
      if (!isRateLimitError(error_)) {
        setError(error_ as Error);
      }
      throw error_;
    } finally {
      setLoading(false);
    }
  }, [channel, getCached, setCached]);

  const updateData = useCallback(async (
    updateChannel: string,
    params: U,
    optimisticData?: Partial<T>
  ): Promise<R> => {
    const updateId = `${Date.now()}-${Math.random()}`;

    try {
      if (options.optimisticUpdate && optimisticData) {
        setData(prev => ({ ...(prev as any), ...optimisticData } as T));
        pendingUpdates.current.set(updateId, optimisticData);
      }

      const raw = await window.electron.ipcRenderer.invoke(updateChannel, params);

      pendingUpdates.current.delete(updateId);

      // Re-fetch using the last known params (e.g., { key }) to satisfy validators
      try {
        await fetchData(lastParamsRef.current);
      } catch (refetchError) {
        // Gracefully handle rate limiting without noisy logs
        if (isRateLimitError(refetchError)) {
          // Backoff slightly and try one more time
          await delay(150);
          try {
            await fetchData(lastParamsRef.current);
          } catch {
            // Swallow to avoid alarming logs; UI retains optimistic state
          }
        } else {
          throw refetchError;
        }
      }

      return unwrapIpcResult<R>(raw);
    } catch (error_) {
      if (pendingUpdates.current.has(updateId)) {
        pendingUpdates.current.delete(updateId);
        try {
          await fetchData(lastParamsRef.current);
        } catch {
          // Ignore refetch failures here
        }
      }

      setError(error_ as Error);
      throw error_;
    }
  }, [options.optimisticUpdate, fetchData]);

  const handleUpdate = useCallback((_event: unknown, updatedData?: T) => {
    if (updatedData !== undefined) {
      setData(updatedData);
    }
    cache.current.clear();
    // If no data provided, trigger a refetch with last known params (if any)
    if (updatedData === undefined) {
      fetchData(lastParamsRef.current).catch(error => {
        console.error('Error refetching data on update:', error);
      });
    }
  }, [fetchData]);

  useEffect(() => {
    const updateChannel = `${channel}:update`;

    window.electron.ipcRenderer.on(updateChannel, handleUpdate);

    return () => {
      try {
        window.electron.ipcRenderer.removeListener(updateChannel, handleUpdate);
      } catch (error) {
        console.error(`Error removing listener for channel ${updateChannel}:`, error);
      }
    };
  }, [channel, handleUpdate]);

  return {
    data,
    loading,
    error,
    fetchData,
    updateData,
    refresh: () => fetchData()
  };
}