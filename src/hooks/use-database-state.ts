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
      ttl: options.cacheTTL || 60000
    });
  }, [options.cache, options.cacheTTL]);

  const fetchData = useCallback(async (params?: P): Promise<T> => {
    const cacheKey = JSON.stringify(params || {});
    
    const cached = getCached(cacheKey);
    if (cached !== null) {
      setData(cached);
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.ipcRenderer.invoke(channel, params);
      setData(result);
      setCached(cacheKey, result);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
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
        setData(prev => ({ ...prev, ...optimisticData }));
        pendingUpdates.current.set(updateId, optimisticData);
      }

      const result = await window.electron.ipcRenderer.invoke(updateChannel, params);
      
      pendingUpdates.current.delete(updateId);
      
      await fetchData();
      
      return result;
    } catch (err) {
      if (pendingUpdates.current.has(updateId)) {
        pendingUpdates.current.delete(updateId);
        await fetchData();
      }
      
      setError(err as Error);
      throw err;
    }
  }, [options.optimisticUpdate, fetchData]);

  useEffect(() => {
    const updateChannel = `${channel}:update`;
    
    const handleUpdate = (_event: Electron.IpcRendererEvent, updatedData: T) => {
      setData(updatedData);
      cache.current.clear();
    };

    window.electron.ipcRenderer.on(updateChannel, handleUpdate);
    
    return () => {
      window.electron.ipcRenderer.removeListener(updateChannel, handleUpdate);
    };
  }, [channel]);

  return {
    data,
    loading,
    error,
    fetchData,
    updateData,
    refresh: () => fetchData()
  };
}