import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FileData, TreeNode } from '../types/file-types';
import { clearTreeSortingCache } from '../utils/tree-sorting-service';

import { useFileTreeProcessing } from './use-file-tree-processing';

interface UseFileTreeProps {
  allFiles: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  searchTerm: string;
  fileTreeSortOrder?: string;
}

interface UseFileTreeResult {
  fileTree: TreeNode[];
  visibleTree: TreeNode[];
  isTreeBuildingComplete: boolean;
  treeProgress: number;
}

function useFileTree({
  allFiles,
  selectedFolder,
  expandedNodes,
  searchTerm,
  fileTreeSortOrder = 'default'
}: UseFileTreeProps): UseFileTreeResult {
  // Track previous values for change detection
  const prevSelectedFolderRef = useRef(selectedFolder);
  const prevSortOrderRef = useRef(fileTreeSortOrder);
  const prevExpandedNodesRef = useRef(expandedNodes);
  
  // Animation frame ID for throttling tree updates
  const rafIdRef = useRef<number>(0);
  
  // State for the committed tree
  const [committedTree, setCommittedTree] = useState<TreeNode[]>([]);
  
  // Throttled tree commit function using requestAnimationFrame
  const commitTree = useCallback((nodes: TreeNode[]) => {
    // Cancel any pending animation frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Schedule the tree update for the next animation frame
    rafIdRef.current = requestAnimationFrame(() => {
      setCommittedTree(nodes);
      rafIdRef.current = 0;
    });
  }, []);
  
  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Create a stable reference for file paths to prevent unnecessary rebuilds
  const filePathsRef = useRef<string[]>([]);
  const currentFilePaths = useMemo(() => allFiles.map(f => f.path).sort(), [allFiles]);
  
  // Check if file structure actually changed (not just metadata)
  const hasFileStructureChanged = useMemo(() => {
    const prevPaths = filePathsRef.current;
    if (prevPaths.length !== currentFilePaths.length) return true;
    
    for (const [i, prevPath] of prevPaths.entries()) {
      if (prevPath !== currentFilePaths[i]) return true;
    }
    
    return false;
  }, [currentFilePaths]);
  
  // Update the ref when structure changes
  useEffect(() => {
    if (hasFileStructureChanged) {
      filePathsRef.current = currentFilePaths;
    }
  }, [hasFileStructureChanged, currentFilePaths]);

  // Use the new processing hook for streaming tree building
  const {
    fileTree: processingTree,
    visibleTree: processingVisibleTree,
    isComplete: isTreeBuildingComplete,
    progress: treeProgress,
    refresh
  } = useFileTreeProcessing({
    allFiles,
    selectedFolder,
    expandedNodes,
    searchTerm,
    fileTreeSortOrder
  });

  // Commit processed tree updates with RAF throttling
  useEffect(() => {
    if (processingTree.length > 0 || (allFiles.length === 0 && processingTree.length === 0)) {
      commitTree(processingTree);
    }
  }, [processingTree, allFiles.length, commitTree]);

  // Handle selectedFolder changes
  useEffect(() => {
    const selectedFolderChanged = prevSelectedFolderRef.current !== selectedFolder;
    
    if (selectedFolderChanged) {
      prevSelectedFolderRef.current = selectedFolder;
      
      // Clear caches when selectedFolder changes
      clearTreeSortingCache();
      // The flatten cache in tree-node-transform is automatically invalidated
      // by the different tree structure
      
      // Trigger rebuild
      refresh();
    }
  }, [selectedFolder, refresh]);

  // Handle sort order changes
  useEffect(() => {
    const sortOrderChanged = prevSortOrderRef.current !== fileTreeSortOrder;
    
    if (sortOrderChanged) {
      prevSortOrderRef.current = fileTreeSortOrder;
      
      // Clear sorting cache when sort order changes
      clearTreeSortingCache();
      
      // Trigger rebuild to re-sort with new order
      refresh();
    }
  }, [fileTreeSortOrder, refresh]);

  // Handle expansion state changes
  useEffect(() => {
    const expansionChanged = JSON.stringify(prevExpandedNodesRef.current) !== JSON.stringify(expandedNodes);
    
    if (expansionChanged) {
      prevExpandedNodesRef.current = expandedNodes;
      
      // Don't clear caches for expansion changes, just trigger a re-render
      // The flatten cache will be invalidated by the different expandedKeys
    }
  }, [expandedNodes]);

  // Use the visible tree from the processing hook (already filtered and flattened in correct order)
  const visibleTree = processingVisibleTree;

  return {
    fileTree: committedTree,
    visibleTree,
    isTreeBuildingComplete,
    treeProgress
  };
}

export default useFileTree;