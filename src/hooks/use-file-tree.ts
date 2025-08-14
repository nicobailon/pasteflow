import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FileData, TreeNode } from '../types/file-types';
import { normalizePath } from '../utils/path-utils';
import { StreamingTreeBuilder } from '../utils/streaming-tree-builder';
import { getTreeSortingService, clearTreeSortingCache } from '../utils/tree-sorting-service';

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

// Get the singleton tree sorting service instance
const treeSortingService = getTreeSortingService();

function useFileTree({
  allFiles,
  selectedFolder,
  expandedNodes,
  searchTerm,
  fileTreeSortOrder = 'default'
}: UseFileTreeProps): UseFileTreeResult {
  // Create a map for quick file lookups by path
  const filesByPath = useMemo((): Map<string, FileData> => {
    const map = new Map<string, FileData>();
    for (const file of allFiles) {
      if (file.path) {
        map.set(file.path, file);
      }
    }
    return map;
  }, [allFiles]);
  const [isTreeBuildingComplete, setIsTreeBuildingComplete] = useState(false);
  const [fileTree, setFileTree] = useState([] as TreeNode[]);
  const [treeProgress, setTreeProgress] = useState(0);
  
  // Animation frame ID for throttling tree updates
  const rafIdRef = useRef<number>(0);
  
  // Streaming tree builder instance
  const streamingBuilderRef = useRef<StreamingTreeBuilder | null>(null);
  const hasTreeDataRef = useRef(false);
  
  // Reference to track previous sort order for cache invalidation
  const prevSortOrderRef = useRef(fileTreeSortOrder);
  
  // Reference to track if we've already started processing
  const processingStartedRef = useRef(false);
  
  // Reference to store the complete file map
  const fileMapRef = useRef<Record<string, any>>({});
  
  // Cache for flattened tree results
  const flattenCacheRef = useRef<{
    nodes: TreeNode[];
    expandedKeys: string;
    result: TreeNode[];
  } | null>(null);
  
  // Stable refs to avoid infinite loops
  const expandedNodesRef = useRef(expandedNodes);
  const fileTreeSortOrderRef = useRef(fileTreeSortOrder);
  const filesByPathRef = useRef(filesByPath);
  
  // Update refs when props change
  useEffect(() => {
    expandedNodesRef.current = expandedNodes;
  }, [expandedNodes]);
  
  // Track previous expansion state to detect changes
  const prevExpandedNodesRef = useRef(expandedNodes);
  
  useEffect(() => {
    fileTreeSortOrderRef.current = fileTreeSortOrder;
  }, [fileTreeSortOrder]);
  
  useEffect(() => {
    filesByPathRef.current = filesByPath;
  }, [filesByPath]);
  
  // Throttled tree commit function using requestAnimationFrame
  const commitTree = useCallback((nodes: TreeNode[]) => {
    // Cancel any pending animation frame
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Track if we have tree data
    if (nodes.length > 0) {
      hasTreeDataRef.current = true;
    }
    
    // Schedule the tree update for the next animation frame
    rafIdRef.current = requestAnimationFrame(() => {
      setFileTree(nodes);
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
  
  // Convert the nested object structure to the TreeNode array format
  // Now with deferred sorting
  const convertToTreeNodes = useCallback((
    node: Record<string, any>,
    level = 0,
    shouldSort = false, // Only sort when needed
    maxDepth: number = Number.POSITIVE_INFINITY
  ): TreeNode[] => {
    if (!node) return [];

    return Object.keys(node).map((key) => {
      const item = node[key];

      if (item.isFile) {
        // Get the latest file data from the map
        const latestFileData = filesByPathRef.current.get(item.path) || item.fileData;
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
          convertToTreeNodes(item.children, level + 1, shouldSort, maxDepth) : [];

        const isExpanded = expandedNodesRef.current[item.path] ?? (level < 1);

        // Only sort children if explicitly requested and the node is expanded
        const sortedChildren = (shouldSort && isExpanded) ?
          sortTreeNodes(children, fileTreeSortOrderRef.current) :
          children;

        return {
          ...item,
          type: 'directory',
          level,
          id: item.path || `dir-${Math.random().toString(36).slice(2, 11)}`,
          children: sortedChildren,
          isExpanded,
        } as TreeNode;
      }
    });
  }, []);

  // Force tree rebuild when expansion state changes for same file structure
  useEffect(() => {
    // Check if expansion state actually changed (not just ref update)
    const expansionChanged = JSON.stringify(prevExpandedNodesRef.current) !== JSON.stringify(expandedNodes);
    
    if (expansionChanged && fileMapRef.current && Object.keys(fileMapRef.current).length > 0) {
      // Update the ref
      prevExpandedNodesRef.current = expandedNodes;
      
      // Clear the flatten cache to ensure fresh results
      flattenCacheRef.current = null;
      
      // Rebuild the tree with new expansion state
      const rebuiltTree = convertToTreeNodes(fileMapRef.current, 0, true);
      commitTree(rebuiltTree);
    }
  }, [expandedNodes, commitTree, convertToTreeNodes]);

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
      // Clear flatten cache when structure changes
      if (flattenCacheRef.current) {
        flattenCacheRef.current = null;
      }
    }
  }, [hasFileStructureChanged, currentFilePaths]);

  // Store allFiles in a ref to use the latest version without triggering rebuilds
  const allFilesRef = useRef(allFiles);
  useEffect(() => {
    allFilesRef.current = allFiles;
  }, [allFiles]);

  // Process files in smaller batches for better responsiveness
  useEffect(() => {
    // Skip rebuild if only metadata changed
    if (!hasFileStructureChanged && hasTreeDataRef.current) {
      return;
    }
    
    processingStartedRef.current = false;
    hasTreeDataRef.current = false;
    setIsTreeBuildingComplete(false);
    setTreeProgress(0);
    
    // Small delay to prevent rapid rebuilds when toggling folders
    const timeoutId = setTimeout(() => {
      // Use StreamingTreeBuilder for large file sets
      if (allFilesRef.current.length > 1000) {
        // Cancel any existing builder
        if (streamingBuilderRef.current) {
          streamingBuilderRef.current.cancel();
        }
        
        try {
          streamingBuilderRef.current = new StreamingTreeBuilder(
            allFilesRef.current,
            1000, // Increased chunk size for faster initial display
            selectedFolder,
            expandedNodesRef.current
          );
          
          streamingBuilderRef.current.start(
            // onChunk
            (chunk) => {
              commitTree(chunk.nodes);
              setTreeProgress(chunk.progress);
            },
            // onComplete
            () => {
              setIsTreeBuildingComplete(true);
              setTreeProgress(100);
              streamingBuilderRef.current = null;
            },
            // onError
            (error) => {
              console.error('StreamingTreeBuilder error:', error);
              // Fall back to legacy batching
              streamingBuilderRef.current = null;
              processBatchLegacy();
            }
          );
          // IMPORTANT: do not run legacy builder too—stop here.
          return;
        } catch (error) {
          console.error('Failed to initialize StreamingTreeBuilder:', error);
          // Fall back to legacy batching
        }
      }
      
      // Legacy batch processing for small file sets or fallback
      processBatchLegacy();
    
    function processBatchLegacy() {
      fileMapRef.current = {};
      
      const BATCH_SIZE = 200; // Increased batch size for faster initial display
      const BATCH_INTERVAL = 1; // Fast processing (1ms)
      let processedCount = 0;
      
      const processBatch = () => {
      if (!processingStartedRef.current) {
        processingStartedRef.current = true;
      }

      const endIdx = Math.min(processedCount + BATCH_SIZE, allFilesRef.current.length);
      const batch = allFilesRef.current.slice(processedCount, endIdx);
      
      for (const file of batch) {
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
        let current = fileMapRef.current;

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
                isExpanded: expandedNodesRef.current[dirPath] ?? (i < 2)
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
      
      processedCount = endIdx;
      
      // Update tree without sorting for intermediate updates; limit depth to reduce work
      const intermediateTree = convertToTreeNodes(fileMapRef.current, 0, false, 3);
      commitTree(intermediateTree);
      // Update progress
      if (allFilesRef.current.length > 0) {
        const p = Math.min(100, Math.round((processedCount / allFilesRef.current.length) * 100));
        setTreeProgress(p);
      }

      if (processedCount >= allFilesRef.current.length) {
        // Only sort the final tree when all files are processed (full depth)
        const finalTree = convertToTreeNodes(fileMapRef.current, 0, true, Number.POSITIVE_INFINITY);
        commitTree(finalTree);
        setIsTreeBuildingComplete(true);
        setTreeProgress(100);
      } else {
        setTimeout(processBatch, BATCH_INTERVAL);
      }
    };
    
      if (allFilesRef.current.length > 0) {
        processBatch();
      } else {
        commitTree([]);
        setIsTreeBuildingComplete(true);
        setTreeProgress(100);
      }
    }
    }, 50); // 50ms delay to debounce rapid changes
    
    return () => {
      clearTimeout(timeoutId);
      processingStartedRef.current = false;
      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      // Cancel streaming builder if active
      if (streamingBuilderRef.current) {
        streamingBuilderRef.current.cancel();
        streamingBuilderRef.current = null;
      }
      // Ensure tree building state is not stuck
      // Only set to complete if we have some tree data or no files
      if (hasTreeDataRef.current || allFilesRef.current.length === 0) {
        setIsTreeBuildingComplete(true);
      }
    };
  }, [hasFileStructureChanged, selectedFolder, commitTree, convertToTreeNodes]);

  // Effect to handle cleanup on sort order change
  useEffect(() => {
    if (prevSortOrderRef.current !== fileTreeSortOrder) {
      processingStartedRef.current = false;
      prevSortOrderRef.current = fileTreeSortOrder;
      clearTreeSortingCache();
      
      // Re-sort the existing tree without rebuilding
      if (fileMapRef.current && Object.keys(fileMapRef.current).length > 0) {
        const sortedTree = convertToTreeNodes(fileMapRef.current, 0, true);
        commitTree(sortedTree);
      }
    }
  }, [fileTreeSortOrder, commitTree, convertToTreeNodes]);

  // Memoized function to sort tree nodes based on sort order
  const sortTreeNodes = useMemo(() => {
    return (nodes: TreeNode[], sortOrder: string): TreeNode[] => {
      return treeSortingService.sortTreeNodes(nodes, sortOrder);
    };
  }, []);

  // Flatten the tree for rendering with proper indentation
  const flattenTree = useCallback((nodes: TreeNode[]): TreeNode[] => {
    // Create a stable key from expanded nodes for cache comparison
    const expandedKeys = Object.entries(expandedNodes)
      .filter(([_, expanded]) => expanded)
      .map(([path]) => path)
      .sort()
      .join('|');
    
    // Check cache first
    if (flattenCacheRef.current && 
        flattenCacheRef.current.nodes === nodes && 
        flattenCacheRef.current.expandedKeys === expandedKeys) {
      // Update file data in cached results if needed
      const cachedResult = flattenCacheRef.current.result;
      let needsUpdate = false;
      
      const updatedResult = cachedResult.map(node => {
        if (node.type === "file" && node.path) {
          const latestFileData = filesByPath.get(node.path);
          if (latestFileData && latestFileData !== node.fileData) {
            needsUpdate = true;
            return { ...node, fileData: latestFileData };
          }
        }
        return node;
      });
      
      if (needsUpdate) {
        flattenCacheRef.current.result = updatedResult;
        return updatedResult;
      }
      
      return cachedResult;
    }
    // Define recursive flatten function inside to avoid dependency issue
    const flattenNodesRecursively = (nodesToFlatten: TreeNode[]): TreeNode[] => {
      let result: TreeNode[] = [];

      for (const node of nodesToFlatten) {
        // Clone the node and update its isExpanded property based on expandedNodes
        const expandedFromState = expandedNodes[node.path];
        const defaultIsExpanded = node.isExpanded ?? false; // Default expanded state from tree building
        
        // IMPORTANT: We need to check if this path has EVER been toggled
        // If it hasn't been toggled (undefined in expandedNodes), use the default state
        // If it has been toggled, use the toggled state regardless of default
        const finalIsExpanded = node.type === "directory" ? 
          (expandedFromState === undefined ? defaultIsExpanded : expandedFromState) : 
          undefined;
          
        
        let nodeWithUpdatedExpanded = {
          ...node,
          // Don't modify the level - it's already set correctly when building the tree
          // Determine expansion state from expandedNodes prop, preserving the node's default if not explicitly set
          isExpanded: finalIsExpanded
        };
        
        // For file nodes, ensure we have the latest file data
        // Use filesByPath directly instead of the ref to ensure we get the latest data
        if (node.type === "file" && node.path) {
          const latestFileData = filesByPath.get(node.path);
          if (latestFileData && latestFileData !== node.fileData) {
            nodeWithUpdatedExpanded = { ...nodeWithUpdatedExpanded, fileData: latestFileData };
          }
        }
        
        // Add the current node
        result.push(nodeWithUpdatedExpanded);

        // If it's a directory and it's expanded, add its children
        if (nodeWithUpdatedExpanded.type === "directory" && nodeWithUpdatedExpanded.isExpanded && nodeWithUpdatedExpanded.children) {
          const childFlat = flattenNodesRecursively(nodeWithUpdatedExpanded.children);
          for (let k = 0; k < childFlat.length; k++) {
            result.push(childFlat[k]);
          }
        }
      }

      return result;
    };

    const flattened = flattenNodesRecursively(nodes);
    
    // Cache the result
    flattenCacheRef.current = {
      nodes,
      expandedKeys,
      result: flattened
    };
    
    return flattened;
  }, [expandedNodes, filesByPathRef, filesByPath])

  // Filter the tree based on search term
  const filterTree = useCallback((nodes: TreeNode[], term: string): TreeNode[] => {
    if (!term) return nodes;

    const lowerTerm = term.toLowerCase();

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

    // Define recursive filter function inside to avoid dependency issue
    const filterNodesRecursively = (nodesToFilter: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (let i = 0; i < nodesToFilter.length; i++) {
        const node = nodesToFilter[i];
        if (!nodeMatches(node)) continue;

        // For file nodes, ensure we have the latest file data
        if (node.type === "file" && node.path) {
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
            isExpanded: true,
          });
          continue;
        }

        result.push(node);
      }
      return result;
    };

    // Filter the nodes - they maintain their existing sort order from the tree
    // No need to re-sort since nodes are already sorted when tree is built
    return filterNodesRecursively(nodes);
  }, [filesByPath]);

  // The final tree to render, filtered and flattened
  const visibleTree = useMemo(() => {
    // If there's no search term and the tree isn't complete, return unfiltered tree
    if (!searchTerm && !isTreeBuildingComplete) {
      return flattenTree(fileTree);
    }

    // Only apply filtering and sorting when needed
    return flattenTree(filterTree(fileTree, searchTerm));
  }, [fileTree, searchTerm, isTreeBuildingComplete, filterTree, flattenTree, expandedNodes]);

  return {
    fileTree,
    visibleTree,
    isTreeBuildingComplete,
    treeProgress
  };
}

export default useFileTree;