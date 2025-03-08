import { useMemo, useState, useEffect } from 'react';
import { FileData, TreeNode } from '../types/FileTypes';

interface UseFileTreeProps {
  allFiles: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  searchTerm: string;
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
  searchTerm
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
              children: children.sort((a, b) => {
                // Sort directories first
                if (a.type === "directory" && b.type === "file") return -1;
                if (a.type === "file" && b.type === "directory") return 1;

                // Sort files by token count (largest first)
                if (a.type === "file" && b.type === "file") {
                  const aTokens = a.fileData?.tokenCount || 0;
                  const bTokens = b.fileData?.tokenCount || 0;
                  return bTokens - aTokens;
                }

                // Default to alphabetical
                return a.name.localeCompare(b.name);
              }),
              isExpanded,
            };
          }
        });
      };

      // Convert to proper tree structure
      const treeRoots = convertToTreeNodes(fileMap);

      // Sort the top level (directories first, then by name)
      const sortedTree = treeRoots.sort((a, b) => {
        if (a.type === "directory" && b.type === "file") return -1;
        if (a.type === "file" && b.type === "directory") return 1;

        // Sort files by token count (largest first)
        if (a.type === "file" && b.type === "file") {
          const aTokens = a.fileData?.tokenCount || 0;
          const bTokens = b.fileData?.tokenCount || 0;
          return bTokens - aTokens;
        }

        return a.name.localeCompare(b.name);
      });

      setIsTreeBuildingComplete(true);
      return sortedTree;
    } catch (err) {
      console.error("Error building file tree:", err);
      setIsTreeBuildingComplete(true);
      return [];
    }
  }, [allFiles, selectedFolder, expandedNodes]);

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