import fs from 'node:fs';
import path from 'node:path';

import type {
  FileData,
  SelectedFileReference,
  FileTreeMode,
  SystemPrompt,
  RolePrompt,
  Instruction,
} from '../types/file-types';
import { loadGitignore } from '../utils/ignore-utils';
import { getSelectedFilesContent } from '../utils/content-formatter';

import { validateAndResolvePath, statFile, readTextFile } from './file-service';

/**
 * Build a minimal allFiles set for aggregation.
 * - For fileTreeMode "selected" / "selected-with-roots": include only selected files (directories are inferred for ASCII tree)
 * - For "complete": scan entire workspace (gitignore + excluded patterns), but do not load content for non-selected files
 */
async function buildAllFiles(
  folderPath: string,
  selection: SelectedFileReference[],
  fileTreeMode: FileTreeMode,
  exclusionPatterns?: string[]
): Promise<FileData[]> {
  if (fileTreeMode !== 'complete') {
    // Only selected files (we'll later load content for them)
    return Promise.all(
      selection.map(async (s) => {
        const v = validateAndResolvePath(s.path);
        if (!v.ok) {
          // Skip invalid entries
          return null;
        }
        const st = await statFile(v.absolutePath);
        if (!st.ok) return null;
        if (st.data.isDirectory) return null;
        // Defer content load to readSelectedFilesContent
        return {
          name: st.data.name,
          path: st.data.path,
          isDirectory: false,
          isContentLoaded: false,
          tokenCount: undefined,
          children: undefined,
          content: undefined,
          size: st.data.size,
          mtimeMs: st.data.mtimeMs,
          isBinary: st.data.isBinary,
          isSkipped: false,
          error: undefined,
          fileType: st.data.fileType ?? undefined,
          excludedByDefault: undefined,
          isCountingTokens: false,
          tokenCountError: undefined,
        } as FileData;
      })
    ).then((arr) => arr.filter((x): x is FileData => !!x));
  }

  // fileTreeMode === 'complete' -> scan workspace
  const ignoreFilter = loadGitignore(folderPath, exclusionPatterns ?? []);
  const allFiles: FileData[] = [];

  // BFS-ish scan; non-blocking in batches
  const queue: string[] = [folderPath];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);

    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Collect files for batched stat operations
    const filePaths: string[] = [];
    const relMap = new Map<string, string>();

    for (const d of dirents) {
      const full = path.join(dir, d.name);
      const rel = path.relative(folderPath, full);

      if (ignoreFilter.ignores(rel)) continue;

      if (d.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!d.isFile()) continue;

      filePaths.push(full);
      relMap.set(full, rel);
    }

    // Replace sequential stats with batched operations to improve performance
    const BATCH_SIZE = 32;
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (full) => {
          try {
            const st = await statFile(full);
            return { full, st };
          } catch {
            return { full, st: null as unknown as Awaited<ReturnType<typeof statFile>> };
          }
        })
      );

      for (const { full, st } of results) {
        if (!st || !st.ok) continue;
        if (st.data.isDirectory) continue;

        const rel = relMap.get(full) || path.relative(folderPath, full);
        allFiles.push({
          name: st.data.name,
          path: st.data.path,
          isDirectory: false,
          isContentLoaded: false, // content only loaded later for selected files
          tokenCount: undefined,
          children: undefined,
          content: undefined,
          size: st.data.size,
          mtimeMs: st.data.mtimeMs,
          isBinary: st.data.isBinary,
          isSkipped: false,
          error: undefined,
          fileType: st.data.fileType ?? undefined,
          excludedByDefault: ignoreFilter.ignores(rel),
          isCountingTokens: false,
          tokenCountError: undefined,
        });
      }

      // Yield to event loop to keep UI responsive
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return allFiles;
}

/**
 * Load UTF-8 content for selected files, pruning binary/special/oversize.
 * Returns number of files included (textual, not binary).
 */
async function readSelectedFilesContent(
  allFiles: FileData[],
  selection: SelectedFileReference[],
  limits?: { maxFiles?: number; maxBytes?: number }
): Promise<number> {
  const selectedSet = new Set(selection.map((s) => s.path));
  const maxFiles = typeof limits?.maxFiles === 'number' && limits.maxFiles! > 0 ? limits!.maxFiles! : Number.POSITIVE_INFINITY;
  const maxBytes = typeof limits?.maxBytes === 'number' && limits.maxBytes! > 0 ? limits!.maxBytes! : Number.POSITIVE_INFINITY;

  let included = 0;
  let totalBytes = 0;

  for (const f of allFiles) {
    if (!selectedSet.has(f.path)) continue;
    if (f.isDirectory) continue;

    if (included >= maxFiles || totalBytes >= maxBytes) break;

    // Skip files flagged as binary by stat
    if (f.isBinary) continue;

    const r = await readTextFile(f.path);
    if (!r.ok || r.isLikelyBinary) continue;

    const bytes = Buffer.byteLength(r.content, 'utf8');
    if (included + 1 > maxFiles || totalBytes + bytes > maxBytes) {
      break;
    }

    f.content = r.content;
    f.isContentLoaded = true;
    included++;
    totalBytes += bytes;
  }

  // Remove any selected entries that failed to load content (avoid placeholders)
  const filtered = allFiles.filter((f) => {
    if (!selectedSet.has(f.path)) return true; // keep non-selected files (for ASCII tree in 'complete' mode)
    // Keep only selected files that have content
    return Boolean(f.isContentLoaded && typeof f.content === 'string');
  });

  // Mutate original array in-place to reflect filtering
  allFiles.length = 0;
  allFiles.push(...filtered);

  return included;
}

/**
 * Aggregate and format selected content into a single string.
 * - Prunes invalid selection entries via validateAndResolvePath (caller may pre-prune as well)
 * - Builds a minimal allFiles model sufficient for content-formatter
 * - Loads content only for selected files (never for unselected)
 */
export async function aggregateSelectedContent(params: {
  folderPath: string;
  selection: SelectedFileReference[];
  sortOrder: string;
  fileTreeMode: FileTreeMode;
  selectedFolder: string | null;
  systemPrompts: SystemPrompt[];
  rolePrompts: RolePrompt[];
  selectedInstructions: Instruction[];
  userInstructions: string;
  exclusionPatterns?: string[];
  maxFiles?: number;
  maxBytes?: number;
}): Promise<{ content: string; fileCount: number }> {
  const {
    folderPath,
    selection,
    sortOrder,
    fileTreeMode,
    selectedFolder,
    systemPrompts,
    rolePrompts,
    selectedInstructions,
    userInstructions,
    exclusionPatterns,
    maxFiles,
    maxBytes,
  } = params;

  // Defensive pruning: ensure selection entries are valid and within allowed paths
  const pruned: SelectedFileReference[] = [];
  for (const s of selection) {
    const v = validateAndResolvePath(s.path);
    if (!v.ok) continue;
    // Note: store sanitized absolute paths in the pruned selection
    pruned.push({ path: v.absolutePath, lines: s.lines });
  }

  // Build the file list according to tree mode
  const allFiles = await buildAllFiles(folderPath, pruned, fileTreeMode, exclusionPatterns);

  // Load content for selected files and compute count with limits
  const includedCount = await readSelectedFilesContent(allFiles, pruned, { maxFiles, maxBytes });

  // Determine root folder for ASCII tree display; default to workspace folder when not provided
  const rootFolder = selectedFolder || folderPath;

  const content = getSelectedFilesContent(
    allFiles,
    pruned,
    sortOrder || 'name',
    fileTreeMode || 'selected',
    rootFolder,
    systemPrompts || [],
    rolePrompts || [],
    selectedInstructions || [],
    userInstructions || ''
  );

  return { content, fileCount: includedCount };
}