import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { unstable_batchedUpdates } from 'react-dom';

import { STORAGE_KEYS } from '../constants';
import { cancelFileLoading, openFolderDialog, requestFileContent, setupElectronHandlers } from '../handlers/electron-handlers';
import { applyFiltersAndSort, refreshFileTree } from '../handlers/filter-handlers';
import { electronHandlerSingleton } from '../handlers/electron-handler-singleton';
import { FileData, FileTreeMode, WorkspaceState, SystemPrompt, RolePrompt, Instruction, SelectedFileWithLines } from '../types/file-types';
import { getSelectedFilesContent, getSelectedFilesContentWithoutInstructions } from '../utils/content-formatter';
import { resetFolderState } from '../utils/file-utils';
import { calculateFileTreeTokens, estimateTokenCount, getFileTreeModeTokens } from '../utils/token-utils';
import { enhancedFileContentCache as fileContentCache } from '../utils/enhanced-file-cache';

import useDocState from './use-doc-state';
import useFileSelectionState from './use-file-selection-state';
import useLocalStorage from './use-local-storage';
import useModalState from './use-modal-state';
import usePromptState from './use-prompt-state';
import { useWorkspaceState } from './use-workspace-state';
import { useTokenCounter } from './use-token-counter';

type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

const useAppState = () => {
  const isElectron = window.electron !== undefined;

  // Core state from localStorage
  const [selectedFolder, setSelectedFolder] = useState(null as string | null);
  const [sortOrder, setSortOrder] = useLocalStorage<string>(
    STORAGE_KEYS.SORT_ORDER,
    "tokens-desc"
  );
  const [searchTerm, setSearchTerm] = useLocalStorage<string>(
    STORAGE_KEYS.SEARCH_TERM,
    ""
  );
  const [fileTreeMode, setFileTreeMode] = useLocalStorage<FileTreeMode>(
    STORAGE_KEYS.FILE_TREE_MODE,
    "none"
  );
  const [exclusionPatterns, setExclusionPatterns] = useLocalStorage<string[]>(
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

  // Non-persistent state
  const [allFiles, setAllFiles] = useState([] as FileData[]);
  const [displayedFiles, setDisplayedFiles] = useState([] as FileData[]);
  const [expandedNodes, setExpandedNodes] = useState({} as Record<string, boolean>);
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

  // Integration with specialized hooks
  const fileSelection = useFileSelectionState(allFiles, selectedFolder);
  const promptState = usePromptState();
  const modalState = useModalState();
  const docState = useDocState();
  const { saveWorkspace: persistWorkspace, loadWorkspace: loadPersistedWorkspace, getWorkspaceNames } = useWorkspaceState();
  
  // Extract specific functions from fileSelection to avoid dependency on the whole object
  const clearSelectedFiles = fileSelection.clearSelectedFiles;
  const setSelectionState = fileSelection.setSelectionState;
  const cleanupStaleSelections = fileSelection.cleanupStaleSelections;
  const setSelectedFiles = fileSelection.setSelectedFiles;
  const selectedFiles = fileSelection.selectedFiles;
  const updateSelectedFile = fileSelection.updateSelectedFile;
  const toggleFileSelection = fileSelection.toggleFileSelection;
  
  // Token counter hook - always enabled
  const { countTokens: workerCountTokens, countTokensBatch, isReady: isTokenWorkerReady } = useTokenCounter();

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

  // Update instructions token count when user instructions change
  const [userInstructions, setUserInstructions] = useState('');
  const [instructionsTokenCount, setInstructionsTokenCount] = useState(0);

  const handleResetFolderState = useCallback(() => {
    resetFolderState(
      setSelectedFolder,
      setAllFiles, // Use extracted variable
      fileSelection.setSelectedFiles,
      setProcessingStatus,
      setAppInitialized
    );
  }, [setSelectedFolder, setAllFiles, fileSelection.setSelectedFiles, setProcessingStatus, setAppInitialized]);

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
      console.log('[useAppState.workspacesChangedListener] "workspacesChanged" event received.', event.detail);

      if (event.detail?.deleted === currentWorkspace && event.detail?.wasCurrent) {
         console.log(`[useAppState.workspacesChangedListener] Current workspace "${currentWorkspace}" was deleted. Clearing current workspace state and folder.`);
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

  // Handle token calculations
  const calculateTotalTokens = useCallback(() => {
    return fileSelection.selectedFiles.reduce((total, file) => {
      return total + (file.tokenCount || 0);
    }, 0);
  }, [fileSelection.selectedFiles]);

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
      setProcessingStatus,
      fileSelection.clearSelectedFiles
    );
  }, [isElectron, selectedFolder, exclusionPatterns, fileSelection.clearSelectedFiles]);

  // Toggle expand/collapse state changes
  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodes((prev: Record<string, boolean>) => {
      const currentState = prev[nodeId];
      const newValue = currentState === undefined ? false : !currentState;
      
      const newState = {
        ...prev,
        [nodeId]: newValue,
      };

      // Save to localStorage
      localStorage.setItem(
        STORAGE_KEYS.EXPANDED_NODES,
        JSON.stringify(newState)
      );

      return newState;
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
    userInstructions
  ]);

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
      return { valid: false, reason: 'File not found' };
    }
    
    if (file.isContentLoaded) {
      return { valid: false, reason: 'Already loaded' };
    }
    
    if (selectedFolder && !filePath.startsWith(selectedFolder)) {
      return { valid: false, reason: 'Outside workspace' };
    }
    
    return { valid: true, file };
  }, [selectedFolder]);

  // Helper function to update file loading state
  const updateFileLoadingState = useCallback((filePath: string, isLoading: boolean) => {
    setAllFiles((prev: FileData[]) =>
      prev.map((f: FileData) =>
        f.path === filePath
          ? { ...f, isCountingTokens: isLoading }
          : f
      )
    );
    
    if (isLoading) {
      fileSelection.updateSelectedFile({
        path: filePath,
        isFullFile: true,
        isContentLoaded: false,
        isCountingTokens: true
      });
    }
  }, [setAllFiles, fileSelection]);

  // Helper function to process token counting
  const processFileTokens = useCallback(async (
    content: string,
    filePath: string
  ): Promise<{ tokenCount: number; error?: string }> => {
    try {
      if (isTokenWorkerReady) {
        const tokenCount = await workerCountTokens(content);
        return { tokenCount };
      } else {
        const tokenCount = estimateTokenCount(content);
        return { tokenCount, error: 'Worker not ready, used estimation' };
      }
    } catch (error) {
      console.error(`Token counting failed for ${filePath}:`, error);
      const tokenCount = estimateTokenCount(content);
      return { tokenCount, error: 'Worker failed, used estimation' };
    }
  }, [isTokenWorkerReady, workerCountTokens]);

  // Helper function to update file with content and tokens
  const updateFileWithContent = useCallback((
    filePath: string,
    content: string,
    tokenCount: number,
    tokenCountError?: string
  ) => {
    fileContentCache.set(filePath, content, tokenCount);
    
    setAllFiles((prev: FileData[]) =>
      prev.map((f: FileData) =>
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
      )
    );
    
    fileSelection.updateSelectedFile({
      path: filePath,
      content,
      tokenCount,
      isFullFile: true,
      isContentLoaded: true,
      isCountingTokens: false
    });
  }, [setAllFiles, fileSelection]);

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
    const { tokenCount, error } = await processFileTokens(cached.content, filePath);
    updateFileWithContent(filePath, cached.content, tokenCount, error);
    return true;
  }, [processFileTokens, updateFileWithContent]);

  const loadFileContent = useCallback(async (filePath: string): Promise<void> => {
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
        console.warn(`Skipping file outside current workspace: ${filePath}`);
      }
      return;
    }

    // Mark file as loading
    updateFileLoadingState(filePath, true);

    // Check cache first
    const cached = fileContentCache.get(filePath);
    if (cached) {
      await handleCachedContent(filePath, cached);
      return;
    }

    // Load from backend
    const result = await requestFileContent(filePath);
    if (result.success && result.content !== undefined) {
      // Process tokens and update state
      const { tokenCount, error } = await processFileTokens(result.content, filePath);
      updateFileWithContent(filePath, result.content, tokenCount, error);
    } else {
      // Handle error
      setAllFiles((prev: FileData[]) =>
        prev.map((f: FileData) =>
          f.path === filePath 
            ? { ...f, error: result.error, isContentLoaded: false, isCountingTokens: false } 
            : f
        )
      );
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
    setAllFiles((prev: FileData[]) =>
      prev.map((f: FileData) =>
        filePaths.includes(f.path)
          ? { ...f, isCountingTokens: isLoading }
          : f
      )
    );
  }, [setAllFiles]);

  // Helper function to process batch results
  const processBatchResults = useCallback((
    results: { success: boolean; content?: string; error?: string }[],
    filePaths: string[]
  ) => {
    const successful: { path: string; content: string }[] = [];
    const failed: { path: string; error: string }[] = [];

    for (const [index, result] of results.entries()) {
      const path = filePaths[index];
      if (result.success && result.content) {
        successful.push({ path, content: result.content });
      } else {
        failed.push({ path, error: result.error || 'Failed to load content' });
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
    setAllFiles((prev: FileData[]) =>
      prev.map((f: FileData) => {
        if (!filePaths.includes(f.path)) return f;

        const result = filePathToResult.get(f.path);
        const tokenCount = filePathToTokenCount.get(f.path);

        if (result?.success && result.content !== undefined && tokenCount !== undefined) {
          fileContentCache.set(f.path, result.content, tokenCount);
          fileSelection.updateSelectedFile({
            path: f.path,
            content: result.content,
            tokenCount,
            isFullFile: true,
            isContentLoaded: true,
            isCountingTokens: false
          });

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
      })
    );
  }, [setAllFiles, fileSelection]);

  // Helper function for fallback token counting
  const fallbackTokenCounting = useCallback(async (
    successfulLoads: { path: string; content: string }[]
  ) => {
    for (const { path, content } of successfulLoads) {
      const tokenCount = estimateTokenCount(content);
      fileContentCache.set(path, content, tokenCount);
      
      setAllFiles((prev: FileData[]) =>
        prev.map((f: FileData) =>
          f.path === path
            ? { ...f, content, tokenCount, isContentLoaded: true, isCountingTokens: false }
            : f
        )
      );
    }
  }, [setAllFiles]);

  // Batch load multiple file contents
  const loadMultipleFileContents = useCallback(async (filePaths: string[]): Promise<void> => {
    if (!isTokenWorkerReady) {
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
        const contents = successful.map(item => item.content);
        const tokenCounts = await countTokensBatch(contents);

        const filePathToTokenCount = new Map(
          successful.map((item, index) => [item.path, tokenCounts[index]])
        );

        const filePathToResult = new Map(
          results.map((result, index) => [filePaths[index], result])
        );

        updateFilesWithTokenCounts(filePaths, filePathToResult, filePathToTokenCount);
      } catch (error) {
        console.error('Error in batch token counting:', error);
        await fallbackTokenCounting(successful);
      }
    }

    if (failed.length > 0) {
      setAllFiles((prev: FileData[]) =>
        prev.map((f: FileData) =>
          failed.some(item => item.path === f.path)
            ? { ...f, error: 'Failed to load content', isContentLoaded: false, isCountingTokens: false }
            : f
        )
      );
    }
  }, [
    isTokenWorkerReady, 
    loadFileContent, 
    countTokensBatch, 
    setBatchLoadingState, 
    processBatchResults, 
    updateFilesWithTokenCounts,
    fallbackTokenCounting,
    setAllFiles
  ]);

  // Load expanded nodes state from localStorage
  useEffect(() => {
    const savedExpandedNodes = localStorage.getItem(
      STORAGE_KEYS.EXPANDED_NODES,
    );
    if (savedExpandedNodes) {
      try {
        setExpandedNodes(JSON.parse(savedExpandedNodes)); // Use extracted setter
      } catch (error) {
        console.error("Error parsing saved expanded nodes:", error);
      }
    }
  }, [setExpandedNodes]); // Depend on the stable setter function



  // Set up viewFile event listener
  useEffect(() => {
    const handleViewFileEvent = (event: CustomEvent) => {
      if (event.detail) {
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
  
  // Set up file-list-updated event listener to handle pending workspace data
  useEffect(() => {
    const handleFileListUpdated = () => {
      console.log('[useAppState.fileListUpdatedListener] File list updated event received. Pending data application handled by separate effect.');
    };
    
    // Add event listener
    window.addEventListener('file-list-updated', handleFileListUpdated);
    
    // Cleanup
    return () => {
      window.removeEventListener('file-list-updated', handleFileListUpdated);
    };
  }, [pendingWorkspaceData, currentWorkspace, allFiles, selectedFolder]);

  // Wrap saveWorkspace in useCallback to avoid recreating it on every render
  const saveWorkspace = useCallback((name: string) => {
    const workspace: WorkspaceState = {
      selectedFolder: selectedFolder,
      expandedNodes: expandedNodes,
      selectedFiles: fileSelection.selectedFiles,
      allFiles: allFiles,
      sortOrder: sortOrder,
      searchTerm: searchTerm,
      fileTreeMode: fileTreeMode,
      exclusionPatterns: exclusionPatterns,
      userInstructions: userInstructions,
      tokenCounts: (() => {
        const acc: { [filePath: string]: number } = {};
        for (const file of fileSelection.selectedFiles) {
          acc[file.path] = file.tokenCount || 0;
        }
        return acc;
      })(),
      customPrompts: {
        systemPrompts: promptState.selectedSystemPrompts,
        rolePrompts: promptState.selectedRolePrompts
      }
    };

    persistWorkspace(name, workspace);

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
    persistWorkspace
  ]);

  // Helper functions for workspace data application
  const handleFolderChange = useCallback((workspaceName: string, workspaceFolder: string | null, workspaceData: WorkspaceState) => {
    const callStackTrace = new Error('Stack trace for debugging').stack;
    console.log(`[DEBUG] handleFolderChange called: "${selectedFolderRef.current}" -> "${workspaceFolder}"`);
    console.log(`[DEBUG] handleFolderChange call stack:`, callStackTrace);
    setCurrentWorkspace(workspaceName);
    
    if (workspaceFolder === null) {
      console.log(`[useAppState.handleFolderChange] Resetting folder state`);
      handleResetFolderStateRef.current();
      setPendingWorkspaceData(null);
    } else {
      const { selectedFolder: _selectedFolder, ...restOfData } = workspaceData;
      console.log(`[useAppState.handleFolderChange] Setting pending workspace data:`, restOfData);
      setPendingWorkspaceData(restOfData);
      
      console.log(`[DEBUG] handleFolderChange sending request-file-list for: "${workspaceFolder}"`);
      if (window.electron?.ipcRenderer) {
        setProcessingStatus({
          status: "processing",
          message: `Loading files from workspace folder: ${workspaceFolder}`,
          processed: 0,
          directories: 0,
          total: 0
        });
        window.electron.ipcRenderer.send("request-file-list", workspaceFolder, exclusionPatterns || []);
      }
    }
    
    setSelectedFolder(workspaceFolder);
  }, [exclusionPatterns, setProcessingStatus, setSelectedFolder, setCurrentWorkspace, setPendingWorkspaceData]);

  const applyExpandedNodes = useCallback((expandedNodesFromWorkspace: Record<string, boolean>) => {
    console.log('[useAppState.applyExpandedNodes] Applying:', expandedNodesFromWorkspace);
    setExpandedNodes(expandedNodesFromWorkspace || {});
    localStorage.setItem(STORAGE_KEYS.EXPANDED_NODES, JSON.stringify(expandedNodesFromWorkspace || {}));
  }, [setExpandedNodes]);

  const applySelectedFiles = useCallback((selectedFilesToApply: SelectedFileWithLines[], availableFiles: FileData[]): void => {
    // Clear existing selections
    clearSelectedFiles();
    
    // Deduplicate input files before applying
    const uniqueFiles = [...new Map(selectedFilesToApply.map(file => [file.path, file])).values()];
    
    // Create a map of available files for efficient lookup
    const availableFilesMap = new Map(availableFiles.map(f => [f.path, f]));

    // Filter the saved selections and restore them with proper line selection data
    const filesToSelect = uniqueFiles
      .map(savedFile => {
        const availableFile = availableFilesMap.get(savedFile.path);
        if (!availableFile) return null;
        
        // Restore the saved line selection data
        return {
          ...savedFile,
          // Ensure we have current file content if it's loaded
          content: availableFile.content || savedFile.content,
          isContentLoaded: availableFile.isContentLoaded || savedFile.isContentLoaded
        } as SelectedFileWithLines;
      })
      .filter((file): file is SelectedFileWithLines => !!file);

    if (filesToSelect.length > 0) {
      // Batch state updates
      unstable_batchedUpdates(() => {
        setSelectionState(filesToSelect);
      });
    }
  }, [clearSelectedFiles, setSelectionState]);

  const applyPrompts = useCallback((promptsToApply: { systemPrompts?: SystemPrompt[], rolePrompts?: RolePrompt[] }) => {
    console.log('[useAppState.applyPrompts] Applying prompts (raw):', promptsToApply);
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

  // This function handles applying workspace data, with proper file selection management
  const applyWorkspaceData = useCallback((workspaceName: string | null, workspaceData: WorkspaceState | null) => {
    console.log(`[useAppState.applyWorkspaceData ENTRY] Name: ${workspaceName}, Has Data: ${!!workspaceData}`);
    if (!workspaceData || !workspaceName) {
      console.warn("[useAppState.applyWorkspaceData] Received null workspace data or name. Cannot apply.", { workspaceName, hasData: !!workspaceData });
      setPendingWorkspaceData(null);
      return;
    }

    const currentSelectedFolder = selectedFolderRef.current;
    const currentProcessingStatus = processingStatusRef.current;
    const workspaceFolder = workspaceData.selectedFolder || null;
    const folderChanged = currentSelectedFolder !== workspaceFolder;
    const isProcessing = currentProcessingStatus.status === 'processing';

    // Only clear files if folder is changing - otherwise we'll apply the saved selections
    if (folderChanged) {
      clearSelectedFiles();
    }

    if (folderChanged && !isProcessing) {
      handleFolderChange(workspaceName, workspaceFolder, workspaceData);
      return;
    } else if (folderChanged && isProcessing) {
      console.warn(`[useAppState.applyWorkspaceData] Folder changed but currently processing. Cannot change folder to "${workspaceFolder}". Aborting workspace load.`);
      setPendingWorkspaceData(null);
      return;
    }

    setCurrentWorkspace(workspaceName);
    setPendingWorkspaceData(null);

    console.log(`[useAppState.applyWorkspaceData APPLYING] Applying state for workspace: ${workspaceName}`);
    
    applyExpandedNodes(workspaceData.expandedNodes);
    applySelectedFiles(workspaceData.selectedFiles, allFilesRef.current);
    setUserInstructions(workspaceData.userInstructions || '');
    applyPrompts(workspaceData.customPrompts);
  }, [
    setPendingWorkspaceData,
    setCurrentWorkspace,
    setUserInstructions,
    handleFolderChange,
    applyExpandedNodes,
    applySelectedFiles,
    applyPrompts,
    clearSelectedFiles
  ]);

  // Store refs to get latest values in handlers
  const sortOrderRef = useRef(sortOrder);
  const searchTermRef = useRef(searchTerm);
  const currentWorkspaceRef = useRef(currentWorkspace);
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
    if (!isElectron) return;

    try {
      electronHandlerSingleton.setup(() => {
        console.log('[useAppState.setupElectronHandlers] Setting up Electron handlers');
        
        // Create wrapper functions that use refs to get latest values
        const handleFiltersAndSortWrapper = (files: FileData[], _sort: string, _filter: string) => {
          handleFiltersAndSort(files, sortOrderRef.current, searchTermRef.current);
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
          selectedFolderRef.current
        );
        
        // Dispatch a custom event when handlers are set up
        const event = new CustomEvent('electron-handlers-ready');
        window.dispatchEvent(event);
        console.log('[useAppState.setupElectronHandlers] Handlers ready event dispatched');
        
        return cleanup;
      });
    } catch (error) {
      console.error("Error setting up Electron handlers:", error);
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

  const saveCurrentWorkspace = useCallback(() => {
    console.log('[useAppState.saveCurrentWorkspace] Attempting to save current workspace:', currentWorkspace);
    if (!currentWorkspace) {
      console.warn("[useAppState.saveCurrentWorkspace] No current workspace selected, cannot save.");
      return;
    }
    // Clear any existing timeout
    if (headerSaveTimeoutRef.current) {
      clearTimeout(headerSaveTimeoutRef.current);
    }
    
    setHeaderSaveState('saving'); // Set state to saving

    try {
      saveWorkspace(currentWorkspace);
      setHeaderSaveState('success');

      // Set timeout to revert state
      headerSaveTimeoutRef.current = setTimeout(() => {
        setHeaderSaveState('idle');
        console.log('[useAppState.saveCurrentWorkspace] Save success state finished.');
      }, 1500); // Duration for the checkmark visibility

    } catch (error) {
      console.error(`[useAppState.saveCurrentWorkspace] Error saving workspace "${currentWorkspace}":`, error);
      setHeaderSaveState('idle');
      console.error(`Failed to save workspace "${currentWorkspace}".`);
    }
  }, [currentWorkspace, saveWorkspace]);

  const loadWorkspace = useCallback((name: string) => {
    console.log(`[useAppState.loadWorkspace] Loading workspace: "${name}"`);
    const workspaceData = loadPersistedWorkspace(name);
    
    if (workspaceData) {
        console.log(`[useAppState.loadWorkspace] Workspace data loaded:`, workspaceData);
        // Ensure we have the folder path before applying
        if (workspaceData.selectedFolder) {
            console.log(`[useAppState.loadWorkspace] Workspace has folder: "${workspaceData.selectedFolder}"`);
        } else {
            console.warn(`[useAppState.loadWorkspace] Workspace "${name}" has no folder path`);
        }
        applyWorkspaceData(name, workspaceData);
    } else {
        console.error(`[useAppState.loadWorkspace] Failed to load workspace data for "${name}"`);
    }
  }, [loadPersistedWorkspace, applyWorkspaceData]);

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

  // Define the event handler using useCallback outside the effect
  const handleWorkspaceLoadedEvent = useCallback((event: CustomEvent) => {
    if (event.detail?.name && event.detail?.workspace) {
      console.log(`[useAppState.workspaceLoadedListener] Received 'workspaceLoaded' event for: ${event.detail.name}. Applying data.`);
      // Apply the workspace data, including the name
      applyWorkspaceData(event.detail.name, event.detail.workspace); // Pass name and data
      sessionStorage.setItem("hasLoadedInitialWorkspace", "true"); // Mark that initial load happened
    } else {
      console.warn("[useAppState.workspaceLoadedListener] Received 'workspaceLoaded' event with missing/invalid detail.", event.detail);
    }
  }, [applyWorkspaceData]);

  useEffect(() => {
    window.addEventListener('workspaceLoaded', handleWorkspaceLoadedEvent as EventListener);
    console.log("[useAppState] Added workspaceLoaded event listener.");
    return () => {
      window.removeEventListener('workspaceLoaded', handleWorkspaceLoadedEvent as EventListener);
      console.log("[useAppState] Removed workspaceLoaded event listener.");
    };
  }, [handleWorkspaceLoadedEvent]);

  useEffect(() => {
    console.log('[useAppState.applyPendingEffect] Effect triggered with:', {
      hasPendingData: !!pendingWorkspaceData,
      currentWorkspace,
      filesCount: allFiles.length,
      processingStatus: processingStatus.status,
      selectedFolder
    });
    
    // Wait for file loading to complete before applying workspace data
    if (pendingWorkspaceData && currentWorkspace && allFiles.length > 0 && processingStatus.status === "complete") {
      console.log('[useAppState.applyPendingEffect] Conditions met to apply pending workspace data');
      console.log('[useAppState.applyPendingEffect] pendingWorkspaceData:', pendingWorkspaceData);
      
      const fullWorkspaceData: WorkspaceState = {
        selectedFolder: selectedFolder,
        ...pendingWorkspaceData
      };
      
      console.log('[useAppState.applyPendingEffect TRIGGERED] Applying pending workspace data. Pending data:', pendingWorkspaceData, 'Current selectedFolder:', selectedFolder);
      
      applyWorkspaceData(currentWorkspace, fullWorkspaceData);
    }
  }, [allFiles.length, pendingWorkspaceData, currentWorkspace, selectedFolder, processingStatus.status, applyWorkspaceData]);

  useEffect(() => {
    const handleCreateNewWorkspaceEvent = () => {
      console.log("[useAppState] Received 'createNewWorkspace' event. Clearing current workspace.");
      setCurrentWorkspace(null);
      handleResetFolderStateRef.current();
    };

    window.addEventListener('createNewWorkspace', handleCreateNewWorkspaceEvent as EventListener);
    console.log("[useAppState] Added createNewWorkspace event listener.");
    
    return () => {
      window.removeEventListener('createNewWorkspace', handleCreateNewWorkspaceEvent as EventListener);
      console.log("[useAppState] Removed createNewWorkspace event listener.");
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

  const totalTokens = useMemo(() => {
    return totalTokensForSelectedFiles + totalTokensForSystemPrompt + totalTokensForRolePrompt;
  }, [totalTokensForSelectedFiles, totalTokensForSystemPrompt, totalTokensForRolePrompt]);

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


  const [instructions, setInstructions] = useState(() => [] as Instruction[]);
  const [selectedInstructions, setSelectedInstructions] = useState(() => [] as Instruction[]);

  const onAddInstruction = useCallback((instruction: Instruction) => {
    setInstructions((prev: Instruction[]) => [...prev, instruction]);
  }, []);

  const onDeleteInstruction = useCallback((id: string) => {
    setInstructions((prev: Instruction[]) => prev.filter(instruction => instruction.id !== id));
    setSelectedInstructions((prev: Instruction[]) => prev.filter(instruction => instruction.id !== id));
  }, []);

  const onUpdateInstruction = useCallback((instruction: Instruction) => {
    setInstructions((prev: Instruction[]) => prev.map(i => i.id === instruction.id ? instruction : i));
    setSelectedInstructions((prev: Instruction[]) => prev.map(i => i.id === instruction.id ? instruction : i));
  }, []);

  const toggleInstructionSelection = useCallback((instruction: Instruction) => {
    setSelectedInstructions((prev: Instruction[]) => {
      const isSelected = prev.some(i => i.id === instruction.id);
      return isSelected ? prev.filter(i => i.id !== instruction.id) : [...prev, instruction];
    });
  }, []);

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
    handleSearchChange,
    toggleSortDropdown,
    setUserInstructions,
    toggleExpanded,
    handleRefreshFileTree,
    handleResetFolderState,
    handleFileOperations,
    handleWorkspaceUpdate,
    
    // Calculations
    calculateTotalTokens,
    fileTreeTokenCounts,
    getCurrentFileTreeTokens,
    systemPromptsTokens: totalTokensForSystemPrompt,
    rolePromptsTokens: totalTokensForRolePrompt,
    
    // Content formatting
    getFormattedContent,
    getFormattedContentWithoutInstructions,
    
    // Workspace management
    saveWorkspace,
    loadWorkspace,
    saveCurrentWorkspace,
    headerSaveState,

    // Lazy loading
    loadFileContent,
    loadMultipleFileContents,

    // New additions
    totalTokens,
    totalTokensForSelectedFiles,
    totalTokensForSystemPrompt,
    totalTokensForRolePrompt,

    instructions,
    selectedInstructions,
    onAddInstruction,
    onDeleteInstruction,
    onUpdateInstruction,
    toggleInstructionSelection,
  };
};

export type AppState = ReturnType<typeof useAppState>;

export default useAppState;