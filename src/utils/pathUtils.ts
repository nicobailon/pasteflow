/**
 * Path utilities for both browser and Node.js environments
 */
import * as nodePath from 'path';

// Check if we're in a Node.js environment
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

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
  const filteredSegments = segments.filter(Boolean).map(seg => String(seg));
  
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

  files.forEach(file => {
    const normalizedPath = normalizePath(file.path);
    let relativePath;
    
    if (isNode) {
      try {
        // Use Node's path module to get relative path
        relativePath = nodePath.relative(normalizedRoot, normalizedPath);
        // Convert to forward slashes for consistency
        relativePath = relativePath.replace(/\\/g, '/');
      } catch (error) {
        console.error("Error calculating relative path:", error);
        // Fallback to string manipulation if Node's path.relative fails
        if (normalizedPath.startsWith(normalizedRoot + '/')) {
          relativePath = normalizedPath.substring(normalizedRoot.length + 1);
        } else {
          // Skip this file if we can't calculate the relative path
          return;
        }
      }
    } else {
      // Browser environment - use string manipulation
      if (normalizedPath.startsWith(normalizedRoot + '/')) {
        relativePath = normalizedPath.substring(normalizedRoot.length + 1);
      } else {
        // Skip this file if it's not under the root
        return;
      }
    }
    
    const parts = relativePath.split('/');
    if (parts.length > 0) {
      // Use join to ensure proper path handling
      topLevelDirs.add(isNode ? 
        nodePath.join(normalizedRoot, parts[0]).replace(/\\/g, '/') : 
        `${normalizedRoot}/${parts[0]}`);
    }
  });

  return Array.from(topLevelDirs);
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

  files.forEach(file => {
    const normalizedPath = normalizePath(file.path);
    let relativePath;
    
    if (isNode) {
      try {
        // Check if the file is within the root directory
        relativePath = nodePath.relative(normalizedRoot, normalizedPath);
        // If the relative path starts with '..' then it's outside the root directory
        if (relativePath.startsWith('..') || relativePath === '') {
          return; // Skip this file
        }
      } catch (error) {
        console.error("Error calculating relative path:", error);
        // Fallback to string manipulation
        if (!normalizedPath.startsWith(normalizedRoot + '/')) {
          return; // Skip this file if it's not under the root
        }
      }
    } else {
      // Browser environment
      if (!normalizedPath.startsWith(normalizedRoot + '/')) {
        return; // Skip this file if it's not under the root
      }
    }
    
    // Extract all parent directories from file path
    let currentPath = dirname(normalizedPath);
    
    while (currentPath !== normalizedRoot && currentPath.length >= normalizedRoot.length) {
      // Normalize the current path before comparison
      const normalizedCurrentPath = normalizePath(currentPath);
      
      // Add the directory to our set
      directories.add(normalizedCurrentPath);
      
      // Get the parent directory
      currentPath = dirname(normalizedCurrentPath);
      
      // Stop if we've reached or gone past the root
      if (currentPath === normalizedRoot || currentPath.length < normalizedRoot.length) {
        break;
      }
    }
  });

  return Array.from(directories);
}

/**
 * Generate an ASCII representation of the file tree for the selected files
 * @param items Array of objects containing path and isFile flag
 * @param rootPath The root directory path
 * @returns ASCII string representing the file tree
 */
export function generateAsciiFileTree(items: { path: string; isFile?: boolean }[], rootPath: string): string {
  if (!items.length) return "No files selected.";

  // Normalize the root path for consistent path handling
  const normalizedRoot = normalizePath(rootPath);
  
  // Create a tree structure from the file paths
  interface TreeNode {
    name: string;
    isFile: boolean;
    children: Record<string, TreeNode>;
  }
  
  const root: TreeNode = { name: basename(normalizedRoot), isFile: false, children: {} };
  
  // Insert a file path into the tree
  const insertPath = (item: { path: string; isFile?: boolean }, node: TreeNode) => {
    const { path: itemPath, isFile = true } = item;
    const normalizedPath = normalizePath(itemPath);
    
    let relativePath;
    
    if (isNode) {
      try {
        // Check if the path is under the root directory
        relativePath = nodePath.relative(normalizedRoot, normalizedPath);
        // If the relative path starts with '..' then it's outside the root directory
        if (relativePath.startsWith('..')) {
          return; // Skip this item
        }
        // Ensure forward slashes for consistency
        relativePath = relativePath.replace(/\\/g, '/');
      } catch (error) {
        console.error("Error calculating relative path:", error);
        // Fallback to string manipulation
        if (!normalizedPath.startsWith(normalizedRoot)) {
          return; // Skip this item if it's not under the root
        }
        relativePath = normalizedPath.substring(normalizedRoot.length).replace(/^\//, "");
      }
    } else {
      // Browser environment
      if (!normalizedPath.startsWith(normalizedRoot)) {
        return; // Skip this item if it's not under the root
      }
      relativePath = normalizedPath.substring(normalizedRoot.length).replace(/^\//, "");
    }
    
    if (!relativePath) return;
    
    const pathParts = relativePath.split("/");
    let currentNode = node;
    
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
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
  };
  
  // Insert all items into the tree
  items.forEach(item => insertPath(item, root));
  
  // Generate ASCII representation
  const generateAscii = (node: TreeNode, prefix = "", isLast = true, isRoot = true): string => {
    if (!isRoot) {
      let result = prefix;
      result += isLast ? "└── " : "├── ";
      result += node.name;
      result += "\n";
      prefix += isLast ? "    " : "│   ";
      
      const children = Object.values(node.children).sort((a, b) => {
        // Sort by type (directories first) then by name
        if (a.isFile !== b.isFile) {
          return a.isFile ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      });
      
      return result + children
        .map((child, index) =>
          generateAscii(child, prefix, index === children.length - 1, false)
        )
        .join("");
    } else {
      // Root node special handling
      const children = Object.values(node.children).sort((a, b) => {
        // Sort by type (directories first) then by name
        if (a.isFile !== b.isFile) {
          return a.isFile ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      });
      
      return children
        .map((child, index) =>
          generateAscii(child, prefix, index === children.length - 1, false)
        )
        .join("");
    }
  };
  
  return generateAscii(root);
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
    return normalizedFile.substring(normalizedBase.length + 1);
  }
  
  return normalizedFile;
}