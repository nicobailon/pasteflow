import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FileData, TreeNode } from '../types/file-types';
import { normalizePath } from '../utils/path-utils';
import { StreamingTreeBuilder } from '../utils/streaming-tree-builder';
import { BoundedLRUCache } from '../utils/bounded-lru-cache';

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

// Cache for directory and file priorities to improve performance
// Using bounded LRU cache to prevent unbounded memory growth
const nodePriorityCache = new BoundedLRUCache<string, number>(1000);

// Function to clear the cache when sort order changes
const clearNodePriorityCache = () => {
  nodePriorityCache.clear();
};

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
  
  // Stable refs to avoid infinite loops
  const expandedNodesRef = useRef(expandedNodes);
  const fileTreeSortOrderRef = useRef(fileTreeSortOrder);
  const filesByPathRef = useRef(filesByPath);
  
  // Update refs when props change
  useEffect(() => {
    expandedNodesRef.current = expandedNodes;
  }, [expandedNodes]);
  
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
    shouldSort = false // Only sort when needed
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
        const children = item.children ? 
          convertToTreeNodes(item.children, level + 1, shouldSort) : [];
        
        const isExpanded = expandedNodesRef.current[item.path] ?? (level < 2);
        
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

  // Create a stable reference for file paths to prevent unnecessary rebuilds
  const filePathsRef = useRef<string[]>([]);
  const currentFilePaths = useMemo(() => allFiles.map(f => f.path).sort(), [allFiles]);
  
  // Check if file structure actually changed (not just metadata)
  const hasFileStructureChanged = useMemo(() => {
    const prevPaths = filePathsRef.current;
    if (prevPaths.length !== currentFilePaths.length) return true;
    
    for (let i = 0; i < prevPaths.length; i++) {
      if (prevPaths[i] !== currentFilePaths[i]) return true;
    }
    
    return false;
  }, [currentFilePaths]);
  
  // Update the ref when structure changes
  useEffect(() => {
    if (hasFileStructureChanged) {
      filePathsRef.current = currentFilePaths;
    }
  }, [hasFileStructureChanged, currentFilePaths]);

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
      if (allFiles.length > 1000) {
      // Cancel any existing builder
      if (streamingBuilderRef.current) {
        streamingBuilderRef.current.cancel();
      }
      
      try {
        streamingBuilderRef.current = new StreamingTreeBuilder(
          allFiles,
          500, // chunk size
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
        
        return () => {
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
        };
      } catch (error) {
        console.error('Failed to initialize StreamingTreeBuilder:', error);
        // Fall back to legacy batching
      }
    }
    
    // Legacy batch processing for small file sets or fallback
    processBatchLegacy();
    
    function processBatchLegacy() {
      fileMapRef.current = {};
      
      const BATCH_SIZE = 50; // Reduced batch size
      const BATCH_INTERVAL = 1; // Increased frequency (1ms)
      let processedCount = 0;
      
      const processBatch = () => {
      if (!processingStartedRef.current) {
        processingStartedRef.current = true;
      }

      const endIdx = Math.min(processedCount + BATCH_SIZE, allFiles.length);
      const batch = allFiles.slice(processedCount, endIdx);
      
      for (const file of batch) {
        if (!file.path) continue;

        const normalizedFilePath = normalizePath(file.path);
        const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';
        
        const relativePath = 
          selectedFolder && normalizedFilePath.startsWith(normalizedRootPath)
            ? normalizedFilePath
                .slice(normalizedRootPath.length)
                .replace(/^\/|^\\/, "")
            : normalizedFilePath;

        const parts = relativePath.split(/[/\\]/);
        let currentPath = "";
        let current = fileMapRef.current;

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!part) continue;

          currentPath = currentPath ? `${currentPath}/${part}` : part;
          
          if (i < parts.length - 1) {
            const dirPath = selectedFolder
              ? normalizePath(`${selectedFolder}/${currentPath}`)
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
              ? normalizePath(`${selectedFolder}/${currentPath}`)
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
      
      // Update tree without sorting for intermediate updates
      const intermediateTree = convertToTreeNodes(fileMapRef.current, 0, false);
      commitTree(intermediateTree);
      
      if (processedCount >= allFiles.length) {
        // Only sort the final tree when all files are processed
        const finalTree = convertToTreeNodes(fileMapRef.current, 0, true);
        commitTree(finalTree);
        setIsTreeBuildingComplete(true);
      } else {
        setTimeout(processBatch, BATCH_INTERVAL);
      }
    };
    
      if (allFiles.length > 0) {
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
      if (hasTreeDataRef.current || allFiles.length === 0) {
        setIsTreeBuildingComplete(true);
      }
    };
  }, [allFiles, selectedFolder, commitTree, convertToTreeNodes, hasFileStructureChanged]);

  // Effect to handle cleanup on sort order change
  useEffect(() => {
    if (prevSortOrderRef.current !== fileTreeSortOrder) {
      processingStartedRef.current = false;
      prevSortOrderRef.current = fileTreeSortOrder;
      clearNodePriorityCache();
      
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
    // If sortOrder is not 'default', use the existing sorting logic
    if (sortOrder !== 'default') {
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
            return sortDir === 'asc' ? aExt.localeCompare(bExt) || a.name.localeCompare(b.name) : bExt.localeCompare(aExt) || b.name.localeCompare(a.name);
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
    
    // For the 'default' sort order, implement the developer-focused algorithm
    return nodes.sort((a, b) => {
      // Primary Division: Directories first, files second
      if (a.type === "directory" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "directory") return 1;
      
      // Directory Sorting Rules
      if (a.type === "directory" && b.type === "directory") {
        // Helper function to get directory priority - memoized for performance
        const getDirectoryPriority = (node: TreeNode): number => {
          // Check cache first
          const cacheKey = `dir-${node.id}`;
          if (nodePriorityCache.has(cacheKey)) {
            return nodePriorityCache.get(cacheKey)!;
          }
          
          const name = node.name.toLowerCase();
          let priority: number;
          
          // 1. Core source and functionality directories
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
          default: { if (name === '__mocks__' || name.startsWith('__') || name.endsWith('__')) priority = 30;
          // Hidden directories (with leading dot)
          else if (name.startsWith('.')) priority = 40;
          // All other directories
          else priority = 50;
          }
          }
          
          // Cache the result
          nodePriorityCache.set(cacheKey, priority);
          return priority;
        };
        
        const aPriority = getDirectoryPriority(a);
        const bPriority = getDirectoryPriority(b);
        
        // Sort by priority first
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        // Within same priority group, sort alphabetically
        return a.name.localeCompare(b.name);
      }
      
      // File Sorting Priority
      if (a.type === "file" && b.type === "file") {
        // Helper function to get file priority - memoized for performance
        const getFilePriority = (node: TreeNode): number => {
          // Check cache first
          const cacheKey = `file-${node.id}`;
          if (nodePriorityCache.has(cacheKey)) {
            return nodePriorityCache.get(cacheKey)!;
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
          nodePriorityCache.set(cacheKey, priority);
          return priority;
        };
        
        const aPriority = getFilePriority(a);
        const bPriority = getFilePriority(b);
        
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
    };
  }, [fileTreeSortOrder]);

  // Flatten the tree for rendering with proper indentation
  const flattenTree = useCallback((nodes: TreeNode[]): TreeNode[] => {
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
          result = [...result, ...flattenNodesRecursively(nodeWithUpdatedExpanded.children)];
        }
      }

      return result;
    };

    return flattenNodesRecursively(nodes);
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
      return nodesToFilter.filter(node => nodeMatches(node)).map((node) => {
        // For file nodes, ensure we have the latest file data
        // Use filesByPath directly instead of the ref to ensure we get the latest data
        if (node.type === "file" && node.path) {
          const latestFileData = filesByPath.get(node.path);
          if (latestFileData && latestFileData !== node.fileData) {
            node = { ...node, fileData: latestFileData };
          }
        }
        
        // If it's a directory, also filter its children
        if (node.type === "directory" && node.children) {
          return {
            ...node,
            children: sortTreeNodes(filterNodesRecursively(node.children), fileTreeSortOrderRef.current),
            isExpanded: true, // Auto-expand directories when searching
          };
        }
        return node;
      });
    };

    // Filter the nodes and maintain the same sort order
    const filteredNodes = filterNodesRecursively(nodes);
    return sortTreeNodes(filteredNodes, fileTreeSortOrderRef.current);
  }, [filesByPath]);

  // The final tree to render, filtered and flattened
  const visibleTree = useMemo(() => {
    // If there's no search term and the tree isn't complete, return unfiltered tree
    if (!searchTerm && !isTreeBuildingComplete) {
      return flattenTree(fileTree);
    }
    
    // Only apply filtering and sorting when needed
    return flattenTree(filterTree(fileTree, searchTerm));
  }, [fileTree, searchTerm, isTreeBuildingComplete, filterTree, flattenTree, expandedNodes, allFiles]);

  return {
    fileTree,
    visibleTree,
    isTreeBuildingComplete,
    treeProgress
  };
}

export default useFileTree;