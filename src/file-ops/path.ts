/**
 * Path utilities for both browser and Node.js environments
 */
import * as nodePath from 'node:path';

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
 * Normalizes a file path to use forward slashes and no trailing slash
 * @param path The path to normalize
 * @returns Normalized path
 */
export function normalizePath(path: string | null | undefined): string {
  if (!path) return '';
  
  if (isNode) {
    // Normalize using Node.js path module, then ensure forward slashes
    const norm = nodePath.normalize(String(path)).replace(/\\/g, '/');
    return norm === '/' ? '/' : norm.replace(/\/$/, '');
  }
  
  // Browser fallback implementation
  const norm = String(path).replace(/\\/g, '/');
  return norm === '/' ? '/' : norm.replace(/\/$/, '');
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