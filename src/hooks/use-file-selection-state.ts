import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';

import { STORAGE_KEYS, FILE_PROCESSING } from '@constants';

import { FileData, LineRange, SelectedFileReference } from '../types/file-types';
import { buildFolderIndex, getFilesInFolder, type FolderIndex } from '../utils/folder-selection-index';
import { createDirectorySelectionCache } from '../utils/selection-cache';
import { BoundedLRUCache } from '../utils/bounded-lru-cache';
import { getGlobalPerformanceMonitor } from '../utils/performance-monitor';

import { useDebouncedPersistentState } from './use-debounced-persistent-state';

/**
 * Pure state transition helper to apply selection changes.
 * Designed for unit testing and to reduce branching inside the hook.
 */
export type SelectionAction =
  | { type: "toggle-file"; filePath: string }
  | { type: "toggle-line-range"; filePath: string; range?: LineRange }
  | { type: "toggle-folder"; folderPath: string; isSelected: boolean }
  | { type: "select-all"; displayedFiles: FileData[] }
  | { type: "deselect-all"; displayedFiles: FileData[] }
  | { type: "clear" }
  | { type: "set"; files: SelectedFileReference[] };

export interface SelectionContext {
  allFilesMap?: Map<string, FileData>;
  folderIndex?: FolderIndex;
}

function canSelectPath(p: string, ctx: SelectionContext): boolean {
  if (!ctx.allFilesMap) return true;
  const file = ctx.allFilesMap.get(p);
  return !!file && !file.isBinary && !file.isSkipped;
}

function applyClear(): SelectedFileReference[] { return []; }

function applySet(files: SelectedFileReference[]): SelectedFileReference[] {
  const unique = new Map<string, SelectedFileReference>();
  for (const f of files) {
    if (!f?.path) continue;
    unique.set(f.path, { path: f.path, lines: f.lines });
  }
  return [...unique.values()];
}

function applyToggleFile(state: SelectedFileReference[], filePath: string, ctx: SelectionContext): SelectedFileReference[] {
  if (!canSelectPath(filePath, ctx)) return state;
  const byPath = new Map(state.map((s) => [s.path, s] as const));
  if (byPath.has(filePath)) {
    byPath.delete(filePath);
  } else {
    byPath.set(filePath, { path: filePath });
  }
  return [...byPath.values()];
}

function applyToggleLineRange(state: SelectedFileReference[], filePath: string, range: LineRange | undefined, ctx: SelectionContext): SelectedFileReference[] {
  if (!range) return applyToggleFile(state, filePath, ctx);
  if (!canSelectPath(filePath, ctx)) return state;
  const byPath = new Map(state.map((s) => [s.path, s] as const));
  const existing = byPath.get(filePath);
  if (!existing) {
    byPath.set(filePath, { path: filePath, lines: [range] });
    return [...byPath.values()];
  }
  const existingLines = existing.lines || [];
  const idx = existingLines.findIndex((x) => x.start === range.start && x.end === range.end);
  if (idx >= 0) {
    const nextLines = existingLines.filter((_, i) => i !== idx);
    if (nextLines.length === 0) {
      byPath.delete(filePath);
    } else {
      byPath.set(filePath, { path: filePath, lines: nextLines });
    }
  } else {
    byPath.set(filePath, { path: filePath, lines: [...existingLines, range] });
  }
  return [...byPath.values()];
}

function applySelectAll(state: SelectedFileReference[], displayedFiles: FileData[], ctx: SelectionContext): SelectedFileReference[] {
  const byPath = new Map(state.map((s) => [s.path, s] as const));
  for (const f of displayedFiles) {
    if (f.isBinary || f.isSkipped) continue;
    if (!byPath.has(f.path) && canSelectPath(f.path, ctx)) byPath.set(f.path, { path: f.path });
  }
  return [...byPath.values()];
}

function applyDeselectAll(state: SelectedFileReference[], displayedFiles: FileData[]): SelectedFileReference[] {
  const toRemove = new Set(displayedFiles.map((f) => f.path));
  return state.filter((s) => !toRemove.has(s.path));
}

function applyToggleFolder(state: SelectedFileReference[], folderPath: string, isSelected: boolean, ctx: SelectionContext): SelectedFileReference[] {
  const index = ctx.folderIndex;
  if (!index) return state;
  const inFolder = getFilesInFolder(index, folderPath).filter((p) => canSelectPath(p, ctx));
  if (inFolder.length === 0) return state;

  const byPath = new Map(state.map((s) => [s.path, s] as const));
  const selectedInFolder = inFolder.filter((p) => byPath.has(p));
  const allSelected = selectedInFolder.length === inFolder.length;
  const noneSelected = selectedInFolder.length === 0;
  if ((isSelected && allSelected) || (!isSelected && noneSelected)) return state;

  if (isSelected) {
    for (const p of inFolder) if (!byPath.has(p)) byPath.set(p, { path: p });
  } else {
    for (const p of inFolder) byPath.delete(p);
  }
  return [...byPath.values()];
}

export function applySelectionChange(
  state: SelectedFileReference[],
  action: SelectionAction,
  ctx: SelectionContext = {}
): SelectedFileReference[] {
  switch (action.type) {
    case "clear": { return applyClear(); }
    case "set": { return applySet(action.files); }
    case "toggle-file": { return applyToggleFile(state, action.filePath, ctx); }
    case "toggle-line-range": { return applyToggleLineRange(state, action.filePath, action.range, ctx); }
    case "select-all": { return applySelectAll(state, action.displayedFiles, ctx); }
    case "deselect-all": { return applyDeselectAll(state, action.displayedFiles); }
    case "toggle-folder": { return applyToggleFolder(state, action.folderPath, action.isSelected, ctx); }
    default: { return state; }
  }
}

// Helper: list selectable file paths under a folder
function getSelectableFolderFiles(
  allFilesMap: Map<string, FileData>,
  index: FolderIndex,
  folderPath: string
): string[] {
  const filesInFolderPaths = getFilesInFolder(index, folderPath);
  if (filesInFolderPaths.length === 0) return [];
  return filesInFolderPaths.filter((filePath) => {
    const file = allFilesMap.get(filePath);
    return !!file && !file.isBinary && !file.isSkipped;
  });
}

type FolderTogglePlan =
  | { kind: 'noop' }
  | { kind: 'add'; additions: string[] }
  | { kind: 'remove'; toRemove: Set<string> };

function computeFolderTogglePlan(
  selectableFiles: string[],
  selectedFiles: SelectedFileReference[],
  isSelected: boolean
): FolderTogglePlan {
  if (selectableFiles.length === 0) return { kind: 'noop' };
  const setSelectable = new Set(selectableFiles);
  const selectedInFolder = selectedFiles.filter((f) => setSelectable.has(f.path));
  const allFilesSelected = selectedInFolder.length === selectableFiles.length;
  const noFilesSelected = selectedInFolder.length === 0;
  if ((isSelected && allFilesSelected) || (!isSelected && noFilesSelected)) return { kind: 'noop' };
  if (isSelected) {
    const existing = new Set(selectedFiles.map((f) => f.path));
    const additions = selectableFiles.filter((p) => !existing.has(p));
    return { kind: 'add', additions };
  }
  return { kind: 'remove', toRemove: new Set(selectableFiles) };
}

/**
 * Custom hook to manage file selection state
 * 
 * @param {FileData[]} allFiles - Array of all files
 * @returns {Object} File selection state and functions
 */
const useFileSelectionState = (allFiles: FileData[], currentWorkspacePath?: string | null, providedFolderIndex?: FolderIndex) => {
  const [selectedFiles, setSelectedFiles] = useDebouncedPersistentState<SelectedFileReference[]>(
    STORAGE_KEYS.SELECTED_FILES,
    [],
    FILE_PROCESSING.DEBOUNCE_DELAY_MS
  );

  const selectedFilesRef = useRef<SelectedFileReference[]>(selectedFiles);
  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);
  
  // Build folder index if not provided
  const folderIndex = useMemo(() => {
    if (providedFolderIndex) {
      return providedFolderIndex;
    }
    return buildFolderIndex(allFiles);
  }, [allFiles, providedFolderIndex]);

  // Precompute map for O(1) file lookups by path
  const allFilesMap = useMemo(() => new Map(allFiles.map(f => [f.path, f])), [allFiles]);
  
  // Track optimistic folder updates with bounded cache to prevent unbounded memory growth
  const optimisticFolderStatesRef = useRef(new BoundedLRUCache<string, 'full' | 'none'>(100));
  const [optimisticStateVersion, setOptimisticStateVersion] = useState(0);
  const optimisticTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pendingOperationsRef = useRef<Set<string>>(new Set());
  // Track folder toggles that computed a noop due to incomplete folder index
  const pendingFolderTogglesRef = useRef<Map<string, { action: 'add' | 'remove'; ts: number }>>(new Map());

  // Performance monitor singleton
  const perf = useMemo(() => getGlobalPerformanceMonitor(), []);
  // Overlay version to trigger re-renders when progressive batches apply
  const [folderOverlayVersion, setFolderOverlayVersion] = useState(0);
  // Manual cache update version to trigger re-renders when cache is manually updated
  const [manualCacheVersion, setManualCacheVersion] = useState(0);
  // Coalescing guard for rapid bulk toggles
  const lastBulkToggleTsRef = useRef(0);
  // Chunking configuration
  const BULK = useMemo(() => ({ ADD_CHUNK: 1500, REMOVE_CHUNK: 2000, COALESCE_MS: 150 }), []);

  // Store the cache in a ref to avoid recreating it unnecessarily
  const baseFolderSelectionCacheRef = useRef<ReturnType<typeof createDirectorySelectionCache> | null>(null);
  
  // Build folder selection cache for instant UI updates (recreate only when allFiles changes)
  const baseFolderSelectionCache = useMemo(() => {
    // Use a stable callback ref to avoid recreating the cache
    const onBatchApplied = () => {
      // Direct state update for faster feedback
      setFolderOverlayVersion(v => v + 1);
    };
    
    const cache = createDirectorySelectionCache(allFiles, selectedFiles, {
      onBatchApplied,
    });
    
    baseFolderSelectionCacheRef.current = cache;
    return cache;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFiles]);
  
  // Create a wrapper cache that includes optimistic updates and progressive signals
  const folderSelectionCache = useMemo(() => {
    const cache = baseFolderSelectionCacheRef.current || baseFolderSelectionCache;
    return {
      get(path: string): 'full' | 'partial' | 'none' {
        // Normalize variant for robust optimistic lookups (absolute/relative mirror)
        // Special-case root: do not check empty-string key
        const altPath = path === '/'
          ? null
          : (path.startsWith('/') ? path.slice(1) : ('/' + path));

        // Check optimistic updates first (both variants)
        const optDirect = optimisticFolderStatesRef.current.get(path);
        if (optDirect !== undefined) return optDirect;
        if (altPath) {
          const optAlt = optimisticFolderStatesRef.current.get(altPath);
          if (optAlt !== undefined) return optAlt;
        }

        // Fallback: if any ancestor directory is optimistically marked, inherit that state.
        // This ensures newly-appearing descendants reflect parent toggles immediately
        // even if they weren't present in the folder index/cache at click time.
        if (path && path !== '/') {
          const isAbs = path.startsWith('/');
          const parts = path.split('/').filter(Boolean);
          for (let i = parts.length - 1; i >= 1; i--) {
            const ancestor = (isAbs ? '/' : '') + parts.slice(0, i).join('/');
            const altAncestor = ancestor.startsWith('/') ? ancestor.slice(1) : ('/' + ancestor);
            const state = optimisticFolderStatesRef.current.get(ancestor);
            if (state !== undefined) return state;
            const altState = optimisticFolderStatesRef.current.get(altAncestor);
            if (altState !== undefined) return altState;
          }
        }

        // Fall back to base cache (which already mirrors variants internally)
        const baseState = cache.get(path);
        // If base resolved to a concrete state (full or partial), use it
        if (baseState !== 'none') return baseState;

        // As a final fallback, inherit from any ancestor already computed in base cache.
        // This fills in transient gaps where parent is resolved but child hasn't been recomputed yet.
        if (path && path !== '/') {
          const isAbs2 = path.startsWith('/');
          const parts2 = path.split('/').filter(Boolean);
          for (let i = parts2.length - 1; i >= 1; i--) {
            const anc2 = (isAbs2 ? '/' : '') + parts2.slice(0, i).join('/');
            const ancState = cache.get(anc2);
            if (ancState === 'full') return 'full';
          }
        }

        return baseState;
      },
      set: cache.set.bind(cache),
      bulkUpdate: cache.bulkUpdate.bind(cache),
      clear: cache.clear.bind(cache),
      // Progressive API passthroughs (optional)
      isComputing: cache.isComputing?.bind(cache),
      getProgress: cache.getProgress?.bind(cache),
      startProgressiveRecompute: cache.startProgressiveRecompute?.bind(cache),
      cancel: cache.cancel?.bind(cache),
      setSelectedPaths: cache.setSelectedPaths?.bind(cache),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFolderSelectionCache, optimisticStateVersion, folderOverlayVersion, manualCacheVersion]);

  // Keep progressive overlay recomputation in sync with selection changes
  useEffect(() => {
    // Update cache immediately
    const cache = baseFolderSelectionCacheRef.current;
    if (!cache) return;
    
    const paths = new Set<string>(selectedFiles.map(f => f.path));
    if (cache.setSelectedPaths) {
      cache.setSelectedPaths(paths);
    }
    
    // Debounce only the expensive recompute operation with minimal delay
    const timeoutId = setTimeout(() => {
      // Re-fetch cache reference to avoid stale closure
      const currentCache = baseFolderSelectionCacheRef.current;
      if (currentCache && currentCache.startProgressiveRecompute) {
        const currentPaths = new Set<string>(selectedFiles.map(f => f.path));
        currentCache.startProgressiveRecompute({ selectedPaths: currentPaths });
      }
    }, FILE_PROCESSING.PROGRESSIVE_RECOMPUTE_DEBOUNCE_MS); // Minimal delay for responsive UI
    
    return () => clearTimeout(timeoutId);
  }, [selectedFiles]);

  // Immediate cleanup on mount if workspace is provided
  useEffect(() => {
    if (currentWorkspacePath && selectedFiles.length > 0) {
      const validFiles = selectedFiles.filter(file => file.path.startsWith(currentWorkspacePath));
      if (validFiles.length < selectedFiles.length) {
        setSelectedFiles(validFiles);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount
  
  // Cleanup optimistic timeouts on unmount
  useEffect(() => {
    const timeoutsMap = optimisticTimeoutsRef.current;
    return () => {
      // Clear all pending timeouts
      for (const timeout of timeoutsMap.values()) {
        clearTimeout(timeout);
      }
      timeoutsMap.clear();
    };
  }, []);

  // Validate selected files exist when allFiles changes
  useEffect(() => {
    // Skip validation if no files are loaded yet
    if (allFiles.length === 0 || selectedFiles.length === 0) return;
    
    // Create a Set of all current file paths for O(1) lookup
    const existingFilePaths = new Set(allFiles.map(f => f.path));
    
    // Check if any selected files no longer exist
    const hasStaleSelections = selectedFiles.some(selected => !existingFilePaths.has(selected.path));
    
    if (hasStaleSelections) {
      // Use a small delay to batch potential multiple updates
      const timeoutId = setTimeout(() => {
        setSelectedFiles(prev => {
          return prev.filter(selected => existingFilePaths.has(selected.path));
        });
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [allFiles, selectedFiles, setSelectedFiles]);

  // Clean up files outside current workspace
  const cleanupStaleSelections = useCallback(() => {
    if (currentWorkspacePath) {
      setSelectedFiles(prev => {
        return prev.filter(file => file.path.startsWith(currentWorkspacePath));
      });
    }
  }, [currentWorkspacePath, setSelectedFiles]);

  // Validate selected files still exist in the file system
  const validateSelectedFilesExist = useCallback(() => {
    if (allFiles.length === 0) return;
    
    // Create a Set of all current file paths for O(1) lookup (leveraging precomputed map)
    const existingFilePaths = new Set<string>(allFilesMap.keys());
    
    setSelectedFiles(prev => {
      // Filter out any selected files that no longer exist in allFiles
      const validSelections = prev.filter(selected => existingFilePaths.has(selected.path));
      
      // Only update if there were changes to prevent unnecessary re-renders
      if (validSelections.length !== prev.length) {
        return validSelections;
      }
      return prev;
    });
  }, [allFiles.length, allFilesMap, setSelectedFiles]);

  // Function to update a selected file with line selections
  const updateSelectedFile = useCallback((path: string, lines?: LineRange[]): void => {
    setSelectedFiles(prev => {
      const existingIndex = prev.findIndex(f => f.path === path);
      
      if (existingIndex >= 0) {
        // Update existing file
        const newSelection = [...prev];
        newSelection[existingIndex] = { path, lines };
        return newSelection;
      }
      
      // Prevent adding duplicates
      if (prev.some(f => f.path === path)) {
        return prev;
      }
      
      // Add new file
      return [...prev, { path, lines }];
    });
    
    // If lines are selected, we need to ensure content is loaded
    // This is handled by the tree item component which watches for line selections
  }, [setSelectedFiles]);

  // Function to find a selected file by path
  const findSelectedFile = useCallback((filePath: string): SelectedFileReference | undefined => {
    return selectedFiles.find(f => f.path === filePath);
  }, [selectedFiles]);

  // Toggle file selection
  const toggleFileSelection = useCallback((filePath: string): void => {
    setSelectedFiles((prev) =>
      applySelectionChange(prev, { type: "toggle-file", filePath }, { allFilesMap })
    );
  }, [allFilesMap, setSelectedFiles]);

  // Toggle selection for a specific line range within a file
  const toggleSelection = useCallback((filePath: string, lineRange?: LineRange) => {
    setSelectedFiles((prev) =>
      applySelectionChange(prev, { type: "toggle-line-range", filePath, range: lineRange }, { allFilesMap })
    );
  }, [setSelectedFiles, allFilesMap]);

  // Helper to optimistically update folder state and base cache
  const applyOptimisticFolderState = useCallback((folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }) => {
    if (opts?.optimistic === false) return;
    const newState: 'full' | 'none' = isSelected ? 'full' : 'none';
    const altPath = folderPath === '/' ? null : (folderPath.startsWith('/') ? folderPath.slice(1) : ('/' + folderPath));
    const existingTimeout = optimisticTimeoutsRef.current.get(folderPath);
    if (existingTimeout) clearTimeout(existingTimeout);
    pendingOperationsRef.current.add(folderPath);
    optimisticFolderStatesRef.current.set(folderPath, newState);
    if (altPath) optimisticFolderStatesRef.current.set(altPath, newState);
    const cache = baseFolderSelectionCacheRef.current;
    if (cache) {
      // 1) Update the clicked folder
      cache.set?.(folderPath, newState);
      // 2) Cascade to descendant directories for immediate visual consistency
      try {
        // Collect descendant directories from folderIndex keys (directories with selectable files)
        const updates = new Map<string, 'full' | 'none'>();
        for (const dir of folderIndex ? (folderIndex as Map<string, string[]>).keys() : []) {
          if (dir === folderPath) continue;
          // Normalize prefix match (ensure proper boundary: '/a' should not match '/ab')
          const isDescendant = folderPath === '/' ? dir.startsWith('/') : (dir.startsWith(folderPath + '/'));
          if (isDescendant) {
            updates.set(dir, newState);
          }
        }
        if (updates.size > 0) {
          cache.bulkUpdate?.(updates);
          // Mirror cascaded states into optimistic map as well to guarantee immediate UI reflection
          // even if overlay recompute or cleanup timing causes gaps.
          let applied = 0;
          for (const dir of updates.keys()) {
            optimisticFolderStatesRef.current.set(dir, newState);
            const alt = dir.startsWith('/') ? dir.slice(1) : ('/' + dir);
            optimisticFolderStatesRef.current.set(alt, newState);
            applied++;
            if (applied > 400) break; // stay bounded
          }
        }
      } catch { void 0; }
      const paths = new Set<string>(selectedFilesRef.current.map(f => f.path));
      cache.setSelectedPaths?.(paths);
      setManualCacheVersion(v => v + 1);
    }
    setOptimisticStateVersion(v => v + 1);
    const timeout = setTimeout(() => {
      if (!pendingOperationsRef.current.has(folderPath)) {
        optimisticFolderStatesRef.current.delete(folderPath);
        if (altPath) optimisticFolderStatesRef.current.delete(altPath);
        setOptimisticStateVersion(v => v + 1);
        optimisticTimeoutsRef.current.delete(folderPath);
      }
    }, FILE_PROCESSING.OPTIMISTIC_UPDATE_CLEANUP_MS);
    optimisticTimeoutsRef.current.set(folderPath, timeout);
  }, [selectedFiles]);

  // Run chunked additions for a folder
  const runAdditionsChunked = useCallback((folderPath: string, additions: string[], onDone?: () => void) => {
    const endMeasureChunksTotal = perf.startMeasure('selection.apply.add.chunked.total.ms');
    const total = additions.length;
    if (total === 0) {
      pendingOperationsRef.current.delete(folderPath);
      endMeasureChunksTotal();
      onDone?.();
      return;
    }
    let index = 0;
    let chunks = 0;
    const runChunk = () => {
      const start = index;
      const end = Math.min(index + BULK.ADD_CHUNK, total);
      const slice = additions.slice(start, end);
      startTransition(() => {
        setSelectedFiles((prev: SelectedFileReference[]) => {
          const set = new Set<string>(prev.map(f => f.path));
          if (slice.every(p => set.has(p))) return prev;
          const next = [...prev];
          for (const p of slice) if (!set.has(p)) { set.add(p); next.push({ path: p }); }
          return next;
        });
      });
      index = end;
      chunks++;
      // Keep overlay progressing while applying chunks
      const cache = baseFolderSelectionCacheRef.current;
      if (cache) {
        const paths = new Set<string>([...selectedFilesRef.current.map(f => f.path), ...slice]);
        cache.setSelectedPaths?.(paths);
        cache.startProgressiveRecompute?.({ selectedPaths: paths });
      }
      if (index < total) {
        Promise.resolve().then(runChunk);
      } else {
        endMeasureChunksTotal();
        perf.recordMetric('selection.apply.chunks', chunks);
        pendingOperationsRef.current.delete(folderPath);
        onDone?.();
      }
    };
    runChunk();
  }, [BULK, perf, selectedFiles, setSelectedFiles]);

  // Run chunked removals for a folder
  const runRemovalsChunked = useCallback((folderPath: string, toRemove: Set<string>, onDone?: () => void) => {
    const snapshot = [...selectedFilesRef.current];
    const total = snapshot.length;
    let index = 0;
    const CHUNK = BULK.REMOVE_CHUNK;
    const kept: SelectedFileReference[] = [];
    // Maintain an accurate live set of selected paths during removals to avoid transient "none" states for siblings
    const liveSelectedSet = new Set<string>(snapshot.map(f => f.path));
    const endMeasureChunksTotal = perf.startMeasure('selection.apply.remove.chunked.total.ms');
    const buildNext = () => {
      const start = index;
      const end = Math.min(index + CHUNK, total);
      const removedThisChunk: string[] = [];
      for (let i = start; i < end; i++) {
        const f = snapshot[i];
        if (toRemove.has(f.path)) {
          removedThisChunk.push(f.path);
        } else {
          kept.push(f);
        }
      }
      index = end;
      // Update live selected set by subtracting just-removed items, then drive overlay progressively
      const cache = baseFolderSelectionCacheRef.current;
      if (cache) {
        for (const p of removedThisChunk) liveSelectedSet.delete(p);
        const paths = new Set<string>(liveSelectedSet);
        cache.setSelectedPaths?.(paths);
        cache.startProgressiveRecompute?.({ selectedPaths: paths });
      }
      if (index < total) {
        setTimeout(buildNext, 0);
      } else {
        startTransition(() => setSelectedFiles(kept));
        endMeasureChunksTotal();
        pendingOperationsRef.current.delete(folderPath);
        onDone?.();
      }
    };
    buildNext();
  }, [BULK, perf, selectedFiles, setSelectedFiles]);

  // Try to reconcile any pending folder toggles when file list updates stream in
  const reconcilePendingFolderToggles = useCallback(() => {
    if (pendingFolderTogglesRef.current.size === 0) return;
    const now = Date.now();
    const TIMEOUT_MS = 5000;
    const pendingEntries = [...pendingFolderTogglesRef.current.entries()];
    for (const [folderPath, info] of pendingEntries) {
      // Timeout handling
      if (now - info.ts > TIMEOUT_MS) {
        pendingFolderTogglesRef.current.delete(folderPath);
        pendingOperationsRef.current.delete(folderPath);
        // Clear optimistic state if still present
        optimisticFolderStatesRef.current.delete(folderPath);
        const altPath = folderPath === '/' ? null : (folderPath.startsWith('/') ? folderPath.slice(1) : ('/' + folderPath));
        if (altPath) optimisticFolderStatesRef.current.delete(altPath);
        setOptimisticStateVersion(v => v + 1);
        continue;
      }

      const selectableFiles = getSelectableFolderFiles(allFilesMap, folderIndex, folderPath);
      const desiredSelected = info.action === 'add';
      const plan = computeFolderTogglePlan(selectableFiles, selectedFiles, desiredSelected);

      if (plan.kind === 'noop') {
        // If the directory now exists but the plan is noop, clear pending & optimistic
        if (selectableFiles.length > 0) {
          pendingFolderTogglesRef.current.delete(folderPath);
          pendingOperationsRef.current.delete(folderPath);
          optimisticFolderStatesRef.current.delete(folderPath);
          const altPath = folderPath === '/' ? null : (folderPath.startsWith('/') ? folderPath.slice(1) : ('/' + folderPath));
          if (altPath) optimisticFolderStatesRef.current.delete(altPath);
          setOptimisticStateVersion(v => v + 1);
        }
        continue;
      }

      // Apply actual changes now
      pendingFolderTogglesRef.current.delete(folderPath);
      if (plan.kind === 'add') {
        runAdditionsChunked(folderPath, plan.additions);
      } else {
        runRemovalsChunked(folderPath, plan.toRemove);
      }
    }
  }, [allFilesMap, folderIndex, selectedFiles, runAdditionsChunked, runRemovalsChunked]);

  // Listen for file list updates to reconcile pending folder toggles
  useEffect(() => {
    const handler = () => {
      // Slightly debounce to coalesce bursts
      setTimeout(() => {
        reconcilePendingFolderToggles();
      }, 50);
    };
    window.addEventListener('file-list-updated', handler as EventListener);
    return () => window.removeEventListener('file-list-updated', handler as EventListener);
  }, [reconcilePendingFolderToggles]);

  // Also attempt reconciliation when the allFiles list length changes significantly
  useEffect(() => {
    if (pendingFolderTogglesRef.current.size === 0) return;
    const t = setTimeout(() => reconcilePendingFolderToggles(), 200);
    return () => clearTimeout(t);
  }, [allFiles.length, reconcilePendingFolderToggles]);

  // Toggle folder selection (select/deselect all files in folder) with chunking and coalescing
  const toggleFolderSelection = useCallback((folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }): void => {
    // Coalesce very rapid toggles to avoid bursty rebuilds
    const now = Date.now();
    if (now - lastBulkToggleTsRef.current < BULK.COALESCE_MS) {
      return;
    }
    lastBulkToggleTsRef.current = now;

    const endMeasureToggle = perf.startMeasure('selection.apply.toggleFolder.ms');

    // Compute folder plan
    const selectableFiles = getSelectableFolderFiles(allFilesMap, folderIndex, folderPath);
    const plan = computeFolderTogglePlan(selectableFiles, selectedFiles, isSelected);
    if (plan.kind === 'noop') {
      // Early folder toggles may noop if folder index not ready; apply optimistic and queue reconciliation
      applyOptimisticFolderState(folderPath, isSelected, opts);
      pendingFolderTogglesRef.current.set(folderPath, { action: isSelected ? 'add' : 'remove', ts: Date.now() });
      endMeasureToggle();
      return;
    }

    // Optimistically update the cache if requested
    const updateOptimistic = () => applyOptimisticFolderState(folderPath, isSelected, opts);

    // Wrapper to include the original timing measure end
    const runAdditionsThenEnd = (additions: string[]) => runAdditionsChunked(folderPath, additions, endMeasureToggle);
    const runRemovalsThenEnd = (toRemove: Set<string>) => runRemovalsChunked(folderPath, toRemove, endMeasureToggle);

    updateOptimistic();

    if (plan.kind === 'add') { runAdditionsThenEnd(plan.additions); }
    else { runRemovalsThenEnd(plan.toRemove); }
  }, [allFilesMap, selectedFiles, setSelectedFiles, folderIndex, perf, BULK]);

  // Handle select all files (chunked to maintain responsiveness)
  const selectAllFiles = useCallback((displayedFiles: FileData[]) => {
    const endMeasure = perf.startMeasure('selection.apply.selectAll.total.ms');

    const selectablePaths = displayedFiles
      .filter((file: FileData) => !file.isBinary && !file.isSkipped)
      .map((file: FileData) => file.path);

    // Determine additions only
    const existingSelected = new Set<string>(selectedFilesRef.current.map(f => f.path));
    const additions = selectablePaths.filter(p => !existingSelected.has(p));
    const total = additions.length;

    // If nothing to add, still tick overlay to ensure immediate reflection
    if (total === 0) {
      const cache = baseFolderSelectionCacheRef.current;
      if (cache) {
        const paths = new Set<string>(selectedFilesRef.current.map(f => f.path));
        cache.setSelectedPaths?.(paths);
        cache.startProgressiveRecompute?.({ selectedPaths: paths });
      }
      endMeasure();
      return;
    }

    // Helper: keep overlay progressing as chunks apply
    const kickOverlay = () => {
      const cache = baseFolderSelectionCacheRef.current;
      if (!cache) return;
      const paths = new Set<string>([...selectedFilesRef.current.map(f => f.path), ...additions]);
      cache.setSelectedPaths?.(paths);
      cache.startProgressiveRecompute?.({ selectedPaths: paths });
    };

    const endMeasureChunks = perf.startMeasure('selection.apply.selectAll.chunks.total.ms');
    let index = 0;
    let chunks = 0;

    const runChunk = () => {
      const start = index;
      const end = Math.min(index + BULK.ADD_CHUNK, total);
      const slice = additions.slice(start, end);

      startTransition(() => {
        setSelectedFiles((prev: SelectedFileReference[]) => {
          // Deduplicate using a Set seeded with prev
          const set = new Set<string>(prev.map(f => f.path));
          if (slice.every(p => set.has(p))) {
            return prev;
          }
          const next = [...prev];
          for (const p of slice) {
            if (!set.has(p)) {
              set.add(p);
              next.push({ path: p });
            }
          }
          return next;
        });
      });

      index = end;
      chunks++;

      // Keep overlay progressing while applying chunks
      kickOverlay();

      if (index < total) {
        // Microtask scheduling to avoid blocking the UI thread
        Promise.resolve().then(runChunk);
      } else {
        // Completed
        endMeasureChunks();
        perf.recordMetric('selection.apply.chunks', chunks);
        endMeasure();
      }
    };

    runChunk();
  }, [setSelectedFiles, selectedFiles, perf, BULK]);

  // Handle deselect all files (chunked build + single commit)
  const deselectAllFiles = useCallback((displayedFiles: FileData[]) => {
    const endMeasure = perf.startMeasure('selection.apply.deselectAll.total.ms');

    // Convert displayed paths to a Set for faster lookups
    const toRemove = new Set(displayedFiles.map((file: FileData) => file.path));

    const snapshot = [...selectedFilesRef.current];
    const total = snapshot.length;
    let index = 0;
    const CHUNK = BULK.REMOVE_CHUNK;
    const kept: SelectedFileReference[] = [];

    // Helper: keep overlay progressing as we compute
    const kickOverlay = () => {
      const cache = baseFolderSelectionCacheRef.current;
      if (!cache) return;
      const paths = new Set<string>(kept.map(f => f.path));
      cache.setSelectedPaths?.(paths);
      cache.startProgressiveRecompute?.({ selectedPaths: paths });
    };

    const endMeasureChunks = perf.startMeasure('selection.apply.deselectAll.chunks.total.ms');

    const buildNext = () => {
      const start = index;
      const end = Math.min(index + CHUNK, total);
      for (let i = start; i < end; i++) {
        const f = snapshot[i];
        if (!toRemove.has(f.path)) {
          kept.push(f);
        }
      }
      index = end;

      // Keep overlay progressing as we compute
      kickOverlay();

      if (index < total) {
        setTimeout(buildNext, 0);
      } else {
        // Commit in a single state update for removals
        startTransition(() => setSelectedFiles(kept));
        endMeasureChunks();
        endMeasure();
      }
    };

    buildNext();
  }, [setSelectedFiles, selectedFiles, perf, BULK]);

  // Clear all selected files
  const clearSelectedFiles = useCallback(() => {
    setSelectedFiles([]);
  }, [setSelectedFiles]);

  // Get the current selection state for workspace saving
  const getSelectionState = () => selectedFiles;

  // Set the selection state from a workspace
  const setSelectionState = useCallback((files: SelectedFileReference[]): void => {
    // Deduplicate files by path before setting
    const uniqueFiles = [...new Map(files.map(file => [file.path, file])).values()];

    // Direct replacement - no need to clear first as this causes React batching issues
    setSelectedFiles(uniqueFiles);
  }, [setSelectedFiles]);

  return {
    selectedFiles,
    setSelectedFiles,
    updateSelectedFile,
    findSelectedFile,
    toggleFileSelection,
    toggleSelection,
    toggleFolderSelection,
    selectAllFiles,
    deselectAllFiles,
    clearSelectedFiles,
    getSelectionState,
    setSelectionState,
    cleanupStaleSelections,
    validateSelectedFilesExist,
    folderSelectionCache
  };
};

export default useFileSelectionState;
