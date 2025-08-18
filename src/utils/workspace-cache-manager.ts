import { WorkspaceState } from '../types/file-types';

import { WorkspaceSortMode, WorkspaceInfo, sortWorkspaces } from './workspace-sorting';

// IPC envelope unwrap helper compatible with legacy raw values
function unwrapIpc<T>(res: any): T {
  if (res && typeof res === 'object' && 'success' in res) {
    if ((res as any).success !== true) {
      throw new Error((res as any).error || 'IPC request failed');
    }
    return (res as any).data as T;
  }
  return res as T;
}

interface DatabaseWorkspace {
  id: string;
  name: string;
  folderPath: string;
  state: WorkspaceState;
  createdAt: number;
  updatedAt: number;
  lastAccessed: number;
}

interface WorkspaceCache {
  // Raw workspace data from database
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
  private loadingPromise: Promise<void> | null = null;
  
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
  }
  
  // Get cached data or load from database
  async getWorkspaces(): Promise<Map<string, WorkspaceInfo>> {
    if (!this.cache || this.isStale()) {
      await this.loadFromDatabase();
    }
    return this.cache!.rawData;
  }
  
  // Get sorted list for specific mode
  async getSortedList(mode: WorkspaceSortMode, manualOrder?: string[]): Promise<string[]> {
    if (!this.cache || this.isStale()) {
      await this.loadFromDatabase();
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
  async getWorkspaceCount(): Promise<number> {
    if (!this.cache || this.isStale()) {
      await this.loadFromDatabase();
    }
    return this.cache!.rawData.size;
  }
  
  // Check if a workspace exists
  async hasWorkspace(name: string): Promise<boolean> {
    if (!this.cache || this.isStale()) {
      await this.loadFromDatabase();
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
      this.loadingPromise = null;
    }
    
    this.notifyListeners();
  }
  
  // Force refresh from database
  async refresh(): Promise<void> {
    await this.loadFromDatabase();
    this.notifyListeners();
  }
  
  // Subscribe to cache changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private async loadFromDatabase(): Promise<void> {
    // Prevent multiple concurrent loads
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }
    
    this.loadingPromise = this.performDatabaseLoad();
    
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }
  
  private async performDatabaseLoad(): Promise<void> {
    try {
      if (!window.electron) {
        throw new Error('Electron IPC not available');
      }
      
      const workspaces = unwrapIpc<DatabaseWorkspace[]>(await window.electron.ipcRenderer.invoke('/workspace/list', {}));
      
      const workspaceInfos = new Map<string, WorkspaceInfo>();
      
      for (const workspace of workspaces) {
        workspaceInfos.set(workspace.name, {
          name: workspace.name,
          savedAt: workspace.lastAccessed * 1000 // Convert to milliseconds
        });
      }
      
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
      console.error('Failed to load workspaces from database:', error);
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
    const workspaces = [...this.cache!.rawData.values()];
    return sortWorkspaces(workspaces, mode, manualOrder);
  }
  
  private isStale(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.lastUpdated > this.cacheExpiryMs;
  }
  
  private trimWorkspaces(workspaces: Map<string, WorkspaceInfo>): void {
    // Keep only the most recent workspaces
    const sorted = [...workspaces.values()]
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, this.maxCacheSize);
    
    workspaces.clear();
    for (const w of sorted) {
      workspaces.set(w.name, w);
    }
  }
  
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('Cache listener error:', error);
      }
    }
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