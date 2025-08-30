import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { unstable_batchedUpdates, flushSync } from 'react-dom';

import { normalizePath } from '@file-ops/path';
import { STORAGE_KEYS, TOKEN_COUNTING } from '@constants';

import { logger } from '../utils/logger';
import { cancelFileLoading, openFolderDialog, requestFileContent, setupElectronHandlers, setGlobalRequestId } from '../handlers/electron-handlers';
import { applyFiltersAndSort, refreshFileTree } from '../handlers/filter-handlers';
import { electronHandlerSingleton } from '../handlers/electron-handler-singleton';
import { FileData, FileTreeMode, WorkspaceState, SystemPrompt, RolePrompt, Instruction, SelectedFileWithLines, SelectedFileReference } from '../types/file-types';
import { getSelectedFilesContent, getSelectedFilesContentWithoutInstructions } from '../utils/content-formatter';
import { resetFolderState } from '../utils/file-utils';
import { calculateFileTreeTokens, estimateTokenCount, getFileTreeModeTokens } from '../utils/token-utils';
import { enhancedFileContentCache as fileContentCache } from '../utils/enhanced-file-cache-adapter';
import { mapFileTreeSortToContentSort } from '../utils/sort-utils';
import { tokenCountCache } from '../utils/token-cache-adapter';
import { buildFolderIndex } from '../utils/folder-selection-index';
import { VirtualFileLoader } from '../utils/virtual-file-loader';

import useDocState from './use-doc-state';
import useFileSelectionState from './use-file-selection-state';
import { usePersistentState } from './use-persistent-state';
import { useDebouncedPersistentState } from './use-debounced-persistent-state';
import useModalState from './use-modal-state';
import usePromptState from './use-prompt-state';
import { useWorkspaceState } from './use-workspace-state';
import { useTokenService } from './use-token-service';
import { useCancellableOperation } from './use-cancellable-operation';
import { useInstructionsState } from './use-instructions-state';
import { useWorkspaceAutoSave } from './use-workspace-autosave';
import {
  buildWorkspaceState,
  reconcileSelectedInstructions,
} from './use-app-state-helpers';

type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

/**
 * Central application state hook implementing the single-source-of-truth pattern.
 *
 * Architecture Overview:
 * - `allFiles`: The authoritative source for all file data in the workspace
 * - `selectedFiles`: Contains only references (paths + line ranges) to selected files
 * - Components look up file data by combining references with the source data
 *
 * This design solves the file content flicker issue by ensuring:
 * 1. File data is never duplicated across different state variables
 * 2. All file updates flow through a single update path (updateFileWithContent)
 * 3. Selection changes don't trigger unnecessary file data updates
 * 4. Caches are properly invalidated when file content changes
 *
 * Key patterns:
 * - Use `SelectedFileReference` for tracking selections
 * - Use `FileData` from allFiles for all file information
 * - Clear all caches when switching workspaces to prevent memory leaks
 */
const useAppState = () => {
  const isElectron = window.electron !== undefined;

  // Core state
  const [selectedFolder, setSelectedFolder] = useState(null as string | null);
  const [sortOrder, setSortOrder] = usePersistentState<string>(
    STORAGE_KEYS.SORT_ORDER,
    "tokens-desc"
  );
  // Debounce search persistence to avoid spamming IPC on fast typing
  const [searchTerm, setSearchTerm] = useDebouncedPersistentState<string>(
    STORAGE_KEYS.SEARCH_TERM,
    "",
    300
  );
  const [fileTreeMode, setFileTreeMode] = usePersistentState<FileTreeMode>(
    STORAGE_KEYS.FILE_TREE_MODE,
    "none"
  );
  const [exclusionPatterns, setExclusionPatterns] = usePersistentState<string[]>(
    "pasteflow-exclusion-patterns",
    [
      "**/node_modules/",
      "**/.npm/",
      "**/__pycache__/",
      "**/.pytest_cache/",
      "**/.mypy_cache/",
      "**/.gradle/",
      "**/.nuget/",
      "**/.cargo/",
      "**/.stack-work/",
      "**/.ccache/",
      "**/.idea/",
      "**/.vscode/",
      "**/*.swp",
      "**/*~",
      "**/*.tmp",
      "**/*.temp",
      "**/*.bak",
      "**/*.meta",
      "**/package-lock.json",
    ]
  );

  // Initialize virtual file loader
  const virtualFileLoaderRef = useRef<VirtualFileLoader | null>(null);
  useEffect(() => {
    if (!virtualFileLoaderRef.current) {
      virtualFileLoaderRef.current = new VirtualFileLoader(
        async (path: string) => {
          const result = await requestFileContent(path);
          if (result.success && result.content !== undefined) {
            const tokenCount = estimateTokenCount(result.content);
            return { content: result.content, tokenCount };
          }
          throw new Error(result.error || 'Failed to load file');
        }
      );
    }
  }, []);

  // Non-persistent state
  const [allFiles, setAllFiles] = useState([] as FileData[]);
  const [displayedFiles, setDisplayedFiles] = useState([] as FileData[]);
  // Per-workspace expansion state - not globally persistent
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [appInitialized, setAppInitialized] = useState(false);

  type ProcessingStatusType = {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
    processed?: number;
    directories?: number;
    total?: number;
  };
  const [processingStatus, setProcessingStatus] = useState({
    status: "idle" as const,
    message: "",
    processed: 0,
    directories: 0,
    total: 0
  } as ProcessingStatusType);
  const [isLoadingCancellable, setIsLoadingCancellable] = useState(false);
  const [pendingWorkspaceData, setPendingWorkspaceData] = useState(null as PendingWorkspaceData | null);
  const [headerSaveState, setHeaderSaveState] = useState('idle' as 'idle' | 'saving' | 'success');
  const headerSaveTimeoutRef = useRef(null as NodeJS.Timeout | null);
  const [currentWorkspace, setCurrentWorkspace] = useState(null as string | null);

  // Build folder index for efficient folder selection
  const folderIndex = useMemo(() => {
    return buildFolderIndex(allFiles);
  }, [allFiles]);
  const folderIndexSize = useMemo(() => folderIndex.size, [folderIndex]);

  // Integration with specialized hooks
  const fileSelection = useFileSelectionState(allFiles, selectedFolder, folderIndex);
  const promptState = usePromptState();
  const modalState = useModalState();
  const docState = useDocState();
  const { saveWorkspace: persistWorkspace, loadWorkspace: loadPersistedWorkspace, getWorkspaceNames } = useWorkspaceState();
  const { runCancellableOperation } = useCancellableOperation();

  // Extract specific functions from fileSelection to avoid dependency on the whole object
  const clearSelectedFiles = fileSelection.clearSelectedFiles;
  const setSelectionState = fileSelection.setSelectionState;
  const cleanupStaleSelections = fileSelection.cleanupStaleSelections;
  const validateSelectedFilesExist = fileSelection.validateSelectedFilesExist;
  const selectedFiles = fileSelection.selectedFiles;

  // Token service hook - always enabled
  const { countTokens: serviceCountTokens, countTokensBatch, isReady: isServiceReady } = useTokenService();

  // Refs for state values needed in callbacks to avoid unstable dependencies
  const allFilesRef = useRef(allFiles);
  const selectedFolderRef = useRef(selectedFolder);
  const processingStatusRef = useRef(processingStatus);
  const promptStateRef = useRef(promptState); // Ref for the whole prompt state object

  // Update refs whenever state changes
  useEffect(() => { allFilesRef.current = allFiles; }, [allFiles]);
  useEffect(() => { selectedFolderRef.current = selectedFolder; }, [selectedFolder]);
  useEffect(() => { processingStatusRef.current = processingStatus; }, [processingStatus]);
  useEffect(() => { promptStateRef.current = promptState; }, [promptState]);

  // Ref to always access latest selected files
  const selectedFilesRef = useRef(selectedFiles);
  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);

  // Track previous mtimes to detect changed files across refreshes
  const prevMtimeByPathRef = useRef<Map<string, number>>(new Map());

  // Update instructions token count when user instructions change
  const [userInstructions, setUserInstructions] = useState('');
  const [instructionsTokenCount, setInstructionsTokenCount] = useState(0);

  // Instructions (docs) state - now from database
  const instructionsState = useInstructionsState();
  const [selectedInstructions, setSelectedInstructions] = useState(() => [] as Instruction[]);

  const handleResetFolderState = useCallback(() => {
    resetFolderState(
      setSelectedFolder,
      setAllFiles, // Use extracted variable
      fileSelection.setSelectedFiles,
      setProcessingStatus,
      setAppInitialized
    );
    // Reset expanded nodes when resetting folder state
    setExpandedNodes({});
  }, [setSelectedFolder, setAllFiles, fileSelection.setSelectedFiles, setProcessingStatus, setAppInitialized, setExpandedNodes]);

  // Ref for stable callback
  const handleResetFolderStateRef = useRef(handleResetFolderState);
  // Update ref whenever state changes
  useEffect(() => { handleResetFolderStateRef.current = handleResetFolderState; }, [handleResetFolderState]);

  // Clear header save timeout on unmount
  useEffect(() => {
    return () => {
      if (headerSaveTimeoutRef.current) {
        clearTimeout(headerSaveTimeoutRef.current);
      }
    };
  }, []);

  // Apply filters and sorting to files
  const handleFiltersAndSort = useCallback(
    (files: FileData[], sort: string, filter: string) => {
      return applyFiltersAndSort(files, sort, filter, setDisplayedFiles);
    },
    [setDisplayedFiles]
  );

  useEffect(() => {
    setInstructionsTokenCount(estimateTokenCount(userInstructions));
  }, [userInstructions]);

  useEffect(() => {
    const handleWorkspacesChanged = (event: CustomEvent) => {

      if (event.detail?.deleted === currentWorkspace && event.detail?.wasCurrent) {
         setCurrentWorkspace(null);
         handleResetFolderState();
      }
    };

    window.addEventListener('workspacesChanged', handleWorkspacesChanged as EventListener);

    return () => {
      window.removeEventListener('workspacesChanged', handleWorkspacesChanged as EventListener);
    };
  }, [currentWorkspace, setCurrentWorkspace, handleResetFolderState]);

  // Handle sort change
  const handleSortChange = useCallback((newSort: string) => {
    setSortOrder(newSort);
    handleFiltersAndSort(allFiles, newSort, searchTerm);
    setSortDropdownOpen(false); // Close dropdown after selection
  }, [allFiles, searchTerm, setSortOrder, handleFiltersAndSort]);

  // Add the new handler for file tree sort changes
  const handleFileTreeSortChange = useCallback((fileTreeSort: string) => {
    const mappedSort = mapFileTreeSortToContentSort(fileTreeSort);
    setSortOrder(mappedSort);
    handleFiltersAndSort(allFiles, mappedSort, searchTerm);
  }, [allFiles, searchTerm, setSortOrder, handleFiltersAndSort]);

  // Handle search change
  const handleSearchChange = useCallback((newSearch: string) => {
    setSearchTerm(newSearch);
    handleFiltersAndSort(allFiles, sortOrder, newSearch);
  }, [allFiles, sortOrder, setSearchTerm, handleFiltersAndSort]);

  // State for sort dropdown
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Toggle sort dropdown
  const toggleSortDropdown = useCallback(() => {
    setSortDropdownOpen(!sortDropdownOpen);
  }, [sortDropdownOpen]);

  // Calculate token counts for file tree modes
  const fileTreeTokenCounts = useCallback(() => {
    return calculateFileTreeTokens(allFiles, fileSelection.selectedFiles, selectedFolder);
  }, [allFiles, fileSelection.selectedFiles, selectedFolder]);

  // Get the token count for the current file tree mode
  const getCurrentFileTreeTokens = useCallback(() => {
    return getFileTreeModeTokens(allFiles, fileSelection.selectedFiles, selectedFolder, fileTreeMode);
  }, [allFiles, fileSelection.selectedFiles, selectedFolder, fileTreeMode]);

  // Handle token calculations - now uses estimation when content not loaded
  const calculateTotalTokens = useCallback(() => {
    const allFilesMap = new Map(allFiles.map(file => [file.path, file]));

    let total = 0;
    for (const selectedFile of fileSelection.selectedFiles) {
      const fileData = allFilesMap.get(selectedFile.path);
      if (fileData) {
        // If content is loaded and we have actual token count
        if (fileData.isContentLoaded && fileData.tokenCount) {
          // If the selection has specific line ranges, estimate token count for those
          if (selectedFile.lines && selectedFile.lines.length > 0 && fileData.content) {
            const lines = fileData.content.split('\n');
            let selectedContent = '';
            for (const range of selectedFile.lines) {
              selectedContent += lines.slice(range.start - 1, range.end).join('\n') + '\n';
            }
            // Simple estimation using centralized constant
            total += Math.ceil(selectedContent.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
          } else {
            // Full file selected
            total += fileData.tokenCount;
          }
        } else {
          // If content not loaded, estimate based on file size
          // Skip binary and skipped files
          if (!fileData.isBinary && !fileData.isSkipped) {
            // Rough estimation using centralized constant
            total += Math.round(fileData.size / TOKEN_COUNTING.CHARS_PER_TOKEN);
          }
        }
      }
    }
    return total;
  }, [fileSelection.selectedFiles, allFiles]);

  // Open folder dialog
  const openFolder = useCallback(() => {
    if (openFolderDialog(isElectron, setProcessingStatus)) {
      setAppInitialized(true);
    }
  }, [isElectron]);

  // Handle cancel loading
  const handleCancelLoading = useCallback(() => {
    cancelFileLoading(isElectron, setProcessingStatus);
    setIsLoadingCancellable(false);
  }, [isElectron]);

  // Refresh file tree
  const handleRefreshFileTree = useCallback(() => {
    refreshFileTree(
      isElectron,
      selectedFolder,
      exclusionPatterns,
      setProcessingStatus
    );
  }, [isElectron, selectedFolder, exclusionPatterns, setProcessingStatus]);

  // Toggle expand/collapse state changes
  const toggleExpanded = useCallback((nodeId: string, currentState?: boolean) => {
    setExpandedNodes((prev: Record<string, boolean>) => {
      // If currentState is provided, use it to determine the new state
      // Otherwise fall back to the old logic for backward compatibility
      let newValue: boolean;

      if (currentState === undefined) {
        // Fallback logic when currentState not provided
        // Since we don't know the current visual state, we have to make an assumption
        // If never toggled before (undefined), assume the user wants to toggle TO true (expand)
        // This works for folders that start collapsed (most folders)
        // For folders that start expanded (level < 2), this will be wrong on first click
        newValue = prev[nodeId] === undefined ? true : !prev[nodeId];
      } else {
        // We know the exact current state, so just invert it
        newValue = !currentState;
      }

      // The usePersistentState hook will handle persistence

      return {
        ...prev,
        [nodeId]: newValue,
      };
    });
  }, []);

  // Get content with prompts and instructions
  const getFormattedContent = useCallback(() => {
    return getSelectedFilesContent(
      allFiles,
      fileSelection.selectedFiles,
      sortOrder,
      fileTreeMode,
      selectedFolder,
      promptState.selectedSystemPrompts,
      promptState.selectedRolePrompts,
      selectedInstructions,
      userInstructions
    );
  }, [
    allFiles,
    fileSelection.selectedFiles,
    sortOrder,
    fileTreeMode,
    selectedFolder,
    promptState.selectedSystemPrompts,
    promptState.selectedRolePrompts,
    selectedInstructions,
    userInstructions
  ]);

  // Freshness-safe content getter that reads latest state via refs
  const getFormattedContentFromLatest = useCallback(() => {
    return getSelectedFilesContent(
      allFilesRef.current,
      selectedFilesRef.current,
      sortOrderRef.current,
      fileTreeModeRef.current,
      selectedFolderRef.current,
      promptStateRef.current.selectedSystemPrompts,
      promptStateRef.current.selectedRolePrompts,
      selectedInstructionsRef.current,
      userInstructionsRef.current
    );
  }, []);

  // Get content without instructions
  const getFormattedContentWithoutInstructions = useCallback(() => {
    return getSelectedFilesContentWithoutInstructions(
      allFiles,
      fileSelection.selectedFiles,
      sortOrder,
      fileTreeMode,
      selectedFolder
    );
  }, [
    allFiles,
    fileSelection.selectedFiles,
    sortOrder,
    fileTreeMode,
    selectedFolder
  ]);

  // Helper function to validate file load request
  const validateFileLoadRequest = useCallback((filePath: string, files: FileData[]): { valid: boolean; file?: FileData; reason?: string } => {
    const file = files.find((f: FileData) => f.path === filePath);

    if (!file) {
      logger.warn('[validateFileLoadRequest] File not found in allFiles:', filePath);
      return { valid: false, reason: 'File not found' };
    }

    if (file.isContentLoaded) {
      // Debug-only: noisy but useful while investigating
      logger.debug('[validateFileLoadRequest] Already loaded, skipping:', filePath);
      return { valid: false, reason: 'Already loaded' };
    }

    // Skip files that are marked binary or skipped
    if (file.isBinary || file.isSkipped) {
      logger.debug('[validateFileLoadRequest] Binary or skipped file, skipping load:', filePath);
      return { valid: false, reason: 'Binary or skipped' };
    }

    // Normalize paths before workspace containment check to avoid false negatives
    if (selectedFolder) {
      try {
        const normalizedFile = normalizePath(filePath);
        const normalizedRoot = normalizePath(selectedFolder);
        const inside = normalizedFile === normalizedRoot || normalizedFile.startsWith(normalizedRoot + '/');
        if (!inside) {
          logger.warn('[validateFileLoadRequest] Outside workspace, skipping load:', { filePath, selectedFolder, normalizedFile, normalizedRoot });
          return { valid: false, reason: 'Outside workspace' };
        }
      } catch (error) {
        logger.warn('[validateFileLoadRequest] Path normalization failed; proceeding with conservative check', error as Error);
        if (!filePath.startsWith(selectedFolder)) {
          return { valid: false, reason: 'Outside workspace' };
        }
      }
    }

    return { valid: true, file };
  }, [selectedFolder]);

  // Helper function to update file loading state
  const updateFileLoadingState = useCallback((filePath: string, isLoading: boolean, isBulkOperation = false) => {
    logger.debug('[updateFileLoadingState] Set isCountingTokens', { filePath, isLoading });
    const updateFn = () => {
      setAllFiles((prev: FileData[]) => {
        const next = prev.map((f: FileData) =>
          f.path === filePath
            ? { ...f, isCountingTokens: isLoading }
            : f
        );
        allFilesRef.current = next;
        return next;
      });
    };

    // Only use flushSync for single-file user interactions, not bulk operations
    if (isBulkOperation) {
      updateFn();
    } else {
      flushSync(updateFn);
    }

    // Removed automatic file selection when loading content
    // Files should only be selected via explicit user action (checkbox or Apply in modal)
  }, [setAllFiles]);

  // Helper function to process token counting
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const processFileTokens = useCallback(async (
    content: string,
    filePath: string,
    priority = 0
  ): Promise<{ tokenCount: number; error?: string }> => {
    try {
      // Always use the service facade - it handles backend selection and fallback
      const tokenCount = await serviceCountTokens(content);
      return { tokenCount };
    } catch (error) {
      logger.error(`Token counting failed for ${filePath}:`, error);
      // Service should have already fallen back, but use estimate as last resort
      const tokenCount = estimateTokenCount(content);
      return { tokenCount, error: 'Token service failed, used estimation' };
    }
  }, [serviceCountTokens]);

  // Helper function to update file with content and tokens
  const updateFileWithContent = useCallback((
    filePath: string,
    content: string,
    tokenCount: number,
    tokenCountError?: string,
    isBulkOperation = false
  ) => {
    logger.debug('[updateFileWithContent] Apply content and tokens', { filePath, tokenCount, hasContent: !!content, tokenCountError });
    fileContentCache.set(filePath, content, tokenCount);

    // Invalidate token cache for this file when content changes
    tokenCountCache.invalidateFile(filePath);

    const updateFn = () => {
      setAllFiles((prev: FileData[]) => {
        const next = prev.map((f: FileData) =>
          f.path === filePath
            ? {
                ...f,
                content,
                tokenCount,
                isContentLoaded: true,
                isCountingTokens: false,
                error: undefined,
                tokenCountError
              }
            : f
        );
        allFilesRef.current = next;
        return next;
      });
    };

    // Use flushSync only for single-file user interactions, not bulk operations
    // This fixes the issue where token counts don't appear until a second file is selected
    if (isBulkOperation) {
      updateFn();
    } else {
      flushSync(updateFn);
    }

    // Note: We don't call updateSelectedFile here because:
    // 1. The file is already in the selection if it was selected
    // 2. Calling updateSelectedFile could cause duplicates during workspace loading
    // 3. The selection state and file content state are separate concerns
  }, [setAllFiles]);

  // Helper function to handle cached content
  const handleCachedContent = useCallback(async (
    filePath: string,
    cached: { content: string; tokenCount?: number }
  ): Promise<boolean> => {
    if (cached.tokenCount !== undefined) {
      updateFileWithContent(filePath, cached.content, cached.tokenCount);
      return true;
    }

    // Need to count tokens for cached content
    const { tokenCount, error } = await processFileTokens(cached.content, filePath, 0); // High priority for visible files
    updateFileWithContent(filePath, cached.content, tokenCount, error);
    return true;
  }, [processFileTokens, updateFileWithContent]);

  const loadFileContent = useCallback(async (filePath: string): Promise<void> => {
    logger.debug('[loadFileContent] Start', { filePath });
    try {
      // Get current files state for validation
      const currentFiles = await new Promise<FileData[]>((resolve) => {
        setAllFiles((prev: FileData[]) => {
          resolve(prev);
          return prev;
        });
      });

      // Validate the request
      const validation = validateFileLoadRequest(filePath, currentFiles);
      if (!validation.valid) {
        if (validation.reason === 'Outside workspace') {
          logger.warn(`Skipping file outside current workspace: ${filePath}`);
        }
        return;
      }

      // Check if already loading to prevent duplicate requests
      const file = validation.file;
      if (file && file.isCountingTokens) {
        logger.debug('[loadFileContent] Already counting tokens, skip duplicate request', { filePath });
        return;
      }

      // Mark file as loading
      updateFileLoadingState(filePath, true);

      // Check cache first
      const cached = fileContentCache.get(filePath);
      if (cached) {
        logger.debug('[loadFileContent] Served from cache', { filePath });
        await handleCachedContent(filePath, cached);
        return;
      }

      // Load from backend
      const result = await requestFileContent(filePath);
      if (result.success && result.content !== undefined) {
        logger.debug('[loadFileContent] Fetched from backend', { filePath, contentLength: result.content.length });

        // Optimistic fast-path: update content immediately with an estimated token count
        const estimated = estimateTokenCount(result.content);
        updateFileWithContent(filePath, result.content, estimated);

        // Count tokens in background and update if necessary
        processFileTokens(result.content, filePath, 0)
          .then(({ tokenCount, error }) => {
            if (!isMountedRef.current) return; // Component unmounted, skip state updates
            // If precise count differs or there was an error note, update the record
            if (tokenCount !== estimated || error) {
              setAllFiles((prev: FileData[]) => {
                const next = prev.map((f: FileData) =>
                  f.path === filePath
                    ? { ...f, tokenCount, tokenCountError: error, isContentLoaded: true, isCountingTokens: false }
                    : f
                );
                allFilesRef.current = next;
                return next;
              });
            }
          })
          .catch(error => {
            if (!isMountedRef.current) return;
            logger.error(`[loadFileContent] Token counting failed in background for ${filePath}:`, error);
          });
      } else {
        // Handle error
        logger.error('[loadFileContent] Backend load failed', { filePath, error: result.error });
        setAllFiles((prev: FileData[]) => {
          const next = prev.map((f: FileData) =>
            f.path === filePath
              ? {
                  ...f,
                  error: result.error,
                  isBinary: (result as any).isBinary === true ? true : f.isBinary,
                  isContentLoaded: false,
                  isCountingTokens: false
                }
              : f
          );
          allFilesRef.current = next;
          return next;
        });
      }
    } catch (error) {
      logger.error(`Error loading file content for ${filePath}:`, error);
      // Ensure loading state is cleared on any error
      setAllFiles((prev: FileData[]) => {
        const next = prev.map((f: FileData) =>
          f.path === filePath
            ? { ...f, error: 'Failed to load file', isContentLoaded: false, isCountingTokens: false }
            : f
        );
        allFilesRef.current = next;
        return next;
      });
    } finally {
      logger.debug('[loadFileContent] End', { filePath });
    }
  }, [
    validateFileLoadRequest,
    updateFileLoadingState,
    handleCachedContent,
    processFileTokens,
    updateFileWithContent,
    setAllFiles
  ]);

  // Helper function to set batch loading state
  const setBatchLoadingState = useCallback((filePaths: string[], isLoading: boolean) => {
    setAllFiles((prev: FileData[]) => {
      const next = prev.map((f: FileData) =>
        filePaths.includes(f.path)
          ? { ...f, isCountingTokens: isLoading }
          : f
      );
      allFilesRef.current = next;
      return next;
    });
  }, [setAllFiles]);

  // Helper function to process batch results
  const processBatchResults = useCallback((
    results: { success: boolean; content?: string; error?: string; isBinary?: boolean }[],
    filePaths: string[]
  ) => {
    const successful: { path: string; content: string }[] = [];
    const failed: { path: string; error: string; isBinary?: boolean }[] = [];

    for (const [index, result] of results.entries()) {
      const path = filePaths[index];
      if (result.success && result.content !== undefined) {
        successful.push({ path, content: result.content });
      } else {
        failed.push({ path, error: result.error || 'Failed to load content', isBinary: result.isBinary });
      }
    }

    return { successful, failed };
  }, []);

  // Helper function to update file state with token counts
  const updateFilesWithTokenCounts = useCallback((
    filePaths: string[],
    filePathToResult: Map<string, any>,
    filePathToTokenCount: Map<string, number>
  ) => {
    setAllFiles((prev: FileData[]) => {
      const next = prev.map((f: FileData) => {
        if (!filePaths.includes(f.path)) return f;

        const result = filePathToResult.get(f.path);
        const tokenCount = filePathToTokenCount.get(f.path);

        if (result?.success && result.content !== undefined && tokenCount !== undefined) {
          fileContentCache.set(f.path, result.content, tokenCount);

          // Note: We don't update the selection here to avoid duplicates
          // The file is already selected if needed

          return {
            ...f,
            content: result.content,
            tokenCount,
            isContentLoaded: true,
            isCountingTokens: false,
            error: undefined,
            tokenCountError: undefined
          };
        } else if (result && !result.success) {
          return {
            ...f,
            error: result.error || 'Failed to load content',
            isBinary: result.isBinary === true ? true : f.isBinary,
            isContentLoaded: false,
            isCountingTokens: false,
            tokenCountError: undefined
          };
        } else {
          return {
            ...f,
            tokenCountError: 'Failed to count tokens',
            isCountingTokens: false
          };
        }
      });
      allFilesRef.current = next;
      return next;
    });
  }, [setAllFiles]);

  // Helper function for fallback token counting
  const fallbackTokenCounting = useCallback(async (
    successfulLoads: { path: string; content: string }[]
  ) => {
    for (const { path, content } of successfulLoads) {
      const tokenCount = estimateTokenCount(content);
      fileContentCache.set(path, content, tokenCount);

      setAllFiles((prev: FileData[]) => {
        const next = prev.map((f: FileData) =>
          f.path === path
            ? { ...f, content, tokenCount, isContentLoaded: true, isCountingTokens: false }
            : f
        );
        allFilesRef.current = next;
        return next;
      });
    }
  }, [setAllFiles]);

  // Batch load multiple file contents
  const loadMultipleFileContents = useCallback(async (filePaths: string[], options?: { priority?: number }): Promise<void> => {
    if (!isServiceReady) {
      for (const path of filePaths) {
        await loadFileContent(path);
      }
      return;
    }

    setBatchLoadingState(filePaths, true);

    const results = await Promise.all(
      filePaths.map(path => requestFileContent(path))
    );

    const { successful, failed } = processBatchResults(results, filePaths);

    if (successful.length > 0) {
      try {
        const contents = successful.map((item: { path: string; content: string }) => item.content);
        const tokenCounts = await countTokensBatch(contents);

        const filePathToTokenCount = new Map(
          successful.map((item: { path: string; content: string }, index: number) => [item.path, tokenCounts[index]])
        );

        const filePathToResult = new Map(
          results.map((result, index) => [filePaths[index], result])
        );

        updateFilesWithTokenCounts(filePaths, filePathToResult, filePathToTokenCount);
      } catch (error) {
        logger.error('Error in batch token counting:', error);
        await fallbackTokenCounting(successful);
      }
    }

    if (failed.length > 0) {
      setAllFiles((prev: FileData[]) => {
        const failedMap = new Map(failed.map(item => [item.path, item]));
        const next = prev.map((f: FileData) => {
          const fail = failedMap.get(f.path);
          if (!fail) return f;
          return {
            ...f,
            error: fail.error || 'Failed to load content',
            isBinary: fail.isBinary === true ? true : f.isBinary,
            isContentLoaded: false,
            isCountingTokens: false
          };
        });
        allFilesRef.current = next;
        return next;
      });
    }
  }, [
    isServiceReady,
    loadFileContent,
    countTokensBatch,
    setBatchLoadingState,
    processBatchResults,
    updateFilesWithTokenCounts,
    fallbackTokenCounting,
    setAllFiles
  ]);

  // expandedNodes is managed by usePersistentState hook



  // Set up viewFile event listener
  useEffect(() => {
    const handleViewFileEvent = (event: CustomEvent) => {
      if (event.detail && typeof event.detail === 'string') {
        modalState.openFileViewModal(event.detail);
      }
    };

    // Add event listener
    window.addEventListener('viewFile', handleViewFileEvent as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('viewFile', handleViewFileEvent as EventListener);
    };
  }, [modalState]);

  // Note: file-list-updated event listener removed as it had no implementation
  // If this event handling is needed in the future, re-add with proper logic

  // Wrap saveWorkspace in useCallback to avoid recreating it on every render
  const saveWorkspace = useCallback(async (name: string) => {
    const workspace = buildWorkspaceState({
      selectedFolder,
      expandedNodes,
      allFiles,
      selectedFiles: fileSelection.selectedFiles,
      sortOrder,
      searchTerm,
      fileTreeMode,
      exclusionPatterns,
      userInstructions,
      systemPrompts: promptState.selectedSystemPrompts,
      rolePrompts: promptState.selectedRolePrompts,
      selectedInstructions,
    });

    await persistWorkspace(name, workspace);

  }, [
    selectedFolder,
    expandedNodes,
    fileSelection.selectedFiles,
    allFiles,
    sortOrder,
    searchTerm,
    fileTreeMode,
    exclusionPatterns,
    userInstructions,
    promptState.selectedSystemPrompts,
    promptState.selectedRolePrompts,
    selectedInstructions,
    persistWorkspace
  ]);

  // Helper functions for workspace data application
  const handleFolderChange = useCallback((workspaceName: string, workspaceFolder: string | null, workspaceData: WorkspaceState) => {

    // CRITICAL: Cancel any in-progress file loading
    if (processingStatus.status === "processing") {
      cancelFileLoading(isElectron, setProcessingStatus);
    }

    // Clear file content cache when switching workspaces
    fileContentCache.clear();

    // Clear token count cache when switching workspaces
    tokenCountCache.clear();

    // Clear all files to prevent accumulation from previous workspace
    setAllFiles([]);

    // Clear selected files when switching workspaces
    clearSelectedFiles();

    setCurrentWorkspace(workspaceName);

    if (workspaceFolder === null) {
      handleResetFolderStateRef.current();
      setPendingWorkspaceData(null);
    } else {
      // Important: Apply expansion state immediately before files start loading
      // This ensures the tree is built with the correct expansion state
      if (workspaceData.expandedNodes) {
        setExpandedNodes(workspaceData.expandedNodes);
      }

      const { selectedFolder: _selectedFolder, ...restOfData } = workspaceData;
      setPendingWorkspaceData(restOfData);

      if (window.electron?.ipcRenderer) {
        setProcessingStatus({
          status: "processing",
          message: `Loading files from workspace folder: ${workspaceFolder}`,
          processed: 0,
          directories: 0,
          total: 0
        });
        const requestId = Math.random().toString(36).slice(2, 11);
        setGlobalRequestId(requestId);
        window.electron.ipcRenderer.send("request-file-list", workspaceFolder, exclusionPatterns || [], requestId);
      }
    }

    setSelectedFolder(workspaceFolder);
  }, [exclusionPatterns, setProcessingStatus, setSelectedFolder, setCurrentWorkspace, setPendingWorkspaceData, processingStatus.status, isElectron, setAllFiles, clearSelectedFiles, setExpandedNodes]);

  const applyExpandedNodes = useCallback((expandedNodesFromWorkspace: Record<string, boolean>) => {
    setExpandedNodes(expandedNodesFromWorkspace || {});
  }, [setExpandedNodes]);

  const applySelectedFiles = useCallback((selectedFilesToApply: SelectedFileReference[], availableFiles: FileData[]): void => {
    // Deduplicate input files before applying
    const uniqueFiles = [...new Map(selectedFilesToApply.map(file => [file.path, file])).values()];

    // Create a map of available files for efficient lookup
    const availableFilesMap = new Map(availableFiles.map(f => [f.path, f]));

    // Filter the saved selections and restore them with proper line selection data
    const filesToSelect = uniqueFiles
      .map(savedFile => {
        const availableFile = availableFilesMap.get(savedFile.path);
        if (!availableFile) return null;

        // Convert SelectedFileReference to the format expected by setSelectionState
        return {
          path: savedFile.path,
          lines: savedFile.lines
        } as SelectedFileReference;
      })
      .filter((file): file is SelectedFileReference => !!file);

    // Always call setSelectionState even with empty array to ensure proper clearing
    // Batch state updates
    unstable_batchedUpdates(() => {
      setSelectionState(filesToSelect);
    });

    // Load content for all selected files that don't have content yet
    const filesToLoad = filesToSelect.filter(file => {
      const fileData = availableFilesMap.get(file.path);
      return fileData && !fileData.isContentLoaded && !fileData.isBinary && !fileData.isSkipped;
    });

    if (filesToLoad.length > 0) {
      // Batch loading to avoid main-thread saturation and keep tree-building responsive
      const uniquePaths = [...new Set(filesToLoad.map(f => f.path))];
      const pending = [...uniquePaths];

      // Adaptive batch size/priority based on selection size
      const total = pending.length;
      let BATCH = 20;
      let PRIORITY = 8;
      let STEP_DELAY_MS = 8;
      if (total >= 2000) { BATCH = 120; PRIORITY = 12; STEP_DELAY_MS = 2; }
      else if (total >= 1000) { BATCH = 80; PRIORITY = 10; STEP_DELAY_MS = 4; }
      else if (total >= 500) { BATCH = 60; PRIORITY = 10; STEP_DELAY_MS = 6; }
      else if (total >= 200) { BATCH = 40; PRIORITY = 10; STEP_DELAY_MS = 8; }
      else if (total >= 80)  { BATCH = 30; PRIORITY = 8; STEP_DELAY_MS = 10; }

      const step = async () => {
        if (pending.length === 0) return;
        const slice = pending.splice(0, BATCH);
        try {
          // Use pooled batch loader to minimize per-file flushes and state churn
          await loadMultipleFileContents(slice, { priority: PRIORITY });
        } catch (error) {
          logger.error('[useAppState.applySelectedFiles] Error in batched file content load:', error);
        }
        if (pending.length > 0) {
          setTimeout(step, STEP_DELAY_MS);
        }
      };

      // Defer batch start to ensure UI (tree progress) paints first
      setTimeout(step, 0);
    }
  }, [setSelectionState, loadMultipleFileContents]);

  const applyPrompts = useCallback((promptsToApply: { systemPrompts?: SystemPrompt[], rolePrompts?: RolePrompt[] }) => {

    const currentPrompts = promptStateRef.current;

    // Deselect current prompts
    for (const prompt of currentPrompts.selectedSystemPrompts) currentPrompts.toggleSystemPromptSelection(prompt)
    ;
    for (const prompt of currentPrompts.selectedRolePrompts) currentPrompts.toggleRolePromptSelection(prompt)
    ;

    // Apply new prompts
    if (promptsToApply?.systemPrompts) {
      for (const savedPrompt of promptsToApply.systemPrompts) {
        const availablePrompt = currentPrompts.systemPrompts.find((p: SystemPrompt) => p.id === savedPrompt.id);
        if (availablePrompt && !currentPrompts.selectedSystemPrompts.some((p: SystemPrompt) => p.id === availablePrompt.id)) {
          currentPrompts.toggleSystemPromptSelection(availablePrompt);
        }
      }
    }
    if (promptsToApply?.rolePrompts) {
      for (const savedPrompt of promptsToApply.rolePrompts) {
        const availablePrompt = currentPrompts.rolePrompts.find((p: RolePrompt) => p.id === savedPrompt.id);
        if (availablePrompt && !currentPrompts.selectedRolePrompts.some((p: RolePrompt) => p.id === availablePrompt.id)) {
          currentPrompts.toggleRolePromptSelection(availablePrompt);
        }
      }
    }
  }, []);

  // Add a ref to track if we're currently applying workspace data
  const isApplyingWorkspaceDataRef = useRef(false);

  // This function handles applying workspace data, with proper file selection management
  const applyWorkspaceData = useCallback((workspaceName: string | null, workspaceData: WorkspaceState | null) => {
    if (!workspaceData || !workspaceName) {
      logger.warn("[useAppState.applyWorkspaceData] Received null workspace data or name. Cannot apply.", { workspaceName, hasData: !!workspaceData });
      setPendingWorkspaceData(null);
      isApplyingWorkspaceDataRef.current = false; // Reset flag
      return;
    }

    // Prevent concurrent calls to avoid infinite loops
    if (isApplyingWorkspaceDataRef.current) {
      logger.warn("[useAppState.applyWorkspaceData] Already applying workspace data, skipping to prevent infinite loop");
      return;
    }

    isApplyingWorkspaceDataRef.current = true;

    const currentSelectedFolder = selectedFolderRef.current;
    const currentProcessingStatus = processingStatusRef.current;
    const workspaceFolder = workspaceData.selectedFolder || null;
    const folderChanged = currentSelectedFolder !== workspaceFolder;
    const isProcessing = currentProcessingStatus.status === 'processing';

    // Don't clear files here - let applySelectedFiles handle it properly

    if (folderChanged && !isProcessing) {
      // Clear all files when folder changes to prevent accumulation
      setAllFiles([]);
      handleFolderChange(workspaceName, workspaceFolder, workspaceData);
      isApplyingWorkspaceDataRef.current = false; // Reset flag
      return;
    } else if (folderChanged && isProcessing) {
      logger.warn(`[useAppState.applyWorkspaceData] Folder changed but currently processing. Cannot change folder to "${workspaceFolder}". Aborting workspace load.`);
      setPendingWorkspaceData(null);
      isApplyingWorkspaceDataRef.current = false; // Reset flag
      return;
    }

    setCurrentWorkspace(workspaceName);
    setPendingWorkspaceData(null);


    applyExpandedNodes(workspaceData.expandedNodes);
    applySelectedFiles(workspaceData.selectedFiles, allFilesRef.current);
    setUserInstructions(workspaceData.userInstructions || '');
    applyPrompts({
      systemPrompts: (workspaceData as any).systemPrompts || [],
      rolePrompts: (workspaceData as any).rolePrompts || []
    });

    // Reconcile selectedInstructions with current database state
    // The workspace stores full instruction objects, but we need to match them
    // with the current instructions from the database by ID
    setSelectedInstructions(
      reconcileSelectedInstructions(
        workspaceData.selectedInstructions,
        instructionsState.instructions
      )
    );

    // Reset the flag after applying
    isApplyingWorkspaceDataRef.current = false;
  }, [
    setPendingWorkspaceData,
    setCurrentWorkspace,
    setUserInstructions,
    handleFolderChange,
    applyExpandedNodes,
    applySelectedFiles,
    applyPrompts,
    instructionsState.instructions
  ]);

  // Store refs to get latest values in handlers
  const sortOrderRef = useRef(sortOrder);
  const searchTermRef = useRef(searchTerm);
  const currentWorkspaceRef = useRef(currentWorkspace);
  const expandedNodesRef = useRef(expandedNodes);
  const fileTreeModeRef = useRef(fileTreeMode);
  const exclusionPatternsRef = useRef(exclusionPatterns);
  const userInstructionsRef = useRef(userInstructions);
  const selectedInstructionsRef = useRef(selectedInstructions);
  // selectedFolderRef already exists above

  // Update refs when values change
  useEffect(() => {
    sortOrderRef.current = sortOrder;
  }, [sortOrder]);

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  useEffect(() => {
    currentWorkspaceRef.current = currentWorkspace;
  }, [currentWorkspace]);

  useEffect(() => {
    expandedNodesRef.current = expandedNodes;
  }, [expandedNodes]);

  useEffect(() => {
    fileTreeModeRef.current = fileTreeMode;
  }, [fileTreeMode]);

  useEffect(() => {
    exclusionPatternsRef.current = exclusionPatterns;
  }, [exclusionPatterns]);

  useEffect(() => {
    userInstructionsRef.current = userInstructions;
  }, [userInstructions]);

  useEffect(() => {
    selectedInstructionsRef.current = selectedInstructions;
  }, [selectedInstructions]);

  useEffect(() => {
    if (!isElectron) return;

    try {
      electronHandlerSingleton.setup(() => {

        // Create wrapper functions that use refs to get latest values
        const handleFiltersAndSortWrapper = (files: FileData[], _sort: string, _filter: string) => {
          handleFiltersAndSort(files, sortOrderRef.current, searchTermRef.current);
        };

        // React to external workspace updates (e.g., CLI selection changes)
        const handleWorkspaceUpdatedWrapper = (payload: { folderPath?: string; selectedFiles?: SelectedFileReference[] }) => {
          try {
            const folderPath = payload?.folderPath || null;
            const incoming = Array.isArray(payload?.selectedFiles) ? (payload!.selectedFiles as SelectedFileReference[]) : [];
            // Only apply if the update is for the currently open folder
            if (folderPath && folderPath === selectedFolderRef.current) {
              applySelectedFiles(incoming, allFilesRef.current);
            }
          } catch (error) {
            logger.warn('[useAppState] Failed to handle workspace-updated payload', error as Error);
          }
        };

        const cleanup = setupElectronHandlers(
          isElectron,
          setSelectedFolder,
          setAllFiles,
          setProcessingStatus,
          fileSelection.clearSelectedFiles,
          handleFiltersAndSortWrapper,
          sortOrderRef.current,
          searchTermRef.current,
          setIsLoadingCancellable,
          setAppInitialized,
          currentWorkspaceRef.current,
          setCurrentWorkspace,
          persistWorkspace,
          getWorkspaceNames,
          selectedFolderRef.current,
          validateSelectedFilesExist,
          handleWorkspaceUpdatedWrapper
        );

        // Dispatch a custom event when handlers are set up
        const event = new CustomEvent('electron-handlers-ready');
        window.dispatchEvent(event);

        return cleanup;
      });
    } catch (error) {
      logger.error("Error setting up Electron handlers:", error);
      setProcessingStatus({
        status: "error",
        message: `Error initializing app: ${error instanceof Error ? error.message : "Unknown error"}`,
        processed: 0,
        directories: 0,
        total: 0
      });
    }

    // Note: We intentionally don't cleanup on unmount because React StrictMode
    // would cause handlers to be registered/unregistered repeatedly.
    // The handlers will persist for the lifetime of the application.
    return () => {
      // Empty cleanup - handlers persist
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      isElectron
      // Removed dependencies to ensure this only runs once
    ]);

  const saveCurrentWorkspace = useCallback(async () => {
    if (!currentWorkspace) {
      logger.warn("[useAppState.saveCurrentWorkspace] No current workspace selected, cannot save.");
      return;
    }
    // Clear any existing timeout
    if (headerSaveTimeoutRef.current) {
      clearTimeout(headerSaveTimeoutRef.current);
    }

    setHeaderSaveState('saving'); // Set state to saving

    try {
      await saveWorkspace(currentWorkspace);
      setHeaderSaveState('success');

      // Set timeout to revert state
      headerSaveTimeoutRef.current = setTimeout(() => {
        setHeaderSaveState('idle');
      }, 1500); // Duration for the checkmark visibility

    } catch (error) {
      logger.error(`[useAppState.saveCurrentWorkspace] Error saving workspace "${currentWorkspace}":`, error);
      setHeaderSaveState('idle');
      logger.error(`Failed to save workspace "${currentWorkspace}".`);
    }
  }, [currentWorkspace, saveWorkspace]);

  const loadWorkspace = useCallback(async (name: string) => {
    return await runCancellableOperation(async (token) => {
      try {
        const workspaceData = await loadPersistedWorkspace(name);

        // Check if cancelled before proceeding
        if (token.cancelled) {
          logger.info(`[useAppState.loadWorkspace] Workspace load cancelled for "${name}"`);
          return null;
        }

        if (workspaceData) {
            // Ensure we have the folder path before applying
            if (!workspaceData.selectedFolder) {
                logger.warn(`[useAppState.loadWorkspace] Workspace "${name}" has no folder path`);
            }

            // Check again if cancelled before applying data
            if (token.cancelled) {
              logger.info(`[useAppState.loadWorkspace] Workspace load cancelled before applying data for "${name}"`);
              return null;
            }

            applyWorkspaceData(name, workspaceData);
        } else {
            logger.error(`[useAppState.loadWorkspace] Failed to load workspace data for "${name}"`);
        }
        return workspaceData;
      } catch (error) {
        logger.error(`[useAppState.loadWorkspace] Error loading workspace "${name}":`, error);
        return null;
      }
    });
  }, [loadPersistedWorkspace, applyWorkspaceData, runCancellableOperation]);

  // Auto-save callback that builds and saves the current workspace state
  const performAutoSave = useCallback(async () => {
    if (!currentWorkspace) return;

    // Build workspace state (same as saveWorkspace)
    const uniqueSelectedFiles = [...new Map(fileSelection.selectedFiles.map(file => [file.path, file])).values()];

    const workspace: WorkspaceState = {
      selectedFolder: selectedFolder,
      expandedNodes: expandedNodes,
      selectedFiles: uniqueSelectedFiles,
      sortOrder: sortOrder,
      searchTerm: searchTerm,
      fileTreeMode: fileTreeMode,
      exclusionPatterns: exclusionPatterns,
      userInstructions: userInstructions,
      tokenCounts: (() => {
        const acc: { [filePath: string]: number } = {};
        const allFilesMap = new Map(allFiles.map(f => [f.path, f]));
        for (const selectedFile of fileSelection.selectedFiles) {
          const fileData = allFilesMap.get(selectedFile.path);
          acc[selectedFile.path] = fileData?.tokenCount || 0;
        }
        return acc;
      })(),
      systemPrompts: promptState.selectedSystemPrompts,
      rolePrompts: promptState.selectedRolePrompts,
      selectedInstructions: selectedInstructions
    };

    // Save without changing header state (silent save)
    await persistWorkspace(currentWorkspace, workspace);
  }, [
    currentWorkspace,
    selectedFolder,
    expandedNodes,
    fileSelection.selectedFiles,
    allFiles,
    sortOrder,
    searchTerm,
    fileTreeMode,
    exclusionPatterns,
    userInstructions,
    promptState.selectedSystemPrompts,
    promptState.selectedRolePrompts,
    selectedInstructions,
    persistWorkspace
  ]);

  // Initialize auto-save hook
  const autoSave = useWorkspaceAutoSave({
    currentWorkspace,
    selectedFolder,
    selectedFiles: fileSelection.selectedFiles,
    expandedNodes,
    sortOrder,
    searchTerm,
    fileTreeMode,
    exclusionPatterns,
    selectedInstructions: selectedInstructions.map(i => i.id),
    customPrompts: {
      systemPrompts: (promptState.systemPrompts ?? []).map(p => ({
        ...p,
        selected: (promptState.selectedSystemPrompts ?? []).some(sp => sp.id === p.id)
      })),
      rolePrompts: (promptState.rolePrompts ?? []).map(p => ({
        ...p,
        selected: (promptState.selectedRolePrompts ?? []).some(rp => rp.id === p.id)
      }))
    },
    userInstructions,
    isApplyingWorkspaceData: isApplyingWorkspaceDataRef.current,
    isProcessing: processingStatus.status !== 'complete' && processingStatus.status !== 'idle',
    onAutoSave: performAutoSave
  });

  // Clean up selected files when workspace changes
  useEffect(() => {
    if (selectedFolder) {
      cleanupStaleSelections();
    }
  }, [selectedFolder, cleanupStaleSelections]);

  // Initial workspace loading effect
  useEffect(() => {
    // Check if app is ready and files are loaded
    if (appInitialized && allFiles.length > 0) {
      // Mark that we've initiated workspace handling for this session
      sessionStorage.setItem("hasLoadedInitialWorkspace", "true");
    }
  }, [appInitialized, allFiles]);

  // Reconcile changed files after a refresh completes using mtimeMs
  useEffect(() => {
    if (processingStatus.status !== 'complete') return;

    try {
      // Build next map of mtimes (only when available)
      const nextMap = new Map<string, number>();
      for (const f of allFiles) {
        if (typeof f.mtimeMs === 'number') {
          nextMap.set(f.path, f.mtimeMs);
        }
      }

      const prevMap = prevMtimeByPathRef.current;
      const changedPaths: string[] = [];

      // Detect files present in both with differing mtime
      for (const [path, mtime] of nextMap.entries()) {
        const prevMtime = prevMap.get(path);
        if (prevMtime !== undefined && prevMtime !== mtime) {
          changedPaths.push(path);
        }
      }

      if (changedPaths.length > 0) {
        // Invalidate caches for changed files
        for (const p of changedPaths) {
          try {
            fileContentCache.delete(p);
            tokenCountCache.invalidateFile(p);
          } catch {
            // best-effort invalidation
          }
        }

        const changedSet = new Set(changedPaths);
        // Mark changed files as not loaded so UI/content reloads lazily
        setAllFiles((prev: FileData[]) => {
          const next = prev.map((f: FileData) => {
            if (!changedSet.has(f.path)) return f;
            return {
              ...f,
              isContentLoaded: false,
              isCountingTokens: false,
              content: '', // clear to avoid stale display
              tokenCount: undefined,
              tokenCountError: undefined
            };
          });
          allFilesRef.current = next;
          return next;
        });

        // Prefetch up to 20 changed files that are currently selected for smoother UX
        const selectedSet = new Set(selectedFilesRef.current.map(sf => sf.path));
        const toPrefetch = changedPaths.filter(p => selectedSet.has(p)).slice(0, 20);
        if (toPrefetch.length > 0) {
          void loadMultipleFileContents(toPrefetch, { priority: 8 });
        }
      }

      // Update snapshot for next reconciliation
      prevMtimeByPathRef.current = nextMap;
    } catch {
      // ignore reconcile errors to avoid impacting UX
    }
  }, [processingStatus.status, allFiles, loadMultipleFileContents]);

  // Define the event handler using useCallback outside the effect
  const handleWorkspaceLoadedEvent = useCallback(async (event: CustomEvent) => {
    if (event.detail?.name && event.detail?.workspace) {
      // Save current workspace before switching (if there is one)
      if (currentWorkspaceRef.current && currentWorkspaceRef.current !== event.detail.name) {
        const workspace = buildWorkspaceState({
          selectedFolder: selectedFolderRef.current,
          expandedNodes: expandedNodesRef.current,
          allFiles: allFilesRef.current,
          selectedFiles: fileSelection.selectedFiles,
          sortOrder: sortOrderRef.current,
          searchTerm: searchTermRef.current,
          fileTreeMode: fileTreeModeRef.current,
          exclusionPatterns: exclusionPatternsRef.current,
          userInstructions: userInstructionsRef.current,
          systemPrompts: promptStateRef.current.selectedSystemPrompts,
          rolePrompts: promptStateRef.current.selectedRolePrompts,
          selectedInstructions: selectedInstructionsRef.current,
        });
        await persistWorkspace(currentWorkspaceRef.current, workspace);
      }

      // Apply the workspace data, including the name
      applyWorkspaceData(event.detail.name, event.detail.workspace); // Pass name and data
      sessionStorage.setItem("hasLoadedInitialWorkspace", "true"); // Mark that initial load happened
    } else {
      logger.warn("[useAppState.workspaceLoadedListener] Received 'workspaceLoaded' event with missing/invalid detail.", event.detail);
    }
  }, [applyWorkspaceData, persistWorkspace, fileSelection.selectedFiles]);

  // Handler for direct folder opening (not from workspace loading)
  const handleDirectFolderOpenedEvent = useCallback((event: CustomEvent) => {
    if (event.detail?.name && event.detail?.workspace) {
      // Apply the workspace data, including the name
      applyWorkspaceData(event.detail.name, event.detail.workspace); // Pass name and data
      sessionStorage.setItem("hasLoadedInitialWorkspace", "true"); // Mark that initial load happened
    } else {
      logger.warn("[useAppState.directFolderOpenedListener] Received 'directFolderOpened' event with missing/invalid detail.", event.detail);
    }
  }, [applyWorkspaceData]);

  useEffect(() => {
    window.addEventListener('workspaceLoaded', handleWorkspaceLoadedEvent as unknown as EventListener);
    window.addEventListener('directFolderOpened', handleDirectFolderOpenedEvent as unknown as EventListener);
    return () => {
      window.removeEventListener('workspaceLoaded', handleWorkspaceLoadedEvent as unknown as EventListener);
      window.removeEventListener('directFolderOpened', handleDirectFolderOpenedEvent as unknown as EventListener);
    };
  }, [handleWorkspaceLoadedEvent, handleDirectFolderOpenedEvent]);

  useEffect(() => {
    // Wait for file loading and instructions to complete before applying workspace data
    if (pendingWorkspaceData &&
        currentWorkspace &&
        allFiles.length > 0 &&
        processingStatus.status === "complete" &&
        !instructionsState.loading) {  // Also wait for instructions to load

      const fullWorkspaceData: WorkspaceState = {
        selectedFolder: selectedFolder,
        ...pendingWorkspaceData
      };


      applyWorkspaceData(currentWorkspace, fullWorkspaceData);
    }
  }, [allFiles.length, pendingWorkspaceData, currentWorkspace, selectedFolder, processingStatus.status, applyWorkspaceData, instructionsState.loading]);

  useEffect(() => {
    const handleCreateNewWorkspaceEvent = () => {
      setCurrentWorkspace(null);
      handleResetFolderStateRef.current();
    };

    window.addEventListener('createNewWorkspace', handleCreateNewWorkspaceEvent as EventListener);

    return () => {
      window.removeEventListener('createNewWorkspace', handleCreateNewWorkspaceEvent as EventListener);
    };
  }, []);

  // Calculate total tokens for selected files
  const totalTokensForSelectedFiles = useMemo(() => {
    return selectedFiles.reduce((acc: number, file: SelectedFileWithLines) => {
      return acc + (file.tokenCount || estimateTokenCount(file.content || ''));
    }, 0);
  }, [selectedFiles]);

  // Calculate total tokens for system prompts
  const totalTokensForSystemPrompt = useMemo(() => {
    if (!promptState.selectedSystemPrompts) return 0;
    return promptState.selectedSystemPrompts.reduce((prev: number, f: SystemPrompt) => {
      return prev + (f.tokenCount || estimateTokenCount(f.content));
    }, 0);
  }, [promptState.selectedSystemPrompts]);

  // Calculate total tokens for role prompts
  const totalTokensForRolePrompt = useMemo(() => {
    if (!promptState.selectedRolePrompts) return 0;
    return promptState.selectedRolePrompts.reduce((prev: number, f: RolePrompt) => {
      return prev + (f.tokenCount || estimateTokenCount(f.content));
    }, 0);
  }, [promptState.selectedRolePrompts]);

  // Calculate total tokens for instructions/docs
  const totalTokensForInstructions = useMemo(() => {
    if (!selectedInstructions || selectedInstructions.length === 0) return 0;
    return selectedInstructions.reduce((prev: number, instruction: Instruction) => {
      return prev + estimateTokenCount(instruction.content);
    }, 0);
  }, [selectedInstructions]);

  const totalTokens = useMemo(() => {
    return totalTokensForSelectedFiles + totalTokensForSystemPrompt + totalTokensForRolePrompt + totalTokensForInstructions;
  }, [totalTokensForSelectedFiles, totalTokensForSystemPrompt, totalTokensForRolePrompt, totalTokensForInstructions]);

  // Helper functions to reduce complexity
  const handleFileSelection = useCallback((file: FileData) => {
    if (!file.isDirectory) {
      fileSelection.toggleFileSelection(file.path);
    }
  }, [fileSelection]);

  const handleDirectoryExpansion = useCallback((file: FileData) => {
    if (file.isDirectory) {
      toggleExpanded(file.path);
    }
  }, [toggleExpanded]);

  const handleFileProcessing = useCallback(async (file: FileData) => {
    if (!file.isDirectory && !file.isContentLoaded) {
      await requestFileContent(file.path);
    }
  }, []);

  const handleFileOperations = useCallback(async (file: FileData) => {
    handleFileSelection(file);
    handleDirectoryExpansion(file);
    await handleFileProcessing(file);
  }, [handleFileSelection, handleDirectoryExpansion, handleFileProcessing]);

  const handleWorkspaceUpdate = useCallback(() => {
    return {
      selectedFolder: selectedFolderRef.current,
      allFiles: allFilesRef.current,
      selectedFiles: fileSelection.selectedFiles,
      expandedNodes,
      sortOrder,
      searchTerm,
      fileTreeMode,
      exclusionPatterns
    };
  }, [expandedNodes, sortOrder, searchTerm, fileTreeMode, exclusionPatterns, fileSelection.selectedFiles]);

  const onAddInstruction = useCallback(async (instruction: Instruction) => {
    await instructionsState.createInstruction(instruction);
  }, [instructionsState]);

  const onDeleteInstruction = useCallback(async (id: string) => {
    await instructionsState.deleteInstruction(id);
    setSelectedInstructions((prev: Instruction[]) => prev.filter(instruction => instruction.id !== id));
  }, [instructionsState]);

  const onUpdateInstruction = useCallback(async (instruction: Instruction) => {
    await instructionsState.updateInstruction(instruction);
    setSelectedInstructions((prev: Instruction[]) => prev.map(i => i.id === instruction.id ? instruction : i));
  }, [instructionsState]);

  const toggleInstructionSelection = useCallback((instruction: Instruction) => {
    setSelectedInstructions((prev: Instruction[]) => {
      const isSelected = prev.some(i => i.id === instruction.id);
      return isSelected ? prev.filter(i => i.id !== instruction.id) : [...prev, instruction];
    });
  }, []);

  // Clear all selections: files + prompts + docs (but not free-text user instructions)
  const clearAllSelections = useCallback(() => {
    try {
      // Clear file selections
      setSelectionState([]);

      // Deselect system prompts
      const currentPrompts = promptStateRef.current;
      for (const sp of currentPrompts.selectedSystemPrompts) {
        currentPrompts.toggleSystemPromptSelection(sp);
      }
      // Deselect role prompts
      for (const rp of currentPrompts.selectedRolePrompts) {
        currentPrompts.toggleRolePromptSelection(rp);
      }

      // Clear selected docs/instructions
      setSelectedInstructions([]);
    } catch (error) {
      logger.warn('[useAppState.clearAllSelections] Failed to clear some selections', error as Error);
    }
  }, [setSelectionState]);

  return {
    isElectron,
    selectedFolder,
    allFiles,
    displayedFiles,
    sortOrder,
    searchTerm,
    fileTreeMode,
    setFileTreeMode,
    expandedNodes,
    processingStatus,
    appInitialized,
    exclusionPatterns,
    setExclusionPatterns,
    isLoadingCancellable,
    currentWorkspace,

    // UI state
    sortDropdownOpen,
    userInstructions,
    instructionsTokenCount,

    // File selection state
    ...fileSelection,

    // Prompts state
    ...promptState,

    // Modal state
    ...modalState,

    // Doc state
    ...docState,

    // Actions
    openFolder,
    handleCancelLoading,
    handleSortChange,
    handleFileTreeSortChange,
    handleSearchChange,
    toggleSortDropdown,
    setUserInstructions,
    toggleExpanded,
    handleRefreshFileTree,
    handleResetFolderState,
    handleFileOperations,
    handleWorkspaceUpdate,
    clearAllSelections,

    // Calculations
    calculateTotalTokens,
    fileTreeTokenCounts,
    getCurrentFileTreeTokens,
    systemPromptsTokens: totalTokensForSystemPrompt,
    rolePromptsTokens: totalTokensForRolePrompt,
    instructionsTokens: totalTokensForInstructions,

    // Content formatting
    getFormattedContent,
    getFormattedContentWithoutInstructions,
    getFormattedContentFromLatest,

    // Workspace management
    saveWorkspace,
    loadWorkspace,
    saveCurrentWorkspace,
    headerSaveState,

    // Auto-save
    isAutoSaveEnabled: autoSave.isAutoSaveEnabled,
    setAutoSaveEnabled: autoSave.setAutoSaveEnabled,

    // Lazy loading
    loadFileContent,
    loadMultipleFileContents,

    // New additions
    totalTokens,
    totalTokensForSelectedFiles,
    totalTokensForSystemPrompt,
    totalTokensForRolePrompt,
    totalTokensForInstructions,
    folderIndexSize,

    instructions: instructionsState.instructions,
    selectedInstructions,
    onAddInstruction,
    onDeleteInstruction,
    onUpdateInstruction,
    toggleInstructionSelection,
  };
};

export type AppState = ReturnType<typeof useAppState>;

export default useAppState;
