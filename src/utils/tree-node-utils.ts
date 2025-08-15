import { TreeNode } from "../types/file-types";

/**
 * Recursively gets all directory node IDs from a tree structure
 */
export const getAllDirectoryNodeIds = (nodes: TreeNode[]): string[] => {
  let result: string[] = [];
  
  for (const node of nodes) {
    if (node.type === "directory") {
      result.push(node.id);
      if (node.children) {
        result = [...result, ...getAllDirectoryNodeIds(node.children)];
      }
    }
  }
  
  return result;
};

/**
 * Gets all collapsed directory node IDs from a tree structure
 */
export const getCollapsedDirectoryNodeIds = (
  nodes: TreeNode[], 
  expandedNodes: Record<string, boolean>
): string[] => {
  let result: string[] = [];
  
  for (const node of nodes) {
    if (node.type === "directory") {
      if (!expandedNodes[node.id]) {
        result.push(node.id);
      }
      if (node.children) {
        result = [...result, ...getCollapsedDirectoryNodeIds(node.children, expandedNodes)];
      }
    }
  }
  
  return result;
};

/**
 * Checks if all directory nodes in the tree are expanded
 */
export const areAllDirectoriesExpanded = (
  fileTree: TreeNode[], 
  expandedNodes: Record<string, boolean>
): boolean => {
  const allDirectoryIds = getAllDirectoryNodeIds(fileTree);
  
  // If there are no directories, all folders are considered expanded
  if (allDirectoryIds.length === 0) return true;
  
  // Check if all directory nodes are expanded
  return allDirectoryIds.every(id => expandedNodes[id]);
};

/**
 * Checks if there are any expanded folders
 */
export const hasAnyExpandedFolders = (expandedNodes: Record<string, boolean>): boolean => {
  return Object.values(expandedNodes).some(Boolean);
};