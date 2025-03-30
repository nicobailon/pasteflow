/**
 * Path utilities for both browser and Node.js environments
 */
import * as nodePath from 'node:path';

// Check if we're in a Node.js environment
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

/**
 * Interface for tree node representation
 */
interface TreeNode {
  name: string;
  isFile: boolean;
  children: Record<string, TreeNode>;
}

/**
 * Extract the basename from a path string
 * @param path The path to extract the basename from
 * @returns The basename (last part of the path)
 */
export function basename(path: string | null | undefined): string {
  if (!path) return "";
  
  if (isNode) {
    return nodePath.basename(String(path));
  }

  // Browser fallback implementation
  // Ensure path is a string
  const pathStr = String(path);

  // Handle both forward and backslashes
  const normalizedPath = pathStr.replace(/\\/g, "/");
  // Remove trailing slashes
  const trimmedPath = normalizedPath.endsWith("/")
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
  // Get the last part after the final slash
  const parts = trimmedPath.split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Extract the directory name from a path string
 * @param path The path to extract the directory from
 * @returns The directory (everything except the last part)
 */
export function dirname(path: string | null | undefined): string {
  if (!path) return ".";
  
  if (isNode) {
    return nodePath.dirname(String(path));
  }

  // Browser fallback implementation
  // Ensure path is a string
  const pathStr = String(path);

  // Handle both forward and backslashes
  const normalizedPath = pathStr.replace(/\\/g, "/");
  // Remove trailing slashes
  const trimmedPath = normalizedPath.endsWith("/")
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
  // Get everything before the final slash
  const lastSlashIndex = trimmedPath.lastIndexOf("/");
  return lastSlashIndex === -1 ? "." : trimmedPath.slice(0, lastSlashIndex);
}

/**
 * Join path segments together
 * @param segments The path segments to join
 * @returns The joined path
 */
export function join(...segments: (string | null | undefined)[]): string {
  const filteredSegments = segments.filter(Boolean).map(String);
  
  if (isNode) {
    return nodePath.join(...filteredSegments);
  }
  
  // Browser fallback implementation
  return filteredSegments
    .join("/")
    .replace(/\/+/g, "/"); // Replace multiple slashes with a single one
}

/**
 * Get the file extension
 * @param path The path to get the extension from
 * @returns The file extension including the dot
 */
export function extname(path: string | null | undefined): string {
  if (!path) return "";
  
  if (isNode) {
    return nodePath.extname(String(path));
  }

  // Browser fallback implementation
  const basenameValue = basename(path);
  const dotIndex = basenameValue.lastIndexOf(".");
  return dotIndex === -1 || dotIndex === 0 ? "" : basenameValue.slice(dotIndex);
}

/**
 * Get the top-level directories from a list of files
 * @param files Array of file objects with path property
 * @param rootPath The root directory path
 * @returns Array of top-level directory paths
 */
export function getTopLevelDirectories(files: { path: string }[], rootPath: string): string[] {
  const topLevelDirs = new Set<string>();
  const normalizedRoot = normalizePath(rootPath);

  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    const relativePath = calculateRelativePath(normalizedPath, normalizedRoot);
    
    if (!relativePath) continue;
    
    const parts = relativePath.split('/');
    if (parts.length > 0) {
      // Use join to ensure proper path handling
      topLevelDirs.add(isNode ? 
        nodePath.join(normalizedRoot, parts[0]).replace(/\\/g, '/') : 
        `${normalizedRoot}/${parts[0]}`);
    }
  }

  return [...topLevelDirs];
}

/**
 * Helper function to calculate relative path in both Node and browser environments
 * @param normalizedPath The normalized file path
 * @param normalizedRoot The normalized root path
 * @returns The relative path or empty string if not under root
 */
function calculateRelativePath(normalizedPath: string, normalizedRoot: string): string {
  if (isNode) {
    try {
      // Use Node's path module to get relative path
      const relativePath = nodePath.relative(normalizedRoot, normalizedPath);
      // Convert to forward slashes for consistency
      return relativePath.replace(/\\/g, '/');
    } catch (error) {
      console.error("Error calculating relative path:", error);
      // Fallback to string manipulation if Node's path.relative fails
      if (normalizedPath.startsWith(normalizedRoot + '/')) {
        return normalizedPath.slice(Math.max(0, normalizedRoot.length + 1));
      }
      return '';
    }
  } else {
    // Browser environment - use string manipulation
    if (normalizedPath.startsWith(normalizedRoot + '/')) {
      return normalizedPath.slice(Math.max(0, normalizedRoot.length + 1));
    }
    return '';
  }
}

/**
 * Get all directories (including nested ones) from a list of files
 * @param files Array of file objects with path property
 * @param rootPath The root directory path
 * @returns Array of all directory paths
 */
export function getAllDirectories(files: { path: string }[], rootPath: string): string[] {
  const directories = new Set<string>();
  const normalizedRoot = normalizePath(rootPath);

  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    const relativePath = calculateRelativePath(normalizedPath, normalizedRoot);
    
    // Skip invalid paths
    if (!relativePath || relativePath.startsWith('..') || relativePath === '') {
      continue;
    }
    
    // Add all parent directories
    addAllParentDirectories(normalizedPath, normalizedRoot, directories);
  }

  return [...directories];
}

/**
 * Add all parent directories of a path to the given set
 * @param filePath The file path to extract directories from
 * @param rootPath The root directory path
 * @param directories The set to add directories to
 */
function addAllParentDirectories(filePath: string, rootPath: string, directories: Set<string>): void {
  let currentPath = dirname(filePath);
  
  while (currentPath !== rootPath && currentPath.length >= rootPath.length) {
    // Normalize the current path before comparison
    const normalizedCurrentPath = normalizePath(currentPath);
    
    // Add the directory to our set
    directories.add(normalizedCurrentPath);
    
    // Get the parent directory
    currentPath = dirname(normalizedCurrentPath);
    
    // Stop if we've reached or gone past the root
    if (currentPath === rootPath || currentPath.length < rootPath.length) {
      break;
    }
  }
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
  let relativePath;
  
  if (isNode) {
    try {
      // Check if the path is under the root directory
      relativePath = nodePath.relative(normalizedRoot, normalizedPath);
      // If the relative path starts with '..' then it's outside the root directory
      if (relativePath.startsWith('..')) {
        return null;
      }
      // Ensure forward slashes for consistency
      return relativePath.replace(/\\/g, '/');
    } catch {
      // Fallback to string manipulation
      if (!normalizedPath.startsWith(normalizedRoot)) {
        return null;
      }
      return normalizedPath.slice(normalizedRoot.length).replace(/^\//, "");
    }
  } else {
    // Browser environment
    if (!normalizedPath.startsWith(normalizedRoot)) {
      return null;
    }
    return normalizedPath.slice(normalizedRoot.length).replace(/^\//, "");
  }
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

/**
 * Normalizes a file path to use forward slashes and no trailing slash
 * @param path The path to normalize
 * @returns Normalized path
 */
export function normalizePath(path: string | null | undefined): string {
  if (!path) return '';
  
  if (isNode) {
    // Normalize using Node.js path module, then ensure forward slashes
    return nodePath.normalize(String(path)).replace(/\\/g, '/').replace(/\/$/, '');
  }
  
  // Browser fallback implementation
  return String(path).replace(/\\/g, '/').replace(/\/$/, '');
}

/**
 * Gets a path relative to a base directory
 * @param filePath The absolute file path
 * @param baseDir The base directory path
 * @returns Path relative to baseDir
 */
export function getRelativePath(filePath: string | null | undefined, baseDir: string | null | undefined): string {
  if (!filePath) return '';
  if (!baseDir) return String(filePath);
  
  if (isNode) {
    try {
      // Use Node.js path.relative function
      const relativePath = nodePath.relative(String(baseDir), String(filePath));
      // Convert to forward slashes for consistency
      return relativePath.replace(/\\/g, '/');
    } catch (error) {
      console.error("Error calculating relative path:", error);
      // Fall back to browser implementation if there's an error
    }
  }
  
  // Browser fallback implementation
  const normalizedFile = normalizePath(filePath);
  const normalizedBase = normalizePath(baseDir);
  
  if (normalizedBase && normalizedFile.startsWith(normalizedBase + '/')) {
    return normalizedFile.slice(Math.max(0, normalizedBase.length + 1));
  }
  
  return normalizedFile;
}