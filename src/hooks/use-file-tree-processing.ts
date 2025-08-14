/**
 * Hook that encapsulates streaming tree building integration with the worker pool.
 * Provides progress events, debounced rebuilds, and clean API for UI hooks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileData, TreeNode } from '../types/file-types';
import { 
  flattenTree, 
  filterTree,
  clearFlattenCache 
} from '../utils/tree-node-transform';
import { getTreeSortingService, clearTreeSortingCache } from '../utils/tree-sorting-service';
import { getTreeBuilderWorkerPool } from '../utils/tree-builder-worker-pool';
import { UI } from '../constants/app-constants';

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
    
    // Always use the worker pool for tree building
    const pool = getTreeBuilderWorkerPool();
    
    try {
      buildHandleRef.current = pool.startStreamingBuild(
        {
          files: allFiles,
          selectedFolder,
          expandedNodes,
          chunkSize: UI.TREE.CHUNK_SIZE
        },
        {
          onChunk: (chunk) => {
            // Apply sorting to nodes before committing
            const sortedNodes = sortTreeNodesRecursively(chunk.nodes, fileTreeSortOrder || 'default');
            commitTree(sortedNodes);
            setProgress(chunk.progress);
          },
          onComplete: () => {
            setIsComplete(true);
            setProgress(100);
            buildHandleRef.current = null;
          },
          onError: (error) => {
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
  }, [allFiles, selectedFolder, expandedNodes, commitTree]);
  
  // Rebuild tree when structure changes
  useEffect(() => {
    if (!hasFileStructureChanged() && fileTree.length > 0) {
      return;
    }
    
    // Clear caches when structure changes
    clearFlattenCache();
    clearTreeSortingCache();
    
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
  }, [hasFileStructureChanged, buildTree]);
  
  // Manual refresh function
  const refresh = useCallback(() => {
    clearFlattenCache();
    clearTreeSortingCache();
    buildTree();
  }, [buildTree]);

  // Handle expansion state changes
  useEffect(() => {
    const expansionChanged = JSON.stringify(prevExpandedNodesRef.current) !== JSON.stringify(expandedNodes);
    
    if (expansionChanged) {
      prevExpandedNodesRef.current = expandedNodes;
      // Expansion changes are handled by clearing the flatten cache
      // The visible tree will be recomputed with the new expansion state
      clearFlattenCache();
    }
  }, [expandedNodes]);
  
  // Handle sort order changes
  useEffect(() => {
    if (prevSortOrderRef.current !== fileTreeSortOrder) {
      prevSortOrderRef.current = fileTreeSortOrder;
      clearTreeSortingCache();
      clearFlattenCache();
      
      // Trigger a full rebuild with new sort order
      refresh();
    }
  }, [fileTreeSortOrder, refresh]);
  
  // Compute visible tree (filtered and flattened)
  const visibleTree = useMemo(() => {
    // Apply filtering if search term exists
    const filtered = searchTerm ? 
      filterTree(fileTree, searchTerm, filesByPath.current) : 
      fileTree;
    
    // Flatten for rendering
    return flattenTree(filtered, expandedNodes, searchTerm, filesByPath.current, selectedFolder);
  }, [fileTree, expandedNodes, searchTerm, selectedFolder]);
  
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