import { useMemo, useState, useEffect } from 'react';
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

function useFileTree({
  allFiles,
  selectedFolder,
  expandedNodes,
  searchTerm,
  fileTreeSortOrder = 'default'
}: UseFileTreeProps): UseFileTreeResult {
  const [isTreeBuildingComplete, setIsTreeBuildingComplete] = useState(false);

  // Build file tree structure from flat list of files using useMemo
  const fileTree = useMemo(() => {
    if (allFiles.length === 0) {
      setIsTreeBuildingComplete(false);
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
                // use a placeholder sorting method
                return sortDir === 'asc' ? -1 : 1;
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
            // Helper function to get directory priority
            const getDirectoryPriority = (node: TreeNode): number => {
              const name = node.name.toLowerCase();
              
              // 1. Core source and functionality directories
              if (name === 'src') return 1;
              if (name === 'scripts') return 2;
              if (name === 'public') return 3;
              if (name === 'lib') return 4;
              if (name === 'docs') return 5;
              if (name === 'app' || name === 'app_components') return 6;
              if (name === 'actions') return 7;
              
              // 2. Special directories
              if (name === '.github') return 20;
              
              // 3. Testing directories
              if (name === '__mocks__' || name.startsWith('__') || name.endsWith('__')) return 30;
              
              // Hidden directories (with leading dot)
              if (name.startsWith('.')) return 40;
              
              // All other directories
              return 50;
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
            // Helper function to get file priority
            const getFilePriority = (node: TreeNode): number => {
              const name = node.name.toLowerCase();
              
              // 1. Build configuration files
              if (/vite\.config\.ts$/i.test(name) || 
                  /tsconfig\.node\.json$/i.test(name) ||
                  /tsconfig\.json$/i.test(name)) {
                return 1;
              }
              
              // 2. Runtime files
              if (/renderer\.js$/i.test(name)) {
                return 2;
              }
              
              // 3. Documentation files (in decreasing importance)
              if (/^release\.md$/i.test(name)) {
                return 3;
              }
              if (/^readme\.md$/i.test(name)) {
                return 4;
              }
              if (/^readme\.docker\.md$/i.test(name)) {
                return 5;
              }
              if (/^readme_.*\.md$/i.test(name)) {
                return 6;
              }
              
              // 4. Application support files
              if (/^preload\.js$/i.test(name)) {
                return 10;
              }
              
              // 5. Project configuration
              if (/^package\.json$/i.test(name)) {
                return 20;
              }
              
              // 6. User files
              if (/^new notepad$/i.test(name)) {
                return 30;
              }
              
              // 7. Entry point files
              if (/^main\.js$/i.test(name)) {
                return 40;
              }
              
              // 8. Legal files
              if (/^license$/i.test(name)) {
                return 50;
              }
              
              // 9. Testing configuration
              if (/^jest\.setup\.js$/i.test(name) ||
                  /^jest\.config\.js$/i.test(name)) {
                return 60;
              }
              
              // Default priority for other files
              return 100;
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

      setIsTreeBuildingComplete(true);
      return sortedTree;
    } catch (err) {
      console.error("Error building file tree:", err);
      setIsTreeBuildingComplete(true);
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
  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    let result: TreeNode[] = [];

    nodes.forEach((node) => {
      // Add the current node
      result.push(node);

      // If it's a directory and it's expanded, add its children
      if (node.type === "directory" && node.isExpanded && node.children) {
        result = [...result, ...flattenTree(node.children)];
      }
    });

    return result;
  };

  // Filter the tree based on search term
  const filterTree = (nodes: TreeNode[], term: string): TreeNode[] => {
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

    // Filter the nodes
    return nodes.filter(nodeMatches).map((node) => {
      // If it's a directory, also filter its children
      if (node.type === "directory" && node.children) {
        return {
          ...node,
          children: filterTree(node.children, term),
          isExpanded: true, // Auto-expand directories when searching
        };
      }
      return node;
    });
  };

  // The final tree to render, filtered and flattened
  const visibleTree = useMemo(() => {
    return flattenTree(filterTree(fileTree, searchTerm));
  }, [fileTree, searchTerm]);

  return {
    fileTree,
    visibleTree,
    isTreeBuildingComplete
  };
}

export default useFileTree;