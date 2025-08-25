/**
 * Hook that encapsulates streaming tree building integration with the worker pool.
 * Provides progress events, debounced rebuilds, and clean API for UI hooks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UI } from '@constants';

import type { FileData, TreeNode } from '../types/file-types';
import {
  flattenTree,
  filterTree,
  clearFlattenCache,
  buildFileMap,
  buildTreeNodesFromMap
} from '../utils/tree-node-transform';
import { getTreeSortingService, clearTreeSortingCache } from '../utils/tree-sorting-service';
import { getTreeBuilderWorkerPool } from '../utils/tree-builder-worker-pool';

interface UseFileTreeProcessingProps {
  allFiles: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  searchTerm: string;
  fileTreeSortOrder?: string;
}

interface UseFileTreeProcessingResult {
  fileTree: TreeNode[];
  visibleTree: TreeNode[];
  isComplete: boolean;
  progress: number;
  refresh: () => void;
}

// Get the singleton tree sorting service instance
const treeSortingService = getTreeSortingService();

// Helper function to recursively sort tree nodes at all levels
function sortTreeNodesRecursively(nodes: TreeNode[], sortOrder: string): TreeNode[] {
  // Sort current level
  const sortedNodes = treeSortingService.sortTreeNodes([...nodes], sortOrder);
  
  // Recursively sort children
  return sortedNodes.map(node => {
    if (node.type === 'directory' && node.children && node.children.length > 0) {
      return {
        ...node,
        children: sortTreeNodesRecursively(node.children, sortOrder)
      };
    }
    return node;
  });
}

export function useFileTreeProcessing({
  allFiles,
  selectedFolder,
  expandedNodes,
  searchTerm,
  fileTreeSortOrder = 'default'
}: UseFileTreeProcessingProps): UseFileTreeProcessingResult {
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  
  // Create a map for quick file lookups by path
  const filesByPath = useRef<Map<string, FileData>>(new Map());
  
  // Build handle reference for cancellation
  const buildHandleRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  
  // Animation frame ID for throttling tree updates
  const rafIdRef = useRef<number>(0);
  // Synchronous initial nodes for deterministic first render (used in tests and initial mount)
  const initialNodesRef = useRef<TreeNode[] | null>(null);
  
  // Track file paths for structure change detection
  const filePathsRef = useRef<string[]>([]);
  const prevSortOrderRef = useRef(fileTreeSortOrder);
  const prevExpandedNodesRef = useRef(expandedNodes);
  
  // Update files map when allFiles changes
  useEffect(() => {
    const map = new Map<string, FileData>();
    for (const file of allFiles) {
      if (file.path) {
        map.set(file.path, file);
      }
    }
    filesByPath.current = map;
  }, [allFiles]);
  
  // Throttled tree commit function using requestAnimationFrame
  const commitTree = useCallback((nodes: TreeNode[]) => {
    // In tests or when RAF isn't available, commit synchronously for determinism
    const useSync = typeof requestAnimationFrame !== 'function' || process.env.NODE_ENV === 'test';
    if (useSync) {
      setFileTree(nodes);
      return;
    }

    // Cancel any pending animation frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Schedule the tree update for the next animation frame
    rafIdRef.current = requestAnimationFrame(() => {
      setFileTree(nodes);
      rafIdRef.current = 0;
    });
  }, []);
  
  // Check if file structure actually changed (not just metadata)
  const hasFileStructureChanged = useCallback((): boolean => {
    const currentFilePaths = allFiles.map(f => f.path).sort();
    const prevPaths = filePathsRef.current;
    
    if (prevPaths.length !== currentFilePaths.length) {
      filePathsRef.current = currentFilePaths;
      return true;
    }
    
    for (const [i, prevPath] of prevPaths.entries()) {
      if (prevPath !== currentFilePaths[i]) {
        filePathsRef.current = currentFilePaths;
        return true;
      }
    }
    
    return false;
  }, [allFiles]);
  
  // Build tree from files
  const buildTree = useCallback(() => {
    // Cancel any existing build (fire and forget in this case)
    if (buildHandleRef.current) {
      buildHandleRef.current.cancel();
      buildHandleRef.current = null;
    }
    
    setIsComplete(false);
    setProgress(0);
    
    // Synchronous initial render for determinism and tests
    try {
      const initialMap = buildFileMap(allFiles, selectedFolder, expandedNodes);
      const deps = {
        // Default collapsed unless explicitly present in expandedNodes
        expandedLookup: (path: string) =>
          Object.prototype.hasOwnProperty.call(expandedNodes, path) ? expandedNodes[path] : false,
        sortOrder: fileTreeSortOrder || 'default'
      };
      const initialBuilt = buildTreeNodesFromMap(initialMap as Record<string, any>, 0, deps, Number.POSITIVE_INFINITY);
      const initialNodes = sortTreeNodesRecursively(initialBuilt, fileTreeSortOrder || 'default');
      commitTree(initialNodes);
    } catch {
      // best-effort initial tree; continue with worker streaming
    }
    
    // Always use the worker pool for tree building
    const pool = getTreeBuilderWorkerPool();
    
    try {
      buildHandleRef.current = pool.startStreaming(
        {
          files: allFiles,
          selectedFolder,
          expandedNodes,
          chunkSize: UI.TREE.CHUNK_SIZE
        },
        {
          onChunk: (chunk: { nodes: TreeNode[]; progress: number }) => {
            // Apply sorting to nodes before committing
            const sortedNodes = sortTreeNodesRecursively(chunk.nodes, fileTreeSortOrder || 'default');
            commitTree(sortedNodes);
            setProgress(chunk.progress);
          },
          onComplete: (done: { nodes: TreeNode[]; progress: number }) => {
            // Commit final fully-built tree from worker (authoritative)
            const sortedFinal = sortTreeNodesRecursively(done.nodes, fileTreeSortOrder || 'default');
            commitTree(sortedFinal);
            setIsComplete(true);
            setProgress(done.progress ?? 100);
            buildHandleRef.current = null;
          },
          onError: (error: Error) => {
            console.error('Tree build error:', error);
            // No fallback - propagate error
            setIsComplete(true);
            buildHandleRef.current = null;
          }
        }
      );
    } catch (error) {
      console.error('Failed to start tree build:', error);
      setIsComplete(true);
    }
  }, [allFiles, selectedFolder, expandedNodes, commitTree, fileTreeSortOrder]);
  
  // Rebuild tree when structure changes
  useEffect(() => {
    if (!hasFileStructureChanged() && fileTree.length > 0) {
      return;
    }
    
    // Clear caches when structure changes
    clearFlattenCache();
    clearTreeSortingCache();
    initialNodesRef.current = null;
    
    // Small delay to debounce rapid changes
    const timeoutId = setTimeout(() => {
      buildTree();
    }, UI.TREE.UPDATE_DEBOUNCE_MS);
    
    return () => {
      clearTimeout(timeoutId);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      if (buildHandleRef.current) {
        // Cancel without awaiting since we're in cleanup
        buildHandleRef.current.cancel();
        buildHandleRef.current = null;
      }
    };
  }, [hasFileStructureChanged, buildTree, fileTree.length]);
  
  // Manual refresh function
  const refresh = useCallback(() => {
    clearFlattenCache();
    clearTreeSortingCache();
    buildTree();
  }, [buildTree]);

  // Handle expansion state changes
  // Do NOT rebuild the tree on expansion; the final tree contains all nodes.
  // Simply clear flatten cache so the visible tree re-computes instantly without flicker.
  useEffect(() => {
    const expansionChanged = JSON.stringify(prevExpandedNodesRef.current) !== JSON.stringify(expandedNodes);
    
    if (expansionChanged) {
      prevExpandedNodesRef.current = expandedNodes;
      clearFlattenCache();
      // No worker call here; avoids progress overlay and preserves current fileTree
    }
  }, [expandedNodes]);
  
  // Handle sort order changes
  useEffect(() => {
    if (prevSortOrderRef.current !== fileTreeSortOrder) {
      prevSortOrderRef.current = fileTreeSortOrder;
      clearTreeSortingCache();
      clearFlattenCache();
      initialNodesRef.current = null;
      
      // Trigger a full rebuild with new sort order
      refresh();
    }
  }, [fileTreeSortOrder, refresh]);
  
  // Compute visible tree (filtered and flattened)
  const visibleTree = useMemo(() => {
    // Choose base nodes: prefer streamed state; otherwise, build a synchronous initial tree
    const baseNodes: TreeNode[] = fileTree.length > 0 ? fileTree : (() => {
      if (!initialNodesRef.current) {
        const fileMap = buildFileMap(allFiles, selectedFolder, expandedNodes);
        const deps = {
          // Default collapsed unless explicitly present in expandedNodes
          expandedLookup: (path: string) =>
            Object.prototype.hasOwnProperty.call(expandedNodes, path) ? expandedNodes[path] : false,
          sortOrder: fileTreeSortOrder || 'default'
        };
        const nodes = buildTreeNodesFromMap(fileMap as Record<string, any>, 0, deps, Number.POSITIVE_INFINITY);
        initialNodesRef.current = sortTreeNodesRecursively(nodes, fileTreeSortOrder || 'default');
      }
      return initialNodesRef.current!;
    })();

    // Apply filtering if search term exists
    const filtered = searchTerm
      ? filterTree(baseNodes, searchTerm, filesByPath.current)
      : baseNodes;
    
    // Flatten for rendering with expansion state applied
    return flattenTree(filtered, expandedNodes, searchTerm, filesByPath.current, selectedFolder);
  }, [fileTree, allFiles, selectedFolder, expandedNodes, searchTerm, fileTreeSortOrder]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (buildHandleRef.current) {
        // Cancel without awaiting since we're in cleanup
        buildHandleRef.current.cancel();
      }
    };
  }, []);
  
  return {
    fileTree,
    visibleTree,
    isComplete,
    progress,
    refresh
  };
}