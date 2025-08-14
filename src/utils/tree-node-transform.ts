/**
 * Pure transformation functions for tree node operations.
 * This module handles building, flattening, and filtering tree nodes
 * without side effects or React dependencies.
 */

import type { FileData, TreeNode } from '../types/file-types';
import { normalizePath } from './path-utils';
import { BoundedLRUCache } from './bounded-lru-cache';
import { TREE_FLATTEN_CACHE } from '../constants/app-constants';

interface TreeTransformDependencies {
  sortFunction?: (nodes: TreeNode[], sortOrder: string) => TreeNode[];
  expandedLookup?: (path: string) => boolean | undefined;
  filesByPath?: Map<string, FileData>;
  sortOrder?: string;
}

interface FlattenCacheEntry {
  result: TreeNode[];
  timestamp: number;
}

// LRU+TTL cache for flatten results
const flattenCache = new BoundedLRUCache<string, FlattenCacheEntry>(
  TREE_FLATTEN_CACHE.MAX_ENTRIES,
  TREE_FLATTEN_CACHE.TTL_MS
);

/**
 * Build tree nodes from a hierarchical file map
 */
export function buildTreeNodesFromMap(
  fileMap: Record<string, any>,
  level = 0,
  deps?: TreeTransformDependencies,
  maxDepth = Number.POSITIVE_INFINITY
): TreeNode[] {
  if (!fileMap) return [];

  const { sortFunction, expandedLookup, filesByPath, sortOrder = 'default' } = deps || {};

  const nodes = Object.keys(fileMap).map((key) => {
    const item = fileMap[key];

    if (item.isFile) {
      // Get the latest file data from the map if available
      const latestFileData = filesByPath?.get(item.path) || item.fileData;
      return {
        ...item,
        type: 'file',
        level,
        id: item.path || `file-${Math.random().toString(36).slice(2, 11)}`,
        fileData: latestFileData
      } as TreeNode;
    } else {
      // Only include children if we haven't reached maxDepth
      const children = (level + 1 < maxDepth && item.children) ?
        buildTreeNodesFromMap(item.children, level + 1, deps, maxDepth) : [];

      // Determine expansion state
      const expansionState = expandedLookup ? expandedLookup(item.path) : undefined;
      const isExpanded = expansionState !== undefined ? expansionState : (level < 1);

      return {
        ...item,
        type: 'directory',
        level,
        id: item.path || `dir-${Math.random().toString(36).slice(2, 11)}`,
        children,
        isExpanded,
      } as TreeNode;
    }
  });

  // Apply sorting if provided
  if (sortFunction) {
    return sortFunction(nodes, sortOrder);
  }

  return nodes;
}

/**
 * Build a hierarchical file map from a flat list of files
 */
export function buildFileMap(
  files: FileData[],
  selectedFolder: string | null,
  expandedNodes: Record<string, boolean>
): Record<string, any> {
  const fileMap: Record<string, any> = {};

  for (const file of files) {
    if (!file.path) continue;

    const normalizedFilePath = normalizePath(file.path);
    const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';

    // Strictly include only files under selectedFolder (boundary-safe)
    let relativePath: string;
    if (selectedFolder) {
      const root = normalizedRootPath;
      const underRoot = normalizedFilePath === root || normalizedFilePath.startsWith(root + '/');
      if (!underRoot) {
        continue;
      }
      relativePath = normalizedFilePath === root ? '' : normalizedFilePath.slice(root.length + 1);
    } else {
      relativePath = normalizedFilePath.replace(/^\/|^\\/, '');
    }

    const parts = relativePath.split('/');
    let currentPath = "";
    let current = fileMap;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (i < parts.length - 1) {
        const dirPath = selectedFolder
          ? normalizePath(`${normalizedRootPath}/${currentPath}`)
          : normalizePath(`/${currentPath}`);
        
        if (!current[part]) {
          current[part] = {
            name: part,
            path: dirPath,
            children: {},
            isDirectory: true,
            isExpanded: expandedNodes[dirPath] ?? (i < 2)
          };
        }
        
        // Ensure children exists before accessing
        if (!current[part].children) {
          current[part].children = {};
        }
        
        current = current[part].children;
      } else {
        const filePath = selectedFolder
          ? normalizePath(`${normalizedRootPath}/${currentPath}`)
          : normalizePath(`/${currentPath}`);
        
        current[part] = {
          name: part,
          path: filePath,
          isFile: true,
          fileData: file
        };
      }
    }
  }

  return fileMap;
}

/**
 * Flatten a tree structure for rendering with proper indentation
 */
export function flattenTree(
  nodes: TreeNode[],
  expandedNodes: Record<string, boolean>,
  searchTerm?: string,
  filesByPath?: Map<string, FileData>,
  selectedFolder?: string | null
): TreeNode[] {
  // Create a stable tree identity from root node paths
  const treeIdentity = nodes
    .map(n => n.path)
    .sort()
    .join('|');
  
  // Create cache key including tree identity and selectedFolder
  const expandedKeys = Object.entries(expandedNodes)
    .filter(([_, expanded]) => expanded)
    .map(([path]) => path)
    .sort()
    .join('|');
  
  const cacheKey = `${treeIdentity}:${selectedFolder || ''}:${expandedKeys}:${searchTerm || ''}`;
  
  // Check cache first
  const cached = flattenCache.get(cacheKey);
  if (cached) {
    // Update file data in cached results if needed
    let needsUpdate = false;
    const updatedResult = cached.result.map(node => {
      if (node.type === "file" && node.path && filesByPath) {
        const latestFileData = filesByPath.get(node.path);
        if (latestFileData && latestFileData !== node.fileData) {
          needsUpdate = true;
          return { ...node, fileData: latestFileData };
        }
      }
      return node;
    });
    
    if (needsUpdate) {
      cached.result = updatedResult;
    }
    
    return cached.result;
  }

  // Recursive flatten function
  const flattenNodesRecursively = (nodesToFlatten: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];

    for (const node of nodesToFlatten) {
      // Determine expansion state
      const expandedFromState = expandedNodes[node.path];
      const defaultIsExpanded = node.isExpanded ?? false;
      
      const finalIsExpanded = node.type === "directory" ? 
        (expandedFromState === undefined ? defaultIsExpanded : expandedFromState) : 
        undefined;
      
      let nodeWithUpdatedExpanded = {
        ...node,
        isExpanded: finalIsExpanded
      };
      
      // For file nodes, ensure we have the latest file data
      if (node.type === "file" && node.path && filesByPath) {
        const latestFileData = filesByPath.get(node.path);
        if (latestFileData && latestFileData !== node.fileData) {
          nodeWithUpdatedExpanded = { ...nodeWithUpdatedExpanded, fileData: latestFileData };
        }
      }
      
      // Add the current node
      result.push(nodeWithUpdatedExpanded);

      // If it's a directory and it's expanded, add its children
      if (nodeWithUpdatedExpanded.type === "directory" && 
          nodeWithUpdatedExpanded.isExpanded && 
          nodeWithUpdatedExpanded.children) {
        const childFlat = flattenNodesRecursively(nodeWithUpdatedExpanded.children);
        result.push(...childFlat);
      }
    }

    return result;
  };

  const flattened = flattenNodesRecursively(nodes);
  
  // Cache the result
  flattenCache.set(cacheKey, {
    result: flattened,
    timestamp: Date.now()
  });
  
  return flattened;
}

/**
 * Filter tree nodes based on search term
 */
export function filterTree(
  nodes: TreeNode[],
  searchTerm: string,
  filesByPath?: Map<string, FileData>
): TreeNode[] {
  if (!searchTerm) return nodes;

  const lowerTerm = searchTerm.toLowerCase();

  // Function to check if a node or any of its children match the search
  const nodeMatches = (node: TreeNode): boolean => {
    // Check if the node name matches
    if (node.name.toLowerCase().includes(lowerTerm)) return true;

    // If it's a file, we're done
    if (node.type === "file") return false;

    // For directories, check if any children match
    if (node.children) {
      return node.children.some(child => nodeMatches(child));
    }

    return false;
  };

  // Recursive filter function
  const filterNodesRecursively = (nodesToFilter: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    
    for (const node of nodesToFilter) {
      if (!nodeMatches(node)) continue;

      // For file nodes, ensure we have the latest file data
      if (node.type === "file" && node.path && filesByPath) {
        const latestFileData = filesByPath.get(node.path);
        if (latestFileData && latestFileData !== node.fileData) {
          result.push({ ...node, fileData: latestFileData });
          continue;
        }
      }

      // If it's a directory, also filter its children
      if (node.type === "directory" && node.children) {
        result.push({
          ...node,
          children: filterNodesRecursively(node.children),
          isExpanded: true, // Expand directories in search results
        });
        continue;
      }

      result.push(node);
    }
    
    return result;
  };

  return filterNodesRecursively(nodes);
}

/**
 * Clear the flatten cache
 */
export function clearFlattenCache(): void {
  flattenCache.clear();
}

/**
 * Get flatten cache statistics for memory monitoring
 */
export function getFlattenCacheStats(): { size: number; estimatedMemoryMB: number } {
  const entries = Array.from(flattenCache.entries());
  let totalMemory = 0;
  
  for (const [key, value] of entries) {
    // Estimate memory: key string + result array of TreeNodes
    const keyMemory = key.length * 2; // 2 bytes per char
    const resultMemory = JSON.stringify(value.result).length * 2;
    totalMemory += keyMemory + resultMemory + 8; // 8 bytes for timestamp
  }
  
  return {
    size: flattenCache.size,
    estimatedMemoryMB: totalMemory / (1024 * 1024)
  };
}

/**
 * Get flatten cache metrics for memory monitoring
 */
export function getFlattenCacheMetrics() {
  const entries = flattenCache.size;
  // Estimate memory based on average tree node size
  const estimatedMemoryPerEntry = 2000; // bytes, rough estimate
  const estimatedMemory = entries * estimatedMemoryPerEntry;
  
  return {
    entries,
    estimatedMemory,
    maxEntries: TREE_FLATTEN_CACHE.MAX_ENTRIES,
  };
}