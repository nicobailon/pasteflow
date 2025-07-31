import { STORAGE_KEYS } from '../constants';
import { WorkspaceCacheManager } from './workspace-cache-manager';
import { sortWorkspaces, WorkspaceInfo } from './workspace-sorting';
import { PerformanceMonitor } from './performance-monitor';

/**
 * Performance comparison between cached and non-cached workspace operations
 */
export class WorkspacePerformanceComparison {
  private perfMonitor: PerformanceMonitor;
  private cacheManager: WorkspaceCacheManager;
  
  constructor() {
    this.perfMonitor = new PerformanceMonitor(true);
    this.cacheManager = WorkspaceCacheManager.getInstance();
  }
  
  /**
   * Generate test workspaces
   */
  private generateTestWorkspaces(count: number): Record<string, { savedAt: number; name: string }> {
    const workspaces: Record<string, { savedAt: number; name: string }> = {};
    
    for (let i = 0; i < count; i++) {
      const name = `Workspace_${String(i).padStart(4, '0')}`;
      workspaces[name] = {
        name,
        savedAt: Date.now() - (i * 1000) // Each workspace 1 second older
      };
    }
    
    return workspaces;
  }
  
  /**
   * Simulate non-cached getSortedWorkspaces (original implementation)
   */
  private getSortedWorkspacesNonCached(sortMode: 'recent' | 'alphabetical', manualOrder?: string[]): string[] {
    const workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}';
    const workspaces = JSON.parse(workspacesString);
    
    const workspaceInfos: WorkspaceInfo[] = Object.entries(workspaces).map(([name, data]: [string, unknown]) => {
      let savedAt = 0;
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          savedAt = (parsed as { savedAt?: number }).savedAt || 0;
        } catch {
          // Ignore parse errors
        }
      } else if (data && typeof data === 'object') {
        savedAt = (data as { savedAt?: number }).savedAt || 0;
      }
      return { name, savedAt };
    });
    
    return sortWorkspaces(workspaceInfos, sortMode, manualOrder);
  }
  
  /**
   * Run performance comparison
   */
  runComparison(workspaceCount: number = 100, iterations: number = 100): void {
    
    // Setup test data
    const testWorkspaces = this.generateTestWorkspaces(workspaceCount);
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(testWorkspaces));
    
    // Test 1: Non-cached performance
    for (let i = 0; i < iterations; i++) {
      this.perfMonitor.measure('non-cached-recent', () => {
        this.getSortedWorkspacesNonCached('recent');
      });
      
      this.perfMonitor.measure('non-cached-alphabetical', () => {
        this.getSortedWorkspacesNonCached('alphabetical');
      });
    }
    
    // Clear cache before testing cached version
    this.cacheManager.invalidate();
    
    // Test 2: Cached performance (first call loads, subsequent use cache)
    
    // First call - loads from storage
    this.perfMonitor.measure('cached-first-load', () => {
      this.cacheManager.getSortedList('recent');
    });
    
    // Subsequent calls - use cache
    for (let i = 0; i < iterations - 1; i++) {
      this.perfMonitor.measure('cached-recent', () => {
        this.cacheManager.getSortedList('recent');
      });
      
      this.perfMonitor.measure('cached-alphabetical', () => {
        this.cacheManager.getSortedList('alphabetical');
      });
    }
    
    // Test 3: Drag operation simulation
    
    // Non-cached drag simulation (10 drag events)
    for (let i = 0; i < 10; i++) {
      this.perfMonitor.measure('drag-non-cached', () => {
        // Each drag event calls getSortedWorkspaces
        this.getSortedWorkspacesNonCached('recent');
      });
    }
    
    // Cached drag simulation
    for (let i = 0; i < 10; i++) {
      this.perfMonitor.measure('drag-cached', () => {
        this.cacheManager.getSortedList('recent');
      });
    }
    
    // Display results
    this.displayResults();
  }
  
  /**
   * Display performance comparison results
   */
  private displayResults(): void {
    
    const nonCachedRecent = this.perfMonitor.getStats('non-cached-recent');
    const cachedRecent = this.perfMonitor.getStats('cached-recent');
    const cachedFirstLoad = this.perfMonitor.getStats('cached-first-load');
    
    const nonCachedAlpha = this.perfMonitor.getStats('non-cached-alphabetical');
    const cachedAlpha = this.perfMonitor.getStats('cached-alphabetical');
    
    const dragNonCached = this.perfMonitor.getStats('drag-non-cached');
    const dragCached = this.perfMonitor.getStats('drag-cached');
    
    if (nonCachedRecent && cachedRecent && cachedFirstLoad) {
    }
    
    if (nonCachedAlpha && cachedAlpha) {
    }
    
    if (dragNonCached && dragCached) {
    }
    
    this.perfMonitor.logReport();
    
    // Cleanup
    localStorage.removeItem(STORAGE_KEYS.WORKSPACES);
  }
}

// Export function to run comparison
export function runWorkspacePerformanceComparison(
  workspaceCount?: number, 
  iterations?: number
): void {
  const comparison = new WorkspacePerformanceComparison();
  comparison.runComparison(workspaceCount, iterations);
}

// Run comparison if this file is executed directly
if (typeof window !== 'undefined' && (window as { runPerfTest?: boolean }).runPerfTest) {
  runWorkspacePerformanceComparison();
}