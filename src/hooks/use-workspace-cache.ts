import { useCallback, useEffect, useState, useMemo } from 'react';

import { WorkspaceCacheManager } from '../utils/workspace-cache-manager';
import { WorkspaceSortMode } from '../utils/workspace-sorting';
import { PerformanceMonitor } from '../utils/performance-monitor';

interface UseWorkspaceCacheOptions {
  enablePerformanceMonitoring?: boolean;
}

interface UseWorkspaceCacheReturn {
  getSortedWorkspaces: (mode: WorkspaceSortMode, manualOrder?: string[]) => Promise<string[]>;
  getWorkspaceCount: () => Promise<number>;
  hasWorkspace: (name: string) => Promise<boolean>;
  invalidateCache: (mode?: WorkspaceSortMode) => void;
  refreshCache: () => void;
  cacheStats: {
    size: number;
    age: number;
    version: number;
    hasData: boolean;
  };
}

export function useWorkspaceCache(options: UseWorkspaceCacheOptions = {}): UseWorkspaceCacheReturn {
  const { enablePerformanceMonitoring = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') } = options;
  
  const cacheManager = useMemo(() => WorkspaceCacheManager.getInstance(), []);
  const perfMonitor = useMemo(
    () => enablePerformanceMonitoring ? new PerformanceMonitor() : null,
    [enablePerformanceMonitoring]
  );
  
  // Track cache version to trigger re-renders
  const [_cacheVersion, setCacheVersion] = useState(0);
  const [cacheStats, setCacheStats] = useState(() => cacheManager.getCacheStats());
  
  // Subscribe to cache changes
  useEffect(() => {
    const unsubscribe = cacheManager.subscribe(() => {
      setCacheVersion(v => v + 1);
      setCacheStats(cacheManager.getCacheStats());
    });
    
    return () => {
      unsubscribe();
      // Log performance report on unmount in development
      if (perfMonitor && typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        perfMonitor.logReport();
      }
    };
  }, [cacheManager, perfMonitor]);
  
  // Get sorted workspaces with performance monitoring
  const getSortedWorkspaces = useCallback(async (mode: WorkspaceSortMode, manualOrder?: string[]): Promise<string[]> => {
    if (perfMonitor) {
      return perfMonitor.measureAsync('getSortedWorkspaces', async () => 
        await cacheManager.getSortedList(mode, manualOrder)
      );
    }
    return await cacheManager.getSortedList(mode, manualOrder);
  }, [cacheManager, perfMonitor]); // Removed cacheVersion as it's not needed
  
  // Get workspace count
  const getWorkspaceCount = useCallback(async (): Promise<number> => {
    if (perfMonitor) {
      return perfMonitor.measureAsync('getWorkspaceCount', async () => 
        await cacheManager.getWorkspaceCount()
      );
    }
    return await cacheManager.getWorkspaceCount();
  }, [cacheManager, perfMonitor]);
  
  // Check if workspace exists
  const hasWorkspace = useCallback(async (name: string): Promise<boolean> => {
    if (perfMonitor) {
      return perfMonitor.measureAsync('hasWorkspace', async () => 
        await cacheManager.hasWorkspace(name)
      );
    }
    return await cacheManager.hasWorkspace(name);
  }, [cacheManager, perfMonitor]);
  
  // Invalidate cache
  const invalidateCache = useCallback((mode?: WorkspaceSortMode): void => {
    cacheManager.invalidate(mode);
  }, [cacheManager]);
  
  // Force refresh from storage
  const refreshCache = useCallback((): void => {
    cacheManager.refresh();
  }, [cacheManager]);
  
  return {
    getSortedWorkspaces,
    getWorkspaceCount,
    hasWorkspace,
    invalidateCache,
    refreshCache,
    cacheStats
  };
}

// Hook for integrating cache invalidation with workspace operations
export function useWorkspaceCacheInvalidation() {
  const cacheManager = useMemo(() => WorkspaceCacheManager.getInstance(), []);
  
  return useCallback(() => {
    cacheManager.invalidate();
  }, [cacheManager]);
}