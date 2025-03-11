import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { FileData, TreeNode } from '../types/FileTypes';

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
}

// Cache for node priorities to avoid recalculating
const nodePriorityCache = new Map<string, number>();

// Function to clear the cache when needed
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
  const [isTreeBuildingComplete, setIsTreeBuildingComplete] = useState(false);
  // Reference to track previous sort order for cache invalidation
  const prevSortOrderRef = useRef(fileTreeSortOrder);

  // Effect to check if sort order changed and clear cache if needed
  useEffect(() => {
    if (prevSortOrderRef.current !== fileTreeSortOrder) {
      // Sort order changed, clear the cache
      clearNodePriorityCache();
      prevSortOrderRef.current = fileTreeSortOrder;
    }
  }, [fileTreeSortOrder]);

  // Build file tree structure from flat list of files using useMemo
  const fileTree = useMemo(() => {
    if (allFiles.length === 0) {
      return [];
    }

    console.log("Building file tree from", allFiles.length, "files");

    try {
      // Create a structured representation using nested objects first
      const fileMap: Record<string, any> = {};

      // First pass: create directories and files
      allFiles.forEach((file) => {
        if (!file.path) return;

        const relativePath =
          selectedFolder && file.path.startsWith(selectedFolder)
            ? file.path
                .substring(selectedFolder.length)
                .replace(/^\/|^\\/, "")
            : file.path;

        const parts = relativePath.split(/[/\\]/);
        let currentPath = "";
        let current = fileMap;

        // Build the path in the tree
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!part) continue;

          currentPath = currentPath ? `${currentPath}/${part}` : part;
          const fullPath = selectedFolder
            ? `${selectedFolder}/${currentPath}`
            : currentPath;

          if (i === parts.length - 1) {
            // This is a file
            current[part] = {
              id: `node-${fullPath}`,
              name: part,
              path: fullPath,
              type: "file",
              level: i,
              fileData: file,
            };
          } else {
            // This is a directory
            if (!current[part]) {
              current[part] = {
                id: `node-${fullPath}`,
                name: part,
                path: fullPath,
                type: "directory",
                level: i,
                children: {},
              };
            }
            current = current[part].children;
          }
        }
      });

      // Convert the nested object structure to the TreeNode array format
      const convertToTreeNodes = (
        node: Record<string, any>,
        level = 0,
      ): TreeNode[] => {
        return Object.keys(node).map((key) => {
          const item = node[key];

          if (item.type === "file") {
            return item as TreeNode;
          } else {
            const children = convertToTreeNodes(item.children, level + 1);
            const isExpanded =
              expandedNodes[item.id] !== undefined
                ? expandedNodes[item.id]
                : true; // Default to expanded if not in state

            return {
              ...item,
              children: sortTreeNodes(children, fileTreeSortOrder),
              isExpanded,
            };
          }
        });
      };

      // Function to sort tree nodes based on sort order
      const sortTreeNodes = (nodes: TreeNode[], sortOrder: string): TreeNode[] => {
        // Clear cache when sort order changes to ensure fresh priorities
        if (sortOrder !== prevSortOrderRef.current) {
          nodePriorityCache.clear();
          prevSortOrderRef.current = sortOrder;
        }

        // If sortOrder is not 'default', use the existing sorting logic
        if (sortOrder !== 'default') {
          return nodes.sort((a, b) => {
            // Sort directories first, regardless of sort order (unless specified otherwise)
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
              if (name === 'src') priority = 1;
              else if (name === 'scripts') priority = 2;
              else if (name === 'public') priority = 3;
              else if (name === 'lib') priority = 4;
              else if (name === 'docs') priority = 5;
              else if (name === 'app' || name === 'app_components') priority = 6;
              else if (name === 'actions') priority = 7;
              // 2. Special directories
              else if (name === '.github') priority = 20;
              // 3. Testing directories
              else if (name === '__mocks__' || name.startsWith('__') || name.endsWith('__')) priority = 30;
              // Hidden directories (with leading dot)
              else if (name.startsWith('.')) priority = 40;
              // All other directories
              else priority = 50;
              
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

      // Convert to proper tree structure
      const treeRoots = convertToTreeNodes(fileMap);

      // Sort the top level nodes
      const sortedTree = sortTreeNodes(treeRoots, fileTreeSortOrder);

      return sortedTree;
    } catch (err) {
      console.error("Error building file tree:", err);
      return [];
    }
  }, [allFiles, selectedFolder, expandedNodes, fileTreeSortOrder]);

  // Update the tree building complete state after the memo is computed
  useEffect(() => {
    if (allFiles.length === 0) {
      setIsTreeBuildingComplete(false);
    } else if (fileTree.length > 0) {
      setIsTreeBuildingComplete(true);
    }
  }, [allFiles.length, fileTree.length]);

  // Flatten the tree for rendering with proper indentation
  const flattenTree = useCallback((nodes: TreeNode[]): TreeNode[] => {
    // Define recursive flatten function inside to avoid dependency issue
    const flattenNodesRecursively = (nodesToFlatten: TreeNode[]): TreeNode[] => {
      let result: TreeNode[] = [];

      nodesToFlatten.forEach((node) => {
        // Add the current node
        result.push(node);

        // If it's a directory and it's expanded, add its children
        if (node.type === "directory" && node.isExpanded && node.children) {
          result = [...result, ...flattenNodesRecursively(node.children)];
        }
      });

      return result;
    };

    return flattenNodesRecursively(nodes);
  }, []);

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
        return node.children.some(nodeMatches);
      }

      return false;
    };

    // Define recursive filter function inside to avoid dependency issue
    const filterNodesRecursively = (nodesToFilter: TreeNode[]): TreeNode[] => {
      return nodesToFilter.filter(nodeMatches).map((node) => {
        // If it's a directory, also filter its children
        if (node.type === "directory" && node.children) {
          return {
            ...node,
            children: filterNodesRecursively(node.children),
            isExpanded: true, // Auto-expand directories when searching
          };
        }
        return node;
      });
    };

    // Filter the nodes
    return filterNodesRecursively(nodes);
  }, []);

  // The final tree to render, filtered and flattened
  const visibleTree = useMemo(() => {
    return flattenTree(filterTree(fileTree, searchTerm));
  }, [fileTree, searchTerm, filterTree, flattenTree]);

  return {
    fileTree,
    visibleTree,
    isTreeBuildingComplete
  };
}

export default useFileTree;