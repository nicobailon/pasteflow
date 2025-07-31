import { STORAGE_KEYS } from '../constants';
import { WorkspaceSortMode, WorkspaceInfo, sortWorkspaces } from './workspace-sorting';

interface WorkspaceCache {
  // Raw workspace data from localStorage
  rawData: Map<string, WorkspaceInfo>;
  
  // Sorted workspace names by mode
  sortedLists: {
    recent: string[] | null;
    alphabetical: string[] | null;
    manual: string[] | null;
  };
  
  // Cache metadata
  lastUpdated: number;
  version: number;
}

export class WorkspaceCacheManager {
  private cache: WorkspaceCache | null = null;
  private listeners: Set<() => void> = new Set();
  private maxCacheSize = 1000; // Maximum workspaces to cache
  private cacheExpiryMs = 5 * 60 * 1000; // 5 minutes
  
  // Singleton instance
  private static instance: WorkspaceCacheManager;
  
  static getInstance(): WorkspaceCacheManager {
    if (!WorkspaceCacheManager.instance) {
      WorkspaceCacheManager.instance = new WorkspaceCacheManager();
    }
    return WorkspaceCacheManager.instance;
  }
  
  // Private constructor for singleton
  private constructor() {
    // Listen for workspace changes
    window.addEventListener('workspacesChanged', () => {
      this.invalidate();
    });
    
    // Listen for storage changes from other tabs
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.WORKSPACES) {
        this.invalidate();
      }
    });
  }
  
  // Get cached data or load from localStorage
  getWorkspaces(): Map<string, WorkspaceInfo> {
    if (!this.cache || this.isStale()) {
      this.loadFromStorage();
    }
    return this.cache!.rawData;
  }
  
  // Get sorted list for specific mode
  getSortedList(mode: WorkspaceSortMode, manualOrder?: string[]): string[] {
    if (!this.cache || this.isStale()) {
      this.loadFromStorage();
    }
    
    // Manual mode always regenerates to respect current order
    if (mode === 'manual') {
      return this.generateSortedList(mode, manualOrder);
    }
    
    // Check if we have cached sorted list
    if (this.cache!.sortedLists[mode]) {
      return this.cache!.sortedLists[mode]!;
    }
    
    // Generate and cache sorted list
    const sorted = this.generateSortedList(mode, manualOrder);
    this.cache!.sortedLists[mode] = sorted;
    
    return sorted;
  }
  
  // Get workspace count without full parsing
  getWorkspaceCount(): number {
    if (!this.cache || this.isStale()) {
      this.loadFromStorage();
    }
    return this.cache!.rawData.size;
  }
  
  // Check if a workspace exists
  hasWorkspace(name: string): boolean {
    if (!this.cache || this.isStale()) {
      this.loadFromStorage();
    }
    return this.cache!.rawData.has(name);
  }
  
  // Invalidate specific sort mode or entire cache
  invalidate(mode?: WorkspaceSortMode): void {
    if (!this.cache) return;
    
    if (mode) {
      this.cache.sortedLists[mode] = null;
    } else {
      this.cache = null;
    }
    
    this.notifyListeners();
  }
  
  // Force refresh from storage
  refresh(): void {
    this.loadFromStorage();
    this.notifyListeners();
  }
  
  // Subscribe to cache changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private loadFromStorage(): void {
    try {
      const workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}';
      const workspaces = JSON.parse(workspacesString);
      
      const workspaceInfos = new Map<string, WorkspaceInfo>();
      
      Object.entries(workspaces).forEach(([name, data]: [string, any]) => {
        let savedAt = 0;
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data);
            savedAt = parsed.savedAt || 0;
          } catch {
            // Ignore parse errors
          }
        } else if (data && typeof data === 'object') {
          savedAt = data.savedAt || 0;
        }
        workspaceInfos.set(name, { name, savedAt });
      });
      
      // Check memory usage and trim if needed
      if (workspaceInfos.size > this.maxCacheSize) {
        this.trimWorkspaces(workspaceInfos);
      }
      
      this.cache = {
        rawData: workspaceInfos,
        sortedLists: {
          recent: null,
          alphabetical: null,
          manual: null
        },
        lastUpdated: Date.now(),
        version: (this.cache?.version || 0) + 1
      };
    } catch (error) {
      console.error('Failed to load workspaces from storage:', error);
      // Initialize with empty cache on error
      this.cache = {
        rawData: new Map(),
        sortedLists: {
          recent: null,
          alphabetical: null,
          manual: null
        },
        lastUpdated: Date.now(),
        version: (this.cache?.version || 0) + 1
      };
    }
  }
  
  private generateSortedList(mode: WorkspaceSortMode, manualOrder?: string[]): string[] {
    const workspaces = Array.from(this.cache!.rawData.values());
    return sortWorkspaces(workspaces, mode, manualOrder);
  }
  
  private isStale(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.lastUpdated > this.cacheExpiryMs;
  }
  
  private trimWorkspaces(workspaces: Map<string, WorkspaceInfo>): void {
    // Keep only the most recent workspaces
    const sorted = Array.from(workspaces.values())
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, this.maxCacheSize);
    
    workspaces.clear();
    sorted.forEach(w => workspaces.set(w.name, w));
  }
  
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('Cache listener error:', error);
      }
    });
  }
  
  // Get cache statistics for debugging
  getCacheStats(): {
    size: number;
    age: number;
    version: number;
    hasData: boolean;
  } {
    if (!this.cache) {
      return { size: 0, age: 0, version: 0, hasData: false };
    }
    
    return {
      size: this.cache.rawData.size,
      age: Date.now() - this.cache.lastUpdated,
      version: this.cache.version,
      hasData: true
    };
  }
}

// Export singleton instance for convenience
export const workspaceCacheManager = WorkspaceCacheManager.getInstance();