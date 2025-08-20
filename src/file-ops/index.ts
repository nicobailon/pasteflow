/**
 * File operations suite - environment-safe utilities for path, tree, and filter operations
 */

// Path utilities
export {
  basename,
  dirname,
  join,
  extname,
  normalizePath,
  getRelativePath,
  getTopLevelDirectories,
  getAllDirectories
} from './path';

// ASCII tree generation
export {
  generateAsciiFileTree
} from './ascii-tree';

// File filters and policies
export {
  shouldExcludeByDefault,
  BINARY_EXTENSIONS,
  isBinaryExtension,
  isLikelyBinaryContent,
  MAX_FILE_SIZE_BYTES
} from './filters';

// Scan types
export type {
  DirectoryQueueItem,
  ProcessBatchResult
} from './scan-types';