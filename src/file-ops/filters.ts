/**
 * File filtering utilities (no fs operations)
 */
import { loadGitignore } from '../utils/ignore-utils';

import { getRelativePath, extname } from './path';

// Binary file extensions
export const BINARY_EXTENSIONS: Readonly<Set<string>> = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.avi', '.mov', '.mkv', '.flac',
  '.zip', '.rar', '.tar', '.gz', '.7z',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.class', '.o', '.pyc',
  '.db', '.sqlite', '.sqlite3',
  '.woff', '.woff2', '.ttf', '.eot',
  '.jar', '.war', '.ear',
  '.bin', '.dat', '.pak',
  '.node', '.wasm'
]);

// Maximum file size in bytes (5MB)
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Check if a file extension indicates a binary file
 * @param ext The file extension (with or without leading dot)
 * @returns true if the extension indicates a binary file
 */
export function isBinaryExtension(ext: string): boolean {
  const normalizedExt = ext.toLowerCase();
  // Handle both with and without leading dot
  return BINARY_EXTENSIONS.has(normalizedExt) || 
         BINARY_EXTENSIONS.has('.' + normalizedExt);
}

// Regex pattern to detect potential binary content
/* eslint-disable-next-line no-control-regex */
const BINARY_CONTENT_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u00FF]{50,}/;

/**
 * Check if file content is likely binary based on content analysis
 * @param content The file content as a string
 * @param filePath The file path (used to check for JS exception)
 * @returns true if the content appears to be binary
 */
export function isLikelyBinaryContent(content: string, filePath: string): boolean {
  // Skip binary content check for JavaScript files
  if (filePath) {
    const ext = extname(filePath).toLowerCase();
    if (ext === '.js') {
      return false;
    }
  }
  // Special tokens handled via sanitization during token counting,
  // not during binary detection, to allow analysis of AI/ML codebases
  // Check for sequences of non-ASCII characters
  return BINARY_CONTENT_REGEX.test(content);
}

/**
 * Check if a file should be excluded by default based on gitignore patterns
 * @param filePath The file path to check
 * @param rootDir The root directory containing the .gitignore
 * @returns true if the file should be excluded
 */
export function shouldExcludeByDefault(filePath: string, rootDir: string): boolean {
  // Calculate relative path using the imported function from path module
  const relativePath = getRelativePath(filePath, rootDir);
  // Normalize to forward slashes for gitignore matching (getRelativePath already does this, but ensure consistency)
  const relativePathNormalized = relativePath.replace(/\\/g, "/");
  return loadGitignore(rootDir).ignores(relativePathNormalized);
}

// Extension extraction is now handled by the shared extname function from path module