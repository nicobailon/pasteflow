/**
 * ASCII tree generation utilities
 */
import { basename, normalizePath, getRelativePath } from './path';

/**
 * Interface for tree node representation
 */
interface TreeNode {
  name: string;
  isFile: boolean;
  children: Record<string, TreeNode>;
}

/**
 * Generate an ASCII representation of the file tree for the selected files
 * @param items Array of objects containing path and isFile flag
 * @param rootPath The root directory path
 * @returns ASCII string representing the file tree
 */
export function generateAsciiFileTree(items: { path: string; isFile?: boolean }[], rootPath: string): string {
  if (items.length === 0) return "No files selected.";

  // Normalize the root path for consistent path handling
  const normalizedRoot = normalizePath(rootPath);
  
  // Build tree structure
  const root = buildFileTree(items, normalizedRoot);
  
  // Generate ASCII representation
  return generateAsciiFromTree(root);
}

/**
 * Build a tree structure from file paths
 * @param items Array of file path objects
 * @param normalizedRoot The normalized root path
 * @returns Root TreeNode of the file tree
 */
function buildFileTree(items: { path: string; isFile?: boolean }[], normalizedRoot: string): TreeNode {
  const root: TreeNode = { name: basename(normalizedRoot), isFile: false, children: {} };
  
  // Insert all items into the tree
  for (const item of items) {
    insertPath(item, root, normalizedRoot);
  }
  
  return root;
}

/**
 * Insert a file path into the tree
 * @param item File path object
 * @param node Current tree node
 * @param normalizedRoot The normalized root path
 */
function insertPath(item: { path: string; isFile?: boolean }, node: TreeNode, normalizedRoot: string): void {
  const { path: itemPath, isFile = true } = item;
  const normalizedPath = normalizePath(itemPath);
  
  // Get relative path
  const relativePath = getRelativePathForTree(normalizedPath, normalizedRoot);
  if (!relativePath) return;
  
  // Process path parts
  const pathParts = relativePath.split("/");
  insertPathParts(pathParts, node, isFile);
}

/**
 * Get relative path for tree building with appropriate validation
 * @param normalizedPath The normalized file path
 * @param normalizedRoot The normalized root path
 * @returns The relative path or null if invalid
 */
function getRelativePathForTree(normalizedPath: string, normalizedRoot: string): string | null {
  // Use the getRelativePath from path module which handles both Node and browser
  const relativePath = getRelativePath(normalizedPath, normalizedRoot);
  
  // If the relative path starts with '..' then it's outside the root directory
  if (relativePath.startsWith('..')) {
    return null;
  }
  
  // If empty or just the normalized path returned (not under root)
  if (!relativePath || relativePath === normalizedPath) {
    return null;
  }
  
  return relativePath;
}

/**
 * Insert path parts into the tree structure
 * @param pathParts Array of path parts
 * @param currentNode Current tree node
 * @param isFile Whether the final node represents a file
 */
function insertPathParts(pathParts: string[], currentNode: TreeNode, isFile: boolean): void {
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (!part) continue;
    
    const isLast = i === pathParts.length - 1;
    const nodeIsFile = isLast && isFile;
    
    if (!currentNode.children[part]) {
      currentNode.children[part] = {
        name: part,
        isFile: nodeIsFile,
        children: {}
      };
    } else if (isLast) {
      // If we're overriding an existing node and it's the last part,
      // respect the isFile flag
      currentNode.children[part].isFile = nodeIsFile;
    }
    
    currentNode = currentNode.children[part];
  }
}

/**
 * Generate ASCII representation from a tree structure
 * @param root Root node of the tree
 * @returns ASCII string representation
 */
function generateAsciiFromTree(root: TreeNode): string {
  const generateAscii = (node: TreeNode, prefix = "", isLast = true, isRoot = true): string => {
    if (isRoot) {
      // Root node special handling - just process children
      const children = getSortedChildren(node);
      
      return children
        .map((child, index) =>
          generateAscii(child, prefix, index === children.length - 1, false)
        )
        .join("");
    } 
    
    // Regular node handling
    let result = prefix;
    result += isLast ? "└── " : "├── ";
    result += node.name;
    result += "\n";
    
    // Update prefix for children
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    
    // Process children
    const children = getSortedChildren(node);
    return result + children
      .map((child, index) =>
        generateAscii(child, childPrefix, index === children.length - 1, false)
      )
      .join("");
  };
  
  return generateAscii(root);
}

/**
 * Get sorted children of a node (directories first, then alphabetical)
 * @param node Tree node
 * @returns Array of sorted child nodes
 */
function getSortedChildren(node: TreeNode): TreeNode[] {
  return Object.values(node.children).sort((a, b) => {
    // Sort by type (directories first) then by name
    if (a.isFile !== b.isFile) {
      return a.isFile ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}