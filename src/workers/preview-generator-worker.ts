/// <reference lib="webworker" />

/* Preview Generator Web Worker (progressive, update-aware)
   - Opens immediately by streaming a header chunk
   - Streams any files that already have content
   - Accepts UPDATE_FILES messages from main thread as files load
   - Emits CHUNKs for newly available files without reloading the modal
   - Finalizes (COMPLETE) when all selected files have been emitted or on cancel
   
   Binary/Skipped File Handling:
   - Binary files (isBinary=true) and skipped files (isSkipped=true) are excluded from content processing
   - These files ARE included in the file tree display for completeness
   - They are NOT counted in totalFiles for progress calculation
   - The content area loader never sends UPDATE_FILES for binary/skipped files
   - Completion occurs when all eligible (non-binary, non-skipped) files are processed
   - A note is added to the header indicating how many files were excluded

   Messages emitted:
     - { type: 'READY' }
     - { type: 'CHUNK', id, displayChunk, fullChunk, processed, total, tokenDelta }
     - { type: 'PROGRESS', id, processed, total, percent, tokenTotal }
     - { type: 'COMPLETE', id, finalDisplayChunk, finalFullChunk, tokenTotal }
     - { type: 'CANCELLED', id }
     - { type: 'ERROR', id, error }

   Messages accepted:
     - { type: 'INIT' }
     - { type: 'START', payload: StartPayload }
     - { type: 'CANCEL', id? }
     - { type: 'UPDATE_FILES', id, files: { path, content, tokenCount? }[] }
*/

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

type Instruction = { id: string; name: string; content: string; tokenCount?: number };
type SystemPrompt = { id: string; name: string; content: string; tokenCount?: number };
type RolePrompt = { id: string; name: string; content: string; tokenCount?: number };

type FileTreeMode = 'none' | 'selected' | 'selected-with-roots' | 'complete';

interface StartPayload {
  id: string;
  allFiles: FileData[];
  selectedFiles: SelectedFileReference[];
  sortOrder: string;
  fileTreeMode: FileTreeMode;
  selectedFolder: string | null;
  selectedSystemPrompts?: SystemPrompt[];
  selectedRolePrompts?: RolePrompt[];
  selectedInstructions?: Instruction[];
  userInstructions?: string;
  chunkSize?: number; // files per batch
  packOnly?: boolean;
}

type UpdateFile = { path: string; content: string; tokenCount?: number };

type FileStatus = 'binary' | 'skipped' | 'error';

type Incoming =
  | { type: 'INIT' }
  | { type: 'CANCEL'; id?: string }
  | { type: 'START'; payload: StartPayload }
  | { type: 'UPDATE_FILES'; id: string; files: UpdateFile[] }
  | { type: 'UPDATE_FILE_STATUS'; id: string; path: string; status: FileStatus; reason?: string };

// Type-safe worker context wrapper
const workerCtx = self as unknown as DedicatedWorkerGlobalScope;

// Debug flag - can be set to true for debugging
const DEBUG_ENABLED = false;

// State
let currentId: string | null = null;
let isCancelled = false;
let lastUserInstructions = '';

// Global context for current run
let currentAllMap: Map<string, FileData> = new Map();
let currentSelectedMap: Map<string, SelectedFileReference> = new Map();
let currentSelectedFolder: string | null = null;
let currentSortedPaths: string[] = [];
let eligiblePathsSet: Set<string> = new Set();  // Set of eligible file paths for fast lookup
let totalFiles = 0;
let totalEligibleFiles = 0;  // Files that can be processed (non-binary, non-skipped, non-error)
let excludedBinaryCount = 0;
let excludedSkippedCount = 0;
let excludedErrorCount = 0;  // Files with errors at START time
let emittedPaths: Set<string> = new Set();
let pendingPaths: Set<string> = new Set();
let skippedPaths: Set<string> = new Set();  // Files marked as skipped after START
let failedPaths: Set<string> = new Set();   // Files that failed to load
let tokenTotal = 0;
let headerEmitted = false;
let footerEmitted = false;
const pendingTimeouts: Map<string, number> = new Map();  // Timeouts for pending files
const retryCounts: Map<string, number> = new Map();

// Token estimate: ~1 token per 4 chars
const CHARS_PER_TOKEN = 4;
// Default chunk size (files per batch)
const DEFAULT_CHUNK_SIZE = 8;
let currentChunkSize = DEFAULT_CHUNK_SIZE;
// Timeout for pending files (30 seconds)
const PENDING_FILE_TIMEOUT = 30_000;
const RETRY_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 200;

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * Efficiently count lines without allocating large arrays.
 * Treats empty string as 0 lines, "a" as 1 line.
 * Trailing newline does not create an extra empty line.
 */
function countLines(text: string | undefined): number {
  if (!text) return 0;
  let lines = 1;
  // ASCII 10 = '\n'
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  // If ends with '\n', don't count an empty trailing line
  if (text.length > 0 && text.charCodeAt(text.length - 1) === 10) {
    lines--;
  }
  return Math.max(lines, text.length > 0 ? 1 : 0);
}

// ===== Path and formatting helpers =====

function normalizePath(p: string | null | undefined): string {
  if (!p) return '';
  const normalized = String(p)
    .replace(/\\/g, '/')  // Convert backslashes to forward slashes
    .replace(/\/+/g, '/'); // Collapse consecutive slashes
  // Preserve root "/" but remove other trailing slashes
  return normalized === '/' ? '/' : normalized.replace(/\/$/, '');
}

function getRelativePath(filePath: string, baseDir: string | null | undefined): string {
  if (!filePath) return '';
  if (!baseDir) return String(filePath);
  const fileN = normalizePath(filePath);
  const baseN = normalizePath(baseDir);
  if (fileN.startsWith(baseN + '/')) {
    return fileN.slice(Math.max(0, baseN.length + 1));
  }
  if (fileN === baseN) return '';
  return fileN;
}

function extname(filePath: string): string {
  const b = filePath.split('/').pop() || '';
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

function getLanguageIdentifier(extension: string, filePath: string): string {
  switch (extension) {
    case 'js': return 'javascript';
    case 'ts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'jsx': return 'jsx';
    case 'py': return 'python';
    case 'rb': return 'ruby';
    case 'php': return 'php';
    case 'java': return 'java';
    case 'cs': return 'csharp';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'swift': return 'swift';
    case 'kt':
    case 'kts': return 'kotlin';
    case 'c':
    case 'h': return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp': return 'cpp';
    case 'sh':
    case 'bash': return 'bash';
    case 'ps1': return 'powershell';
    case 'bat':
    case 'cmd': return 'batch';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'toml': return 'toml';
    case 'ini': return 'ini';
    case 'css': return 'css';
    case 'scss':
    case 'sass': return 'scss';
    case 'less': return 'less';
    case 'html': return 'html';
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'svg': return 'svg';
    case 'sql': return 'sql';
    default: {
      if (extension === 'dockerfile' || filePath.toLowerCase().endsWith('dockerfile')) return 'dockerfile';
      return extension || 'plaintext';
    }
  }
}

function processFileContent(
  fileContent: string | undefined,
  selected: SelectedFileReference | undefined
): { content: string; partial: boolean } {
  if (!selected?.lines || !Array.isArray(selected.lines) || selected.lines.length === 0) {
    return { content: fileContent || '', partial: false };
  }
  if (!fileContent) {
    return { content: '', partial: false };
  }
  const lines = fileContent.split('\n');
  const picked: string[] = [];
  for (const range of selected.lines) {
    const start = Math.max(1, Math.min(range.start, lines.length));
    const end = Math.max(start, Math.min(range.end, lines.length));
    for (let i = start - 1; i < end; i++) {
      picked.push(lines[i]);
    }
  }
  return { content: picked.join('\n'), partial: true };
}

function buildFileBlocks(
  file: FileData,
  selectedRef: SelectedFileReference | undefined,
  selectedFolder: string | null
): { displayBlock: string; fullBlock: string; tokenDelta: number } {
  const res = processFileContent(file.content, selectedRef);
  const rel = selectedFolder ? getRelativePath(file.path, selectedFolder) : file.path;
  const lang = getLanguageIdentifier(extname(file.path).replace(/^\./, '').toLowerCase(), file.path);
  let header = `\nFile: ${rel}`;
  if (res.partial) header += ' (Selected Lines)';
  const lineCount = countLines(res.content);
  const displayBlock = `${header}\n[File content: ${lineCount} lines]\n`;
  const fullBlock = `${header}\n\`\`\`${lang}\n${res.content}\n\`\`\`\n`;
  return { displayBlock, fullBlock, tokenDelta: estimateTokens(fullBlock) };
}

// ===== File tree helpers (for header) =====

type SimpleTreeNode = {
  name: string;
  isFile: boolean;
  children: Record<string, SimpleTreeNode>;
};

function sortedChildren(node: SimpleTreeNode): SimpleTreeNode[] {
  return Object.values(node.children).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function buildTree(items: { path: string; isFile?: boolean }[], root: string): SimpleTreeNode {
  const rootName = (root.split('/').pop() || root) || '';
  const r: SimpleTreeNode = { name: rootName, isFile: false, children: {} };
  for (const item of items) {
    insertPath(item, r, root);
  }
  return r;
}

function insertPath(item: { path: string; isFile?: boolean }, node: SimpleTreeNode, root: string) {
  const normalized = normalizePath(item.path);
  const rel = getRelativePath(normalized, root);
  if (rel === '') return;
  const parts = rel.split('/').filter(Boolean);
  let cur = node;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    const isFile = isLast ? (item.isFile ?? true) : false;
    if (!cur.children[part]) {
      cur.children[part] = { name: part, isFile, children: {} };
    } else if (isLast) {
      cur.children[part].isFile = isFile;
    }
    cur = cur.children[part];
  }
}

function asciiFromTree(root: SimpleTreeNode): string {
  const lines: string[] = [];
  const walk = (n: SimpleTreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    if (!isRoot) {
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${n.name}`);
    }
    const kids = sortedChildren(n);
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
    kids.forEach((child, idx) => walk(child, childPrefix, idx === kids.length - 1, false));
  };
  walk(root, '', true, true);
  return lines.join('\n');
}

function generateFileTreeItems(
  allFiles: FileData[],
  sortedSelected: FileData[],
  fileTreeMode: FileTreeMode,
  normalizedRootFolder: string
): { path: string; isFile?: boolean }[] {
  switch (fileTreeMode) {
    case 'selected': {
      return sortedSelected.map(f => ({ path: normalizePath(f.path), isFile: !f.isDirectory }));
    }
    case 'selected-with-roots': {
      const dirs = new Set<string>();
      // Normalize paths once and reuse
      const normalizedItems = sortedSelected.map(f => ({
        path: normalizePath(f.path),
        isFile: !f.isDirectory
      }));
      const selectedPaths = new Set<string>(normalizedItems.map(item => item.path));
      
      for (const item of normalizedItems) {
        let dir = item.path;
        while (dir && dir !== normalizedRootFolder) {
          const lastSlash = dir.lastIndexOf('/');
          if (lastSlash <= 0) break;
          dir = dir.slice(0, lastSlash);
          // Only add parent directories that aren't already selected
          if (dir.startsWith(normalizedRootFolder) && !selectedPaths.has(dir)) {
            dirs.add(dir);
          } else if (!dir.startsWith(normalizedRootFolder)) {
            break;
          }
        }
      }
      
      return [
        ...[...dirs].map(d => ({ path: d, isFile: false })),
        ...normalizedItems
      ];
    }
    case 'complete': {
      return allFiles.filter(f => !f.isSkipped).map(f => ({ path: normalizePath(f.path), isFile: !f.isDirectory }));
    }
    default:
      return [];
  }
}

function sortFilesByOrder(files: FileData[], sortOrder: string): FileData[] {
  const [key, dirRaw] = (sortOrder || '').split('-');
  const dir = (dirRaw === 'desc' || sortOrder.endsWith('-desc')) ? 'desc' : 'asc';
  const cmp = (a: number | string, b: number | string) => (a === b ? 0 : (a < b ? -1 : 1));
  const arr = [...files];
  switch (key) {
    case 'tokens':
      arr.sort((a, b) => cmp(a.tokenCount ?? Math.round(a.size / CHARS_PER_TOKEN), b.tokenCount ?? Math.round(b.size / CHARS_PER_TOKEN)));
      break;
    case 'size':
      arr.sort((a, b) => cmp(a.size, b.size));
      break;
    case 'extension': {
      const ext = (n: string) => (n.split('.').pop() || '');
      arr.sort((a, b) => cmp(ext(a.name), ext(b.name)) || cmp(a.name, b.name));
      break;
    }
    case 'name':
    default:
      arr.sort((a, b) => cmp(a.name, b.name));
  }
  if (dir === 'desc') arr.reverse();
  return arr;
}

// ===== Streaming logic =====

function emitProgress() {
  // Count all processed files (emitted, skipped, or failed)
  const processed = emittedPaths.size + skippedPaths.size + failedPaths.size;
  const total = totalEligibleFiles;  // Always use totalEligibleFiles
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100;
  workerCtx.postMessage({
    type: 'PROGRESS',
    id: currentId!,
    processed,
    total,
    percent,
    tokenTotal
  });
}

function emitFooterAndComplete(userInstructions?: string) {
  if (footerEmitted || isCancelled || !currentId) return;
  let footerFull = '</codebase>';
  if (userInstructions && userInstructions.trim().length > 0) {
    footerFull += `\n\n${userInstructions}`;
  }
  const footerDisplay = footerFull; // small; safe to reuse
  tokenTotal += estimateTokens(footerFull);
  workerCtx.postMessage({
    type: 'COMPLETE' as const,
    id: currentId!,
    finalDisplayChunk: footerDisplay,
    finalFullChunk: footerFull,
    tokenTotal
  });
  footerEmitted = true;
}

function emitHeaderAndPrimingChunk(opts: {
  fileTreeMode: FileTreeMode;
  selectedFolder: string | null;
  sortedSelectedFiles: FileData[];
  selectedSystemPrompts?: SystemPrompt[];
  selectedRolePrompts?: RolePrompt[];
  selectedInstructions?: Instruction[];
}) {
  if (headerEmitted || !currentId) return;
  const { fileTreeMode, selectedFolder, sortedSelectedFiles, selectedSystemPrompts, selectedRolePrompts, selectedInstructions } = opts;

  // Prefix (prompts/docs)
  const prefixParts: string[] = [];
  if (selectedSystemPrompts?.length) prefixParts.push(selectedSystemPrompts.map(p => p.content).join('\n\n'));
  if (selectedRolePrompts?.length) prefixParts.push(selectedRolePrompts.map(p => p.content).join('\n\n'));
  if (selectedInstructions?.length) prefixParts.push(selectedInstructions.map(d => d.content).join('\n\n'));

  let header = '';
  if (prefixParts.length > 0) header += prefixParts.join('\n\n') + '\n\n';
  header += '<codebase>\n';
  
  // Add note about excluded files if any
  const totalExcluded = excludedBinaryCount + excludedSkippedCount;
  if (totalExcluded > 0) {
    header += `<!-- Note: ${totalExcluded} file(s) excluded from content (${excludedBinaryCount} binary, ${excludedSkippedCount} skipped) but shown in tree -->\n`;
  }

  if (fileTreeMode !== 'none' && selectedFolder) {
    const normalizedFolder = normalizePath(selectedFolder);
    const items = generateFileTreeItems([...currentAllMap.values()], sortedSelectedFiles, fileTreeMode, normalizedFolder);
    const tree = asciiFromTree(buildTree(items, normalizedFolder));
    header += `<file_map>\n${normalizedFolder}\n${tree}\n</file_map>\n\n`;
  }

  const displayHeader = header;
  const fullHeader = header;
  tokenTotal += estimateTokens(fullHeader);
  workerCtx.postMessage({
    type: 'CHUNK',
    id: currentId!,
    displayChunk: displayHeader,
    fullChunk: fullHeader,
    processed: emittedPaths.size,
    total: totalEligibleFiles,
    tokenDelta: estimateTokens(fullHeader)
  });
  headerEmitted = true;
}

function emitFilesChunk(paths: string[], chunkSize: number, userSelectedFolder: string | null, packOnly?: boolean) {
  if (!currentId || isCancelled) return;
  for (let i = 0; i < paths.length; i += chunkSize) {
    if (isCancelled) return;
    const slice = paths.slice(i, Math.min(i + chunkSize, paths.length));

    // Combine slice into a single CHUNK to reduce postMessage overhead
    let combinedDisplay = '';
    let combinedFull = '';
    let combinedFullTokenDelta = 0;
    let processedAfter = emittedPaths.size;

    for (const p of slice) {
      if (isCancelled) return;
      
      // Skip if already emitted (handles duplicates in the paths array)
      if (emittedPaths.has(p)) continue;
      
      const fd = currentAllMap.get(p);
      if (!fd || !fd.isContentLoaded || fd.content === undefined) {
        // File can't be emitted - mark as failed if it's still pending
        if (pendingPaths.has(p)) {
          pendingPaths.delete(p);
          failedPaths.add(p);
          // Clear any timeout
          const timeout = pendingTimeouts.get(p);
          if (timeout) {
            clearTimeout(timeout);
            pendingTimeouts.delete(p);
          }
        }
        continue;
      }

      try {
        const selRef = currentSelectedMap.get(p);
        const { displayBlock, fullBlock, tokenDelta } = buildFileBlocks(fd, selRef, userSelectedFolder);

        tokenTotal += tokenDelta;
        combinedFullTokenDelta += tokenDelta;
        combinedDisplay += displayBlock;
        combinedFull += fullBlock;

        emittedPaths.add(p);
        pendingPaths.delete(p);
        failedPaths.delete(p);  // Remove from failed if it was previously marked as failed
        skippedPaths.delete(p);  // Remove from skipped if it was previously marked as skipped
        // Clear any timeout for this successfully emitted file
        const timeout = pendingTimeouts.get(p);
        if (timeout) {
          clearTimeout(timeout);
          pendingTimeouts.delete(p);
        }
        processedAfter = emittedPaths.size;
      } catch (error) {
        // Retry transient build failures a few times before marking as failed
        if (!emittedPaths.has(p)) {
          scheduleRetry(p, userSelectedFolder, !!packOnly);
        }
        if (DEBUG_ENABLED) {
          console.log('[Worker] Build blocks failed, scheduled retry:', p, error);
        }
      }
    }

    if (combinedDisplay.length > 0 || combinedFull.length > 0) {
      workerCtx.postMessage({
        type: 'CHUNK',
        id: currentId!,
        displayChunk: packOnly ? '' : combinedDisplay,
        fullChunk: combinedFull,
        processed: processedAfter,
        total: totalEligibleFiles,
        tokenDelta: combinedFullTokenDelta
      });

      emitProgress();
    }
  }
  
  // After processing all chunks, check if we're done
  // This is important if some files failed to emit
  checkAndCompleteIfDone();
}

// Retry helpers for transient build failures
function scheduleRetry(path: string, userSelectedFolder: string | null, packOnly: boolean) {
  if (isCancelled) return;
  const attempts = retryCounts.get(path) ?? 0;
  if (attempts >= RETRY_MAX_ATTEMPTS) {
    // Give up; mark as failed for completion accounting
    pendingPaths.delete(path);
    failedPaths.add(path);
    skippedPaths.delete(path);
    const timeout = pendingTimeouts.get(path);
    if (timeout) {
      clearTimeout(timeout);
      pendingTimeouts.delete(path);
    }
    emitProgress();
    checkAndCompleteIfDone();
    return;
  }
  retryCounts.set(path, attempts + 1);
  self.setTimeout(() => {
    tryEmitSingle(path, userSelectedFolder, packOnly);
  }, RETRY_DELAY_MS);
}

function tryEmitSingle(path: string, userSelectedFolder: string | null, packOnly: boolean) {
  if (isCancelled || emittedPaths.has(path)) return;
  const fd = currentAllMap.get(path);
  if (!fd || !fd.isContentLoaded || fd.content === undefined) {
    // Stay pending; await further updates or timeout
    return;
  }

  try {
    const selRef = currentSelectedMap.get(path);
    const { displayBlock, fullBlock, tokenDelta } = buildFileBlocks(fd, selRef, userSelectedFolder);

    tokenTotal += tokenDelta;

    emittedPaths.add(path);
    pendingPaths.delete(path);
    failedPaths.delete(path);
    skippedPaths.delete(path);

    const timeout = pendingTimeouts.get(path);
    if (timeout) {
      clearTimeout(timeout);
      pendingTimeouts.delete(path);
    }

    workerCtx.postMessage({
      type: 'CHUNK',
      id: currentId!,
      displayChunk: packOnly ? '' : displayBlock,
      fullChunk: fullBlock,
      processed: emittedPaths.size,
      total: totalEligibleFiles,
      tokenDelta
    });

    emitProgress();
    checkAndCompleteIfDone();
  } catch {
    scheduleRetry(path, userSelectedFolder, packOnly);
  }
}

// START handler
async function streamPreview(payload: StartPayload) {
  const {
    id,
    allFiles,
    selectedFiles,
    sortOrder,
    fileTreeMode,
    selectedFolder,
    selectedSystemPrompts,
    selectedRolePrompts,
    selectedInstructions,
    userInstructions,
    chunkSize = DEFAULT_CHUNK_SIZE,
    packOnly = false
  } = payload;

  currentChunkSize = chunkSize;

  // Initialize context
  currentId = id;
  isCancelled = false;
  lastUserInstructions = userInstructions || '';  // Store for finalization
  currentAllMap = new Map(allFiles.map(f => [f.path, f]));
  currentSelectedMap = new Map(selectedFiles.map(sf => [sf.path, sf]));
  currentSelectedFolder = selectedFolder || null;
  emittedPaths = new Set();
  pendingPaths = new Set();
  skippedPaths = new Set();
  failedPaths = new Set();
  eligiblePathsSet = new Set();
  tokenTotal = 0;
  headerEmitted = false;
  footerEmitted = false;
  
  // Clear any pending timeouts from previous runs
  for (const timeout of pendingTimeouts.values()) {
    clearTimeout(timeout);
  }
  pendingTimeouts.clear();
  retryCounts.clear();

  // Build sorted selection - all selected files including binary/skipped
  const allSelectedList = allFiles.filter(f => !f.isDirectory && currentSelectedMap.has(f.path));
  
  // Separate binary/skipped/error files for diagnostic logging and counting
  const binaryFiles = allSelectedList.filter(f => f.isBinary);
  const skippedFiles = allSelectedList.filter(f => f.isSkipped);
  const errorFiles = allSelectedList.filter(f => !!f.error);
  
  // Eligible files: non-binary, non-skipped, and non-error
  const eligibleFiles = allSelectedList.filter(f => !f.isBinary && !f.isSkipped && !f.error);
  
  // Store counts for progress reporting
  excludedBinaryCount = binaryFiles.length;
  excludedSkippedCount = skippedFiles.length;
  excludedErrorCount = errorFiles.length;
  
  // Diagnostic logging (only in debug mode)
  if (DEBUG_ENABLED) {
    console.log('[Worker START] Diagnostic info:', {
      totalSelected: allSelectedList.length,
      binaryCount: excludedBinaryCount,
      skippedCount: excludedSkippedCount,
      errorCount: excludedErrorCount,
      eligibleCount: eligibleFiles.length,
      sampleBinary: binaryFiles.slice(0, 5).map(f => f.path),
      sampleSkipped: skippedFiles.slice(0, 5).map(f => f.path),
      sampleError: errorFiles.slice(0, 5).map(f => ({ path: f.path, error: f.error })),
      sampleEligible: eligibleFiles.slice(0, 5).map(f => f.path)
    });
  }
  
  // Sort ALL selected files for tree generation (including binary/skipped)
  const allSortedSelected = sortFilesByOrder(allSelectedList, sortOrder);
  
  // Only process eligible files (non-binary, non-skipped, non-error) for content
  const eligibleSorted = sortFilesByOrder(eligibleFiles, sortOrder);
  currentSortedPaths = eligibleSorted.map(f => f.path);
  eligiblePathsSet = new Set(currentSortedPaths);  // Store for eligibility checks
  totalFiles = currentSortedPaths.length;  // Keep for backward compatibility
  totalEligibleFiles = currentSortedPaths.length;  // New accurate count

  // Emit header with ALL selected files for complete tree, but only eligible for content
  emitHeaderAndPrimingChunk({
    fileTreeMode,
    selectedFolder: currentSelectedFolder,
    sortedSelectedFiles: allSortedSelected, // Include ALL files for tree
    selectedSystemPrompts,
    selectedRolePrompts,
    selectedInstructions
  });

  // Emit any files that already have content
  const readyNow = currentSortedPaths.filter(p => {
    const fd = currentAllMap.get(p);
    return !!fd && !!fd.isContentLoaded && fd.content !== undefined;
  });
  const readyNowSet = new Set(readyNow);
  const notReady = currentSortedPaths.filter(p => !readyNowSet.has(p));
  for (const p of notReady) {
    pendingPaths.add(p);
    // Set a timeout for this pending file
    const timeout = self.setTimeout(() => handlePendingTimeout(p), PENDING_FILE_TIMEOUT);
    pendingTimeouts.set(p, timeout);
  }

  if (readyNow.length > 0) {
    emitFilesChunk(readyNow, chunkSize, currentSelectedFolder, packOnly);
  } else {
    // still update progress for header-only stage
    emitProgress();
  }

  // Check completion condition
  checkAndCompleteIfDone();
}

// UPDATE handler
function handleUpdateFiles(id: string, files: UpdateFile[], chunkSize: number) {
  if (!currentId || currentId !== id || isCancelled) return;

  const newlyReady: string[] = [];
  for (const f of files) {
    const existing = currentAllMap.get(f.path) || {
      name: f.path.split('/').pop() || f.path,
      path: f.path,
      isDirectory: false,
      size: f.content?.length ?? 0,
      isBinary: false,
      isSkipped: false
    } as FileData;

    existing.content = f.content;
    existing.isContentLoaded = true;
    if (typeof f.tokenCount === 'number') existing.tokenCount = f.tokenCount;
    currentAllMap.set(f.path, existing);

    // Allow retrying failed/skipped files and processing pending files
    if (!emittedPaths.has(f.path)) {
      // Only process if this file was originally eligible
      if (eligiblePathsSet.has(f.path)) {
        if (pendingPaths.has(f.path) || failedPaths.has(f.path) || skippedPaths.has(f.path)) {
          newlyReady.push(f.path);
          // Clear timeout for pending files
          const timeout = pendingTimeouts.get(f.path);
          if (timeout) {
            clearTimeout(timeout);
            pendingTimeouts.delete(f.path);
          }
          // If it was failed or skipped, move back to pending for retry
          if (failedPaths.has(f.path)) {
            failedPaths.delete(f.path);
            pendingPaths.add(f.path);
            // Set a new timeout for the retry
            const newTimeout = self.setTimeout(() => handlePendingTimeout(f.path), PENDING_FILE_TIMEOUT);
            pendingTimeouts.set(f.path, newTimeout);
          } else if (skippedPaths.has(f.path)) {
            skippedPaths.delete(f.path);
            pendingPaths.add(f.path);
            // Set a new timeout for the retry
            const newTimeout = self.setTimeout(() => handlePendingTimeout(f.path), PENDING_FILE_TIMEOUT);
            pendingTimeouts.set(f.path, newTimeout);
          }
        }
      }
    }
  }

  // Diagnostic logging
  if (DEBUG_ENABLED) {
    console.log('[Worker UPDATE_FILES]', {
      filesReceived: files.length,
      newlyReady: newlyReady.length,
      pendingPathsSize: pendingPaths.size,
      emittedPathsSize: emittedPaths.size,
      totalFiles: totalFiles
    });
  }

  if (newlyReady.length > 0) {
    emitFilesChunk(newlyReady, chunkSize, currentSelectedFolder, false);  // UPDATE_FILES are never pack-only
  }

  // Check completion condition
  checkAndCompleteIfDone();
}

// UPDATE_FILE_STATUS handler
function handleUpdateFileStatus(id: string, path: string, status: FileStatus, reason?: string) {
  if (!currentId || currentId !== id || isCancelled) return;
  
  // If the file is already emitted, ignore status updates
  if (emittedPaths.has(path)) {
    return;
  }
  
  // Only process status updates for files that were eligible at START
  if (!eligiblePathsSet.has(path)) {
    return;
  }
  
  // Remove from pending if it's there
  if (pendingPaths.has(path)) {
    pendingPaths.delete(path);
    
    // Clear any timeout for this file
    const timeout = pendingTimeouts.get(path);
    if (timeout) {
      clearTimeout(timeout);
      pendingTimeouts.delete(path);
    }
  }
  
  // Track the file based on its status (even if not pending)
  if (status === 'error') {
    failedPaths.add(path);
    skippedPaths.delete(path);  // Move from skipped to failed if needed
  } else if (status === 'binary' || status === 'skipped') {
    skippedPaths.add(path);
    failedPaths.delete(path);  // Move from failed to skipped if needed
  }
  
  // Diagnostic logging
  if (DEBUG_ENABLED) {
    console.log('[Worker UPDATE_FILE_STATUS]', {
      path,
      status,
      reason,
      pendingPathsSize: pendingPaths.size,
      failedPathsSize: failedPaths.size,
      skippedPathsSize: skippedPaths.size
    });
  }
  
  // Update progress and check for completion
  emitProgress();
  checkAndCompleteIfDone();
}

// Handle timeout for pending files
function handlePendingTimeout(path: string) {
  if (pendingPaths.has(path)) {
    if (DEBUG_ENABLED) {
      console.log('[Worker TIMEOUT]', {
        path,
        message: 'File timed out waiting for content'
      });
    }
    
    // Move from pending to failed
    pendingPaths.delete(path);
    // Only add to failed if not already emitted
    if (!emittedPaths.has(path)) {
      failedPaths.add(path);
      skippedPaths.delete(path);  // Move from skipped if needed
    }
    pendingTimeouts.delete(path);
    
    // Update progress and check for completion
    emitProgress();
    checkAndCompleteIfDone();
  }
}

// Check if all files have been processed and complete if done
function checkAndCompleteIfDone() {
  if (isCancelled || footerEmitted) return;  // Don't complete if cancelled or already completed
  
  const totalProcessed = emittedPaths.size + skippedPaths.size + failedPaths.size;
  
  // Diagnostic logging for completion check
  if (DEBUG_ENABLED) {
    console.log('[Worker COMPLETE check]', {
      emittedPaths: emittedPaths.size,
      skippedPaths: skippedPaths.size,
      failedPaths: failedPaths.size,
      totalProcessed,
      totalEligibleFiles,
      pendingPaths: pendingPaths.size,
      willComplete: totalProcessed === totalEligibleFiles
    });
  }
  
  if (totalProcessed === totalEligibleFiles) {
    // Clear any remaining timeouts
    for (const timeout of pendingTimeouts.values()) {
      clearTimeout(timeout);
    }
    pendingTimeouts.clear();
    
    emitFooterAndComplete(lastUserInstructions);
  }
}

// READY
workerCtx.postMessage({ type: 'READY' as const });

// Message loop
workerCtx.addEventListener('message', async (e: MessageEvent<Incoming>) => {
  const msg = e.data;
  try {
    if (msg.type === 'INIT') {
      workerCtx.postMessage({ type: 'READY' as const });
      return;
    }
    if (msg.type === 'CANCEL') {
      if (currentId && (!msg.id || msg.id === currentId)) {
        isCancelled = true;
        // Clear all pending timeouts on cancel
        for (const timeout of pendingTimeouts.values()) {
          clearTimeout(timeout);
        }
        pendingTimeouts.clear();
        workerCtx.postMessage({ type: 'CANCELLED' as const, id: currentId! });
      }
      return;
    }
    if (msg.type === 'START') {
      const p = msg.payload;
      if (!p || !p.id || !Array.isArray(p.allFiles) || !Array.isArray(p.selectedFiles)) {
        workerCtx.postMessage({ type: 'ERROR' as const, id: p?.id || 'unknown', error: 'Invalid START payload' });
        return;
      }
      // streamPreview will store userInstructions
      await streamPreview(p);
      return;
    }
    if (msg.type === 'UPDATE_FILES') {
      handleUpdateFiles(msg.id, msg.files, currentChunkSize);
      return;
    }
    if (msg.type === 'UPDATE_FILE_STATUS') {
      handleUpdateFileStatus(msg.id, msg.path, msg.status, msg.reason);
      return;
    }
  } catch (error) {
    workerCtx.postMessage({
      type: 'ERROR' as const,
      id: (msg as Incoming & { payload?: { id?: string } })?.payload?.id || currentId || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});