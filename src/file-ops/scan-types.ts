/**
 * Cross-cutting types supporting scan orchestration (no fs operations)
 */

/**
 * Represents an item in the directory processing queue
 */
export interface DirectoryQueueItem {
  path: string;
  depth: number;
}

/**
 * Result of processing a batch of directories
 */
export interface ProcessBatchResult {
  nextBatchDirs: DirectoryQueueItem[];
  processedDirsCount: number;
  filesInBatch: number;
}