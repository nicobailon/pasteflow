import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';

import { STORAGE_KEYS, FILE_PROCESSING } from '@constants';
import { FileData, LineRange, SelectedFileReference } from '../types/file-types';
import { buildFolderIndex, getFilesInFolder, type FolderIndex } from '../utils/folder-selection-index';
import { createDirectorySelectionCache } from '../utils/selection-cache';
import { BoundedLRUCache } from '../utils/bounded-lru-cache';
import { getGlobalPerformanceMonitor } from '../utils/performance-monitor';

import { useDebouncedPersistentState } from './use-debounced-persistent-state';

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

  // Performance monitor singleton
  const perf = useMemo(() => getGlobalPerformanceMonitor(), []);
  // Overlay version to trigger re-renders when progressive batches apply
  const [folderOverlayVersion, setFolderOverlayVersion] = useState(0);
  // Coalescing guard for rapid bulk toggles
  const lastBulkToggleTsRef = useRef(0);
  // Chunking configuration
  const BULK = useMemo(() => ({ ADD_CHUNK: 1500, REMOVE_CHUNK: 2000, COALESCE_MS: 150 }), []);

  // Build folder selection cache for instant UI updates (memoized by structure only)
  const baseFolderSelectionCache = useMemo(() => {
    return createDirectorySelectionCache(allFiles, selectedFiles, {
      onBatchApplied: () => setFolderOverlayVersion(v => v + 1),
    });
  }, [allFiles]);
  
  // Create a wrapper cache that includes optimistic updates and progressive signals
  const folderSelectionCache = useMemo(() => {
    return {
      get(path: string): 'full' | 'partial' | 'none' {
        // Check optimistic updates first
        const optimisticState = optimisticFolderStatesRef.current.get(path);
        if (optimisticState !== undefined) {
          return optimisticState;
        }
        // Fall back to base cache
        return baseFolderSelectionCache.get(path);
      },
      set: baseFolderSelectionCache.set,
      bulkUpdate: baseFolderSelectionCache.bulkUpdate,
      clear: baseFolderSelectionCache.clear,
      // Progressive API passthroughs (optional)
      isComputing: baseFolderSelectionCache.isComputing?.bind(baseFolderSelectionCache),
      getProgress: baseFolderSelectionCache.getProgress?.bind(baseFolderSelectionCache),
      startProgressiveRecompute: baseFolderSelectionCache.startProgressiveRecompute?.bind(baseFolderSelectionCache),
      cancel: baseFolderSelectionCache.cancel?.bind(baseFolderSelectionCache),
      setSelectedPaths: baseFolderSelectionCache.setSelectedPaths?.bind(baseFolderSelectionCache),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFolderSelectionCache, optimisticStateVersion, folderOverlayVersion]);

  // Keep progressive overlay recomputation in sync with selection changes
  useEffect(() => {
    const paths = new Set<string>(selectedFiles.map(f => f.path));
    baseFolderSelectionCache.setSelectedPaths?.(paths);
    baseFolderSelectionCache.startProgressiveRecompute?.({ selectedPaths: paths });
  }, [selectedFiles, baseFolderSelectionCache]);

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
    const existingFilePaths = new Set<string>([...allFilesMap.keys()]);
    
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
    setSelectedFiles((prev) => {
      // Use functional update to ensure we have latest state
      const existingIndex = prev.findIndex((f) => f.path === filePath);
      
      if (existingIndex >= 0) {
        // File exists - remove it
        return prev.filter((f) => f.path !== filePath);
      }
      
      // Double-check to prevent race condition duplicates
      if (prev.some(f => f.path === filePath)) {
        return prev;
      }
      
      const fileData = allFiles.find((f) => f.path === filePath);
      if (!fileData) return prev;
      
      const newFile: SelectedFileReference = {
        path: filePath
        // lines undefined means entire file
      };
      
      return [...prev, newFile];
    });
  }, [allFiles, setSelectedFiles]);

  // Toggle selection for a specific line range within a file
  const toggleSelection = useCallback((filePath: string, lineRange?: LineRange) => {
    setSelectedFiles((prev) => {
      const existingIndex = prev.findIndex((f) => f.path === filePath);

      if (!lineRange) {
        // If no line range, toggle the entire file
        return existingIndex >= 0 ? prev.filter((f) => f.path !== filePath) : [...prev, { path: filePath }];
      }

      // With a line range
      if (existingIndex < 0) {
        // If file not selected, add it with the new line range
        return [...prev, { path: filePath, lines: [lineRange] }];
      } else {
        // File is already selected, modify its line ranges
        const newSelection = [...prev];
        const selectedFile = newSelection[existingIndex];
        const existingLines = selectedFile.lines || [];
        const lineIndex = existingLines.findIndex(
          (r) => r.start === lineRange.start && r.end === lineRange.end
        );

        if (lineIndex >= 0) {
          // Line range exists, remove it
          const updatedLines = existingLines.filter((_, i) => i !== lineIndex);
          if (updatedLines.length === 0) {
            // If no lines are left, remove the file from selection
            return prev.filter((f) => f.path !== filePath);
          } else {
            newSelection[existingIndex] = { ...selectedFile, lines: updatedLines };
            return newSelection;
          }
        } else {
          // Line range doesn't exist, add it
          newSelection[existingIndex] = {
            ...selectedFile,
            lines: [...existingLines, lineRange],
          };
          return newSelection;
        }
      }
    });
  }, [setSelectedFiles]);

  // Toggle folder selection (select/deselect all files in folder) with chunking and coalescing
  const toggleFolderSelection = useCallback((folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }): void => {
    // Coalesce very rapid toggles to avoid bursty rebuilds
    const now = Date.now();
    if (now - lastBulkToggleTsRef.current < BULK.COALESCE_MS) {
      return;
    }
    lastBulkToggleTsRef.current = now;

    const endMeasureToggle = perf.startMeasure('selection.apply.toggleFolder.ms');

    // Use folder index for O(1) lookup with absolute paths
    const filesInFolderPaths = getFilesInFolder(folderIndex, folderPath);

    // If no files in folder, bail early
    if (filesInFolderPaths.length === 0) {
      endMeasureToggle();
      return;
    }

    // Filter to only selectable files with O(1) lookups
    const selectableFiles = filesInFolderPaths.filter((filePath) => {
      const file = allFilesMap.get(filePath);
      return file && !file.isBinary && !file.isSkipped;
    });

    if (selectableFiles.length === 0) {
      endMeasureToggle();
      return;
    }

    // Precompute set for fast membership checks
    const selectableFilesSet = new Set(selectableFiles);

    // Check current selection state of folder
    const selectedFilesInFolder = selectedFiles.filter(
      (f: SelectedFileReference) => selectableFilesSet.has(f.path)
    );

    // Determine if we should actually toggle
    const allFilesSelected = selectedFilesInFolder.length === selectableFiles.length;
    const noFilesSelected = selectedFilesInFolder.length === 0;

    if ((isSelected && allFilesSelected) || (!isSelected && noFilesSelected)) {
      endMeasureToggle();
      return;
    }

    // Optimistically update the cache if requested
    if (opts?.optimistic !== false) {
      const newState = isSelected ? 'full' : 'none';

      // Clear any existing timeout for this path
      const existingTimeout = optimisticTimeoutsRef.current.get(folderPath);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Mark operation as pending
      pendingOperationsRef.current.add(folderPath);

      // Set optimistic state using the folder path
      optimisticFolderStatesRef.current.set(folderPath, newState);
      setOptimisticStateVersion(v => v + 1); // Trigger re-render

      // Schedule cleanup with a longer timeout to ensure state has settled
      const timeout = setTimeout(() => {
        // Only clean up if no pending operations for this path
        if (!pendingOperationsRef.current.has(folderPath)) {
          optimisticFolderStatesRef.current.delete(folderPath);
          setOptimisticStateVersion(v => v + 1); // Trigger re-render
          optimisticTimeoutsRef.current.delete(folderPath);
        }
      }, FILE_PROCESSING.DEBOUNCE_DELAY_MS); // Using centralized debounce delay for better stability

      optimisticTimeoutsRef.current.set(folderPath, timeout);
    }

    // Helper: kick progressive overlay recompute
    const kickOverlay = () => {
      const paths = new Set<string>(selectedFiles.map(f => f.path));
      baseFolderSelectionCache.setSelectedPaths?.(paths);
      baseFolderSelectionCache.startProgressiveRecompute?.({ selectedPaths: paths });
    };

    if (isSelected) {
      // Add all files from this folder that aren't already selected (chunked)
      const existingSelected = new Set<string>(selectedFiles.map(f => f.path));
      const additions = selectableFiles.filter(p => !existingSelected.has(p));
      const total = additions.length;
      if (total === 0) {
        if (opts?.optimistic !== false) {
          pendingOperationsRef.current.delete(folderPath);
        }
        endMeasureToggle();
        return;
      }

      const endMeasureChunks = perf.startMeasure('selection.apply.add.chunked.total.ms');
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
          // Schedule next chunk via microtask to keep UI responsive
          Promise.resolve().then(runChunk);
        } else {
          // Completed
          endMeasureChunks();
          perf.recordMetric('selection.apply.chunks', chunks);
          if (opts?.optimistic !== false) {
            pendingOperationsRef.current.delete(folderPath);
          }
          endMeasureToggle();
        }
      };

      runChunk();
    } else {
      // Remove all files from this folder (chunk building + single commit)
      const toRemove = new Set(selectableFiles);
      const snapshot = selectedFiles.slice(); // snapshot for deterministic rebuild
      const total = snapshot.length;
      let index = 0;
      const CHUNK = BULK.REMOVE_CHUNK;
      const kept: SelectedFileReference[] = [];

      const endMeasureChunks = perf.startMeasure('selection.apply.remove.chunked.total.ms');

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
          if (opts?.optimistic !== false) {
            pendingOperationsRef.current.delete(folderPath);
          }
          endMeasureToggle();
        }
      };

      buildNext();
    }
  }, [allFilesMap, selectedFiles, setSelectedFiles, folderIndex, baseFolderSelectionCache, perf, BULK]);

  // Handle select all files (chunked to maintain responsiveness)
  const selectAllFiles = useCallback((displayedFiles: FileData[]) => {
    const endMeasure = perf.startMeasure('selection.apply.selectAll.total.ms');

    const selectablePaths = displayedFiles
      .filter((file: FileData) => !file.isBinary && !file.isSkipped)
      .map((file: FileData) => file.path);

    // Determine additions only
    const existingSelected = new Set<string>(selectedFiles.map(f => f.path));
    const additions = selectablePaths.filter(p => !existingSelected.has(p));
    const total = additions.length;

    // If nothing to add, still tick overlay to ensure immediate reflection
    if (total === 0) {
      const paths = new Set<string>(selectedFiles.map(f => f.path));
      baseFolderSelectionCache.setSelectedPaths?.(paths);
      baseFolderSelectionCache.startProgressiveRecompute?.({ selectedPaths: paths });
      endMeasure();
      return;
    }

    // Helper: keep overlay progressing as chunks apply
    const kickOverlay = () => {
      const paths = new Set<string>([...selectedFiles.map(f => f.path), ...additions]);
      baseFolderSelectionCache.setSelectedPaths?.(paths);
      baseFolderSelectionCache.startProgressiveRecompute?.({ selectedPaths: paths });
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
  }, [setSelectedFiles, selectedFiles, baseFolderSelectionCache, perf, BULK]);

  // Handle deselect all files (chunked build + single commit)
  const deselectAllFiles = useCallback((displayedFiles: FileData[]) => {
    const endMeasure = perf.startMeasure('selection.apply.deselectAll.total.ms');

    // Convert displayed paths to a Set for faster lookups
    const toRemove = new Set(displayedFiles.map((file: FileData) => file.path));

    const snapshot = selectedFiles.slice();
    const total = snapshot.length;
    let index = 0;
    const CHUNK = BULK.REMOVE_CHUNK;
    const kept: SelectedFileReference[] = [];

    // Helper: keep overlay progressing as we compute
    const kickOverlay = () => {
      const paths = new Set<string>(kept.map(f => f.path));
      baseFolderSelectionCache.setSelectedPaths?.(paths);
      baseFolderSelectionCache.startProgressiveRecompute?.({ selectedPaths: paths });
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
  }, [setSelectedFiles, selectedFiles, baseFolderSelectionCache, perf, BULK]);

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