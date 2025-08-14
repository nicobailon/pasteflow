import { TreeNode } from '../types/file-types';
import { BoundedLRUCache } from './bounded-lru-cache';
import { TREE_SORTING } from '../constants/app-constants';

export type SortOrder = 'default' | 'name-asc' | 'name-desc' | 'tokens-asc' | 'tokens-desc' | 
                        'extension-asc' | 'extension-desc' | 'date-asc' | 'date-desc';

export class TreeSortingService {
  private nodePriorityCache: BoundedLRUCache<string, number>;

  constructor(
    cacheSize = TREE_SORTING.CACHE_MAX_ENTRIES,
    ttlMs = TREE_SORTING.TTL_MS
  ) {
    this.nodePriorityCache = new BoundedLRUCache<string, number>(cacheSize, ttlMs);
  }

  clearCache(): void {
    this.nodePriorityCache.clear();
  }
  
  /**
   * Invalidate the cache - explicit method for structure and folder changes
   */
  invalidate(): void {
    this.nodePriorityCache.clear();
  }
  
  /**
   * Get cache statistics for memory monitoring
   */
  getCacheStats() {
    const stats = this.nodePriorityCache.getStats();
    // Estimate memory based on string keys and number values
    const estimatedMemoryPerEntry = 100; // bytes
    const estimatedMemory = stats.size * estimatedMemoryPerEntry;
    
    return {
      entries: stats.size,
      maxEntries: stats.maxSize,
      utilizationPercent: stats.utilizationPercent,
      estimatedMemory
    };
  }

  sortTreeNodes(nodes: TreeNode[], sortOrder: string): TreeNode[] {
    if (sortOrder !== 'default') {
      return this.sortWithCustomOrder(nodes, sortOrder);
    }
    return this.sortWithDefaultOrder(nodes);
  }

  private sortWithCustomOrder(nodes: TreeNode[], sortOrder: string): TreeNode[] {
    return nodes.sort((a, b) => {
      // Sort directories first, regardless of sort order
      if (a.type === "directory" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "directory") return 1;

      // Apply sort based on sort order
      const [sortKey, sortDir] = sortOrder.split('-');
      
      if (sortKey === 'name') {
        return sortDir === 'asc' 
          ? a.name.localeCompare(b.name) 
          : b.name.localeCompare(a.name);
      }
      
      // For files, enable sorting by other criteria
      if (a.type === "file" && b.type === "file") {
        if (sortKey === 'tokens') {
          const aTokens = a.fileData?.tokenCount || 0;
          const bTokens = b.fileData?.tokenCount || 0;
          return sortDir === 'asc' ? aTokens - bTokens : bTokens - aTokens;
        }
        
        if (sortKey === 'extension') {
          const aExt = a.name.split('.').pop() || '';
          const bExt = b.name.split('.').pop() || '';
          return sortDir === 'asc' 
            ? aExt.localeCompare(bExt) || a.name.localeCompare(b.name) 
            : bExt.localeCompare(aExt) || b.name.localeCompare(a.name);
        }
        
        if (sortKey === 'date') {
          // Since we don't have file date info in the FileData interface,
          // use file size as a temporary alternative for sorting
          // TODO: Replace with actual date sorting when date field is available
          const aSize = a.fileData?.size || 0;
          const bSize = b.fileData?.size || 0;
          return sortDir === 'asc' ? aSize - bSize : bSize - aSize;
        }
      }
      
      // Default to name sort
      return a.name.localeCompare(b.name);
    });
  }

  private sortWithDefaultOrder(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
      // Primary Division: Directories first, files second
      if (a.type === "directory" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "directory") return 1;
      
      // Directory Sorting Rules
      if (a.type === "directory" && b.type === "directory") {
        const aPriority = this.getDirectoryPriority(a);
        const bPriority = this.getDirectoryPriority(b);
        
        // Sort by priority first
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        // Within same priority group, sort alphabetically
        return a.name.localeCompare(b.name);
      }
      
      // File Sorting Priority
      if (a.type === "file" && b.type === "file") {
        const aPriority = this.getFilePriority(a);
        const bPriority = this.getFilePriority(b);
        
        // Sort by priority first
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        // For files with same priority, sort alphabetically
        return a.name.localeCompare(b.name);
      }
      
      // Default fallback
      return a.name.localeCompare(b.name);
    });
  }

  private getDirectoryPriority(node: TreeNode): number {
    // Check cache first
    const cacheKey = `dir-${node.id}`;
    if (this.nodePriorityCache.has(cacheKey)) {
      return this.nodePriorityCache.get(cacheKey)!;
    }
    
    const name = node.name.toLowerCase();
    let priority: number;
    
    // Core source and functionality directories
    switch (name) {
      case 'src': {
        priority = 1;
        break;
      }
      case 'scripts': {
        priority = 2;
        break;
      }
      case 'public': {
        priority = 3;
        break;
      }
      case 'lib': {
        priority = 4;
        break;
      }
      case 'docs': {
        priority = 5;
        break;
      }
      case 'app':
      case 'app_components': {
        priority = 6;
        break;
      }
      case 'actions': {
        priority = 7;
        break;
      }
      case '.github': {
        priority = 20;
        break;
      }
      default: {
        if (name === '__mocks__' || name.startsWith('__') || name.endsWith('__')) {
          priority = 30;
        }
        // Hidden directories (with leading dot)
        else if (name.startsWith('.')) {
          priority = 40;
        }
        // All other directories
        else {
          priority = 50;
        }
      }
    }
    
    // Cache the result
    this.nodePriorityCache.set(cacheKey, priority);
    return priority;
  }

  private getFilePriority(node: TreeNode): number {
    // Check cache first
    const cacheKey = `file-${node.id}`;
    if (this.nodePriorityCache.has(cacheKey)) {
      return this.nodePriorityCache.get(cacheKey)!;
    }
    
    const name = node.name.toLowerCase();
    let priority = 100; // Default priority for other files
    
    // 1. Build configuration files
    if (/vite\.config\.ts$/i.test(name) || 
        /tsconfig\.node\.json$/i.test(name) ||
        /tsconfig\.json$/i.test(name)) {
      priority = 1;
    }
    
    // 2. Runtime files
    else if (/renderer\.js$/i.test(name)) {
      priority = 2;
    }
    
    // 3. Documentation files (in decreasing importance)
    else if (/^release\.md$/i.test(name)) {
      priority = 3;
    }
    else if (/^readme\.md$/i.test(name)) {
      priority = 4;
    }
    else if (/^readme\.docker\.md$/i.test(name)) {
      priority = 5;
    }
    else if (/^readme_.*\.md$/i.test(name)) {
      priority = 6;
    }
    
    // 4. Application support files
    else if (/^preload\.js$/i.test(name)) {
      priority = 10;
    }
    
    // 5. Project configuration
    else if (/^package\.json$/i.test(name)) {
      priority = 20;
    }
    
    // 6. User files
    else if (/^new notepad$/i.test(name)) {
      priority = 30;
    }
    
    // 7. Entry point files
    else if (/^main\.js$/i.test(name)) {
      priority = 40;
    }
    
    // 8. Legal files
    else if (/^license$/i.test(name)) {
      priority = 50;
    }
    
    // 9. Testing configuration
    else if (/^jest\.setup\.js$/i.test(name) ||
                /^jest\.config\.js$/i.test(name)) {
      priority = 60;
    }
    
    // Cache the result
    this.nodePriorityCache.set(cacheKey, priority);
    return priority;
  }
}

// Singleton instance for consistent caching across the application
let defaultInstance: TreeSortingService | null = null;

export function getTreeSortingService(): TreeSortingService {
  if (!defaultInstance) {
    defaultInstance = new TreeSortingService();
  }
  return defaultInstance;
}

export function clearTreeSortingCache(): void {
  if (defaultInstance) {
    defaultInstance.clearCache();
  }
}