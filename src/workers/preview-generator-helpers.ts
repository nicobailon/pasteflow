// Helper functions extracted from preview-generator-worker.ts to reduce complexity

// Import types from the worker file
type LineRange = { start: number; end: number };

type SelectedFileReference = {
  path: string;
  lines?: LineRange[];
};

type FileData = {
  name: string;
  path: string;
  isDirectory: boolean;
  isContentLoaded?: boolean;
  tokenCount?: number;
  children?: FileData[];
  content?: string;
  size: number;
  isBinary: boolean;
  isSkipped: boolean;
  error?: string;
  fileType?: string;
  isCountingTokens?: boolean;
  tokenCountError?: string;
};

type UpdateFile = { 
  path: string; 
  content: string; 
  tokenCount?: number;
};

export interface EmitContext {
  currentId: string | null;
  isCancelled: boolean;
  emittedPaths: Set<string>;
  pendingPaths: Set<string>;
  failedPaths: Set<string>;
  skippedPaths: Set<string>;
  pendingTimeouts: Map<string, number>;
  retryCounts: Map<string, number>;
  tokenTotal: number;
  totalEligibleFiles: number;
}

export interface FileEmitResult {
  displayBlock: string;
  fullBlock: string;
  tokenDelta: number;
}

export const RETRY_MAX_ATTEMPTS = 3 as const;
export const RETRY_DELAY_MS = 100 as const;
export const RETRY_BACKOFF_MULTIPLIER = 2 as const;
export const DEBUG_ENABLED = false as const;
export const PENDING_FILE_TIMEOUT = 30_000 as const; // 30 seconds

type BuildFileBlocksFunction = (
  fd: FileData,
  sel: SelectedFileReference | undefined,
  folder: string | null
) => FileEmitResult;

type IsTransientErrorFunction = (error: unknown) => boolean;
type HandlePendingTimeoutFunction = (path: string) => void;

// Handle file emission failure
export function handleFileEmitFailure(
  path: string,
  error: unknown,
  context: EmitContext,
  isTransientError: IsTransientErrorFunction,
  scheduleRetry: (path: string) => void
): void {
  if (context.emittedPaths.has(path)) return;

  const isTransient = isTransientError(error);
  
  if (isTransient) {
    scheduleRetry(path);
  } else {
    // Non-transient error, mark as failed immediately
    context.pendingPaths.delete(path);
    context.failedPaths.add(path);
    context.skippedPaths.delete(path);
    
    const timeout = context.pendingTimeouts.get(path);
    if (timeout) {
      clearTimeout(timeout);
      context.pendingTimeouts.delete(path);
    }
    
    context.retryCounts.delete(path);
  }
  
  if (DEBUG_ENABLED) {
    console.log('[Worker] Build blocks failed:', path, error);
  }
}

// Mark file as successfully emitted
export function markFileAsEmitted(
  path: string,
  context: EmitContext
): void {
  context.emittedPaths.add(path);
  context.pendingPaths.delete(path);
  context.failedPaths.delete(path);
  context.skippedPaths.delete(path);
  
  const timeout = context.pendingTimeouts.get(path);
  if (timeout) {
    clearTimeout(timeout);
    context.pendingTimeouts.delete(path);
  }
  
  context.retryCounts.delete(path);
}

// Check if file can be emitted
export function canEmitFile(
  path: string,
  fileData: FileData | undefined,
  context: EmitContext
): boolean {
  if (context.emittedPaths.has(path)) return false;
  if (!fileData || !fileData.isContentLoaded || fileData.content === undefined) {
    // Mark as failed if it's still pending
    if (context.pendingPaths.has(path)) {
      context.pendingPaths.delete(path);
      context.failedPaths.add(path);
      
      const timeout = context.pendingTimeouts.get(path);
      if (timeout) {
        clearTimeout(timeout);
        context.pendingTimeouts.delete(path);
      }
    }
    return false;
  }
  return true;
}

// Process a single file for emission
export function processFileForEmission(
  path: string,
  fileData: FileData,
  selRef: SelectedFileReference | undefined,
  userSelectedFolder: string | null,
  buildFileBlocks: BuildFileBlocksFunction
): FileEmitResult | null {
  try {
    return buildFileBlocks(fileData, selRef, userSelectedFolder);
  } catch {
    return null;
  }
}

// Handle retry scheduling with exponential backoff
export function scheduleFileRetry(
  path: string,
  context: EmitContext,
  onRetry: () => void,
  emitProgress: () => void,
  checkAndCompleteIfDone: () => void
): void {
  if (context.isCancelled) return;
  
  const attempts = context.retryCounts.get(path) ?? 0;
  
  if (attempts >= RETRY_MAX_ATTEMPTS) {
    // Give up; mark as failed
    context.pendingPaths.delete(path);
    context.failedPaths.add(path);
    context.skippedPaths.delete(path);
    
    const timeout = context.pendingTimeouts.get(path);
    if (timeout) {
      clearTimeout(timeout);
      context.pendingTimeouts.delete(path);
    }
    
    context.retryCounts.delete(path);
    
    if (DEBUG_ENABLED) {
      console.log('[Worker] Max retries reached for path:', path);
    }
    
    emitProgress();
    checkAndCompleteIfDone();
    return;
  }
  
  context.retryCounts.set(path, attempts + 1);
  
  // Use exponential backoff for retries
  const delay = Math.round(RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempts));
  
  self.setTimeout(() => {
    if (DEBUG_ENABLED) {
      console.log('[Worker] Retrying path (attempt', attempts + 1, '):', path);
    }
    onRetry();
  }, delay);
}

// Process a batch of files to emit
export function processBatchForEmission(
  slice: string[],
  context: EmitContext,
  currentAllMap: Map<string, FileData>,
  currentSelectedMap: Map<string, SelectedFileReference>,
  userSelectedFolder: string | null,
  buildFileBlocks: BuildFileBlocksFunction,
  enforceMemoryLimits: () => void
): {
  combinedDisplay: string;
  combinedFull: string;
  combinedFullTokenDelta: number;
  processedAfter: number;
} {
  let combinedDisplay = '';
  let combinedFull = '';
  let combinedFullTokenDelta = 0;
  
  for (const path of slice) {
    if (context.isCancelled) break;
    
    const fileData = currentAllMap.get(path);
    if (!fileData || !canEmitFile(path, fileData, context)) continue;
    
    const selRef = currentSelectedMap.get(path);
    const result = processFileForEmission(path, fileData, selRef, userSelectedFolder, buildFileBlocks);
    
    if (result) {
      context.tokenTotal += result.tokenDelta;
      combinedFullTokenDelta += result.tokenDelta;
      combinedDisplay += result.displayBlock;
      combinedFull += result.fullBlock;
      
      markFileAsEmitted(path, context);
      
      // Enforce memory limits during active processing (every 100 files)
      if (context.emittedPaths.size % 100 === 0) {
        enforceMemoryLimits();
      }
    }
  }
  
  return {
    combinedDisplay,
    combinedFull,
    combinedFullTokenDelta,
    processedAfter: context.emittedPaths.size
  };
}

// Handle file update for UPDATE_FILES handler
export function processFileUpdate(
  file: UpdateFile,
  currentAllMap: Map<string, FileData>,
  eligiblePathsSet: Set<string>,
  context: EmitContext,
  handlePendingTimeout: HandlePendingTimeoutFunction,
  isTransientError: IsTransientErrorFunction
): boolean {
  try {
    const existing = currentAllMap.get(file.path) || {
      name: file.path.split('/').pop() || file.path,
      path: file.path,
      isDirectory: false,
      size: file.content?.length ?? 0,
      isBinary: false,
      isSkipped: false
    } as FileData;

    existing.content = file.content;
    existing.isContentLoaded = true;
    if (typeof file.tokenCount === 'number') {
      existing.tokenCount = file.tokenCount;
    }
    currentAllMap.set(file.path, existing);

    // Check if file needs processing
    if (!context.emittedPaths.has(file.path) &&
        eligiblePathsSet.has(file.path) &&
        (context.pendingPaths.has(file.path) || 
         context.failedPaths.has(file.path) || 
         context.skippedPaths.has(file.path))) {
      
      // Clear existing timeout
      const timeout = context.pendingTimeouts.get(file.path);
      if (timeout) {
        clearTimeout(timeout);
        context.pendingTimeouts.delete(file.path);
      }
      
      // Move from failed/skipped to pending for retry
      if (context.failedPaths.has(file.path)) {
        context.failedPaths.delete(file.path);
        context.pendingPaths.add(file.path);
      } else if (context.skippedPaths.has(file.path)) {
        context.skippedPaths.delete(file.path);
        context.pendingPaths.add(file.path);
      }
      
      // Set new timeout
      const newTimeout = self.setTimeout(
        () => handlePendingTimeout(file.path),
        PENDING_FILE_TIMEOUT
      ) as unknown as number;
      context.pendingTimeouts.set(file.path, newTimeout);
      
      return true; // File is newly ready
    }
    
    return false;
  } catch (error) {
    if (DEBUG_ENABLED) {
      console.log('[Worker] Error processing file update:', file.path, error);
    }
    
    // Mark as failed if it's not transient
    if (!isTransientError(error) && eligiblePathsSet.has(file.path)) {
      context.pendingPaths.delete(file.path);
      context.failedPaths.add(file.path);
      
      const timeout = context.pendingTimeouts.get(file.path);
      if (timeout) {
        clearTimeout(timeout);
        context.pendingTimeouts.delete(file.path);
      }
    }
    
    return false;
  }
}