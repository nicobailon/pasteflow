/**
 * Pure transformation functions for tree node operations.
 * This module handles building, flattening, and filtering tree nodes
 * without side effects or React dependencies.
 */

import type { FileData, TreeNode } from '../types/file-types';
import { TREE_FLATTEN_CACHE } from '@constants';

import { normalizePath } from '@file-ops/path';
import { BoundedLRUCache } from './bounded-lru-cache';

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
      const isExpanded = expansionState === undefined ? (level < 1) : expansionState;

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
 * Tree node structure for building file maps
 */
type TreeDirectoryNode = {
  name: string;
  path: string;
  children: Record<string, TreeDirectoryNode | TreeFileNode>;
  isDirectory: true;
  isExpanded: boolean;
};

type TreeFileNode = {
  name: string;
  path: string;
  isFile: true;
  fileData: FileData;
};

type TreeMapNode = TreeDirectoryNode | TreeFileNode;

/**
 * Build a hierarchical file map from a flat list of files
 */
export function buildFileMap(
  files: FileData[],
  selectedFolder: string | null,
  expandedNodes: Record<string, boolean>
): Record<string, TreeMapNode> {
  const fileMap: Record<string, TreeMapNode> = {};
  const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';

  for (const file of files) {
    if (!file.path) continue;

    const relativePath = getRelativePathForFile(file.path, selectedFolder, normalizedRootPath);
    if (relativePath === null) continue;

    buildFileMapEntry(fileMap, relativePath, file, selectedFolder, normalizedRootPath, expandedNodes);
  }

  return fileMap;
}

/**
 * Get relative path for a file, returning null if file should be excluded
 */
function getRelativePathForFile(
  filePath: string,
  selectedFolder: string | null,
  normalizedRootPath: string
): string | null {
  const normalizedFilePath = normalizePath(filePath);

  if (selectedFolder) {
    const underRoot = normalizedFilePath === normalizedRootPath || 
                     normalizedFilePath.startsWith(normalizedRootPath + '/');
    if (!underRoot) {
      return null;
    }
    return normalizedFilePath === normalizedRootPath 
      ? '' 
      : normalizedFilePath.slice(normalizedRootPath.length + 1);
  }

  return normalizedFilePath.replace(/^\/|^\\/, '');
}

/**
 * Build a single file map entry
 */
function buildFileMapEntry(
  fileMap: Record<string, TreeMapNode>,
  relativePath: string,
  file: FileData,
  selectedFolder: string | null,
  normalizedRootPath: string,
  expandedNodes: Record<string, boolean>
): void {
  const parts = relativePath.split('/');
  let currentPath = "";
  let current: Record<string, TreeMapNode> = fileMap;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    currentPath = buildCurrentPath(currentPath, part);
    
    if (isDirectoryPart(i, parts)) {
      current = ensureDirectoryExists(
        current, 
        part, 
        currentPath, 
        selectedFolder, 
        normalizedRootPath, 
        expandedNodes, 
        i
      );
    } else {
      createFileEntry(
        current, 
        part, 
        currentPath, 
        selectedFolder, 
        normalizedRootPath, 
        file
      );
    }
  }
}

/**
 * Build current path by appending part
 */
function buildCurrentPath(existingPath: string, part: string): string {
  return existingPath ? `${existingPath}/${part}` : part;
}

/**
 * Check if current part represents a directory
 */
function isDirectoryPart(index: number, parts: string[]): boolean {
  return index < parts.length - 1;
}

/**
 * Ensure directory exists in the file map and return its children
 */
function ensureDirectoryExists(
  current: Record<string, TreeMapNode>,
  part: string,
  currentPath: string,
  selectedFolder: string | null,
  normalizedRootPath: string,
  expandedNodes: Record<string, boolean>,
  depth: number
): Record<string, TreeMapNode> {
  const dirPath = calculateDirectoryPath(selectedFolder, normalizedRootPath, currentPath);
  
  if (!current[part]) {
    current[part] = createDirectoryNode(part, dirPath, expandedNodes, depth);
  }
  
  ensureChildrenExist(current[part] as TreeDirectoryNode);
  return (current[part] as TreeDirectoryNode).children;
}

/**
 * Calculate directory path
 */
function calculateDirectoryPath(
  selectedFolder: string | null,
  normalizedRootPath: string,
  currentPath: string
): string {
  return selectedFolder
    ? normalizePath(`${normalizedRootPath}/${currentPath}`)
    : normalizePath(`/${currentPath}`);
}

/**
 * Create directory node
 */
function createDirectoryNode(
  name: string,
  path: string,
  expandedNodes: Record<string, boolean>,
  depth: number
): TreeDirectoryNode {
  return {
    name,
    path,
    children: {},
    isDirectory: true as const,
    isExpanded: expandedNodes[path] ?? (depth < 2)
  };
}

/**
 * Ensure children property exists
 */
function ensureChildrenExist(node: TreeDirectoryNode): void {
  if (!node.children) {
    node.children = {};
  }
}

/**
 * Create file entry in the map
 */
function createFileEntry(
  current: Record<string, TreeMapNode>,
  part: string,
  currentPath: string,
  selectedFolder: string | null,
  normalizedRootPath: string,
  file: FileData
): void {
  const filePath = calculateDirectoryPath(selectedFolder, normalizedRootPath, currentPath);
  
  current[part] = {
    name: part,
    path: filePath,
    isFile: true as const,
    fileData: file
  };
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
  const cacheKey = createFlattenCacheKey(nodes, expandedNodes, searchTerm, selectedFolder);
  
  const cachedResult = getCachedFlattenResult(cacheKey, filesByPath);
  if (cachedResult) {
    return cachedResult;
  }

  const flattened = performTreeFlattening(nodes, expandedNodes, filesByPath);
  
  cacheFlattenResult(cacheKey, flattened);
  return flattened;
}

/**
 * Create cache key for flatten operation
 */
function createFlattenCacheKey(
  nodes: TreeNode[],
  expandedNodes: Record<string, boolean>,
  searchTerm?: string,
  selectedFolder?: string | null
): string {
  const treeIdentity = nodes
    .map(n => n.path)
    .sort()
    .join('|');
  
  const expandedKeys = Object.entries(expandedNodes)
    .filter(([_, expanded]) => expanded)
    .map(([path]) => path)
    .sort()
    .join('|');
  
  return `${treeIdentity}:${selectedFolder || ''}:${expandedKeys}:${searchTerm || ''}`;
}

/**
 * Get cached flatten result if available and up to date
 */
function getCachedFlattenResult(
  cacheKey: string,
  filesByPath?: Map<string, FileData>
): TreeNode[] | null {
  const cached = flattenCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  const { updatedResult, needsUpdate } = updateCachedFileData(cached.result, filesByPath);
  
  if (needsUpdate) {
    cached.result = updatedResult;
  }
  
  return cached.result;
}

/**
 * Update file data in cached results
 */
function updateCachedFileData(
  cachedResult: TreeNode[],
  filesByPath?: Map<string, FileData>
): { updatedResult: TreeNode[]; needsUpdate: boolean } {
  if (!filesByPath) {
    return { updatedResult: cachedResult, needsUpdate: false };
  }

  let needsUpdate = false;
  const updatedResult = cachedResult.map(node => {
    if (shouldUpdateFileData(node, filesByPath)) {
      const latestFileData = filesByPath.get(node.path!);
      if (latestFileData && latestFileData !== node.fileData) {
        needsUpdate = true;
        return { ...node, fileData: latestFileData };
      }
    }
    return node;
  });

  return { updatedResult, needsUpdate };
}

/**
 * Check if node file data should be updated
 */
function shouldUpdateFileData(
  node: TreeNode,
  filesByPath: Map<string, FileData>
): boolean {
  return node.type === "file" && 
         node.path !== undefined && 
         filesByPath.has(node.path);
}

/**
 * Perform the actual tree flattening
 */
function performTreeFlattening(
  nodes: TreeNode[],
  expandedNodes: Record<string, boolean>,
  filesByPath?: Map<string, FileData>
): TreeNode[] {
  return flattenNodesRecursively(nodes, expandedNodes, filesByPath);
}

/**
 * Recursively flatten tree nodes
 */
function flattenNodesRecursively(
  nodesToFlatten: TreeNode[],
  expandedNodes: Record<string, boolean>,
  filesByPath?: Map<string, FileData>
): TreeNode[] {
  const result: TreeNode[] = [];

  for (const node of nodesToFlatten) {
    const processedNode = processTreeNode(node, expandedNodes, filesByPath);
    result.push(processedNode);

    const childNodes = getExpandedChildNodes(processedNode);
    if (childNodes) {
      const childFlat = flattenNodesRecursively(childNodes, expandedNodes, filesByPath);
      result.push(...childFlat);
    }
  }

  return result;
}

/**
 * Process a single tree node
 */
function processTreeNode(
  node: TreeNode,
  expandedNodes: Record<string, boolean>,
  filesByPath?: Map<string, FileData>
): TreeNode {
  const finalIsExpanded = calculateExpansionState(node, expandedNodes);
  
  let processedNode: TreeNode = {
    ...node,
    ...(finalIsExpanded !== undefined && { isExpanded: finalIsExpanded })
  };
  
  if (shouldUpdateNodeFileData(node, filesByPath)) {
    processedNode = updateNodeFileData(processedNode, filesByPath!);
  }
  
  return processedNode;
}

/**
 * Calculate final expansion state for node
 */
function calculateExpansionState(
  node: TreeNode,
  expandedNodes: Record<string, boolean>
): boolean | undefined {
  if (node.type !== "directory") {
    return undefined;
  }

  const expandedFromState = expandedNodes[node.path];
  const defaultIsExpanded = node.isExpanded ?? false;
  
  return expandedFromState === undefined ? defaultIsExpanded : expandedFromState;
}

/**
 * Check if node file data should be updated
 */
function shouldUpdateNodeFileData(
  node: TreeNode,
  filesByPath?: Map<string, FileData>
): boolean {
  return node.type === "file" && 
         node.path !== undefined && 
         filesByPath !== undefined &&
         filesByPath.has(node.path);
}

/**
 * Update node with latest file data
 */
function updateNodeFileData(
  node: TreeNode,
  filesByPath: Map<string, FileData>
): TreeNode {
  const latestFileData = filesByPath.get(node.path!);
  if (latestFileData && latestFileData !== node.fileData) {
    return { ...node, fileData: latestFileData };
  }
  return node;
}

/**
 * Get child nodes if directory is expanded
 */
function getExpandedChildNodes(node: TreeNode): TreeNode[] | null {
  return node.type === "directory" && 
         node.isExpanded && 
         node.children 
    ? node.children 
    : null;
}

/**
 * Cache the flatten result
 */
function cacheFlattenResult(cacheKey: string, result: TreeNode[]): void {
  flattenCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
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
  const entries = [...flattenCache.entries()];
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