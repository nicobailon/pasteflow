import { useCallback, useEffect, useState, useMemo } from 'react';

import { WorkspaceCacheManager } from '../utils/workspace-cache-manager';
import { WorkspaceSortMode } from '../utils/workspace-sorting';
import { PerformanceMonitor } from '../utils/performance-monitor';

interface UseWorkspaceCacheOptions {
  enablePerformanceMonitoring?: boolean;
}

interface UseWorkspaceCacheReturn {
  getSortedWorkspaces: (mode: WorkspaceSortMode, manualOrder?: string[]) => string[];
  getWorkspaceCount: () => number;
  hasWorkspace: (name: string) => boolean;
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
  const [cacheVersion, setCacheVersion] = useState(0);
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
  const getSortedWorkspaces = useCallback((mode: WorkspaceSortMode, manualOrder?: string[]): string[] => {
    if (perfMonitor) {
      return perfMonitor.measure('getSortedWorkspaces', () => 
        cacheManager.getSortedList(mode, manualOrder)
      );
    }
    return cacheManager.getSortedList(mode, manualOrder);
  }, [cacheManager, perfMonitor, cacheVersion]); // Include cacheVersion to ensure updates
  
  // Get workspace count
  const getWorkspaceCount = useCallback((): number => {
    if (perfMonitor) {
      return perfMonitor.measure('getWorkspaceCount', () => 
        cacheManager.getWorkspaceCount()
      );
    }
    return cacheManager.getWorkspaceCount();
  }, [cacheManager, perfMonitor, cacheVersion]);
  
  // Check if workspace exists
  const hasWorkspace = useCallback((name: string): boolean => {
    if (perfMonitor) {
      return perfMonitor.measure('hasWorkspace', () => 
        cacheManager.hasWorkspace(name)
      );
    }
    return cacheManager.hasWorkspace(name);
  }, [cacheManager, perfMonitor, cacheVersion]);
  
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