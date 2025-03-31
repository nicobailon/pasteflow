import { useCallback, useEffect, useRef, useState } from 'react';

import { STORAGE_KEYS } from '../constants';
import { cancelFileLoading, openFolderDialog, setupElectronHandlers } from '../handlers/electron-handlers';
import { applyFiltersAndSort, refreshFileTree } from '../handlers/filter-handlers';
import { FileData, FileTreeMode, RolePrompt, SystemPrompt, WorkspaceState } from '../types/file-types';
import { getContentWithXmlPrompt, getSelectedFilesContent } from '../utils/content-formatter';
import { resetFolderState } from '../utils/file-utils';
import { calculateFileTreeTokens, calculateRolePromptsTokens, calculateSystemPromptsTokens, estimateTokenCount, getFileTreeModeTokens } from '../utils/token-utils';
import { XML_FORMATTING_INSTRUCTIONS } from '../utils/xml-templates';

import useDocState from './use-doc-state';
import useFileSelectionState from './use-file-selection-state';
import useLocalStorage from './use-local-storage';
import useModalState from './use-modal-state';
import usePromptState from './use-prompt-state';
import { useWorkspaceState } from './use-workspace-state';

type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

const useAppState = () => {
  const isElectron = window.electron !== undefined;

  // Core state from localStorage
  const [selectedFolder, setSelectedFolder] = useLocalStorage<string | null>(
    STORAGE_KEYS.SELECTED_FOLDER,
    null
  );
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
  const fileSelection = useFileSelectionState(allFiles);
  const promptState = usePromptState();
  const modalState = useModalState();
  const docState = useDocState();
  const { saveWorkspace: persistWorkspace, loadWorkspace: loadPersistedWorkspace } = useWorkspaceState();

  // Refs for state values needed in callbacks to avoid unstable dependencies
  const allFilesRef = useRef(allFiles);
  const selectedFolderRef = useRef(selectedFolder);
  const processingStatusRef = useRef(processingStatus);
  const promptStateRef = useRef(promptState); // Ref for the whole prompt state object

  // Update refs whenever state changes
  const currentAllFiles = allFiles; // Extract complex expression
  useEffect(() => { allFilesRef.current = currentAllFiles; }, [allFiles, currentAllFiles]); // Add allFiles dependency
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

  // Format content for copying
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

  // Get content with XML prompt
  const getFormattedContentWithXml = useCallback(() => {
    return getContentWithXmlPrompt(
      allFiles,
      fileSelection.selectedFiles,
      sortOrder,
      fileTreeMode,
      selectedFolder,
      promptState.selectedSystemPrompts,
      promptState.selectedRolePrompts,
      userInstructions,
      XML_FORMATTING_INSTRUCTIONS
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

  // Load initial data from saved folder
  useEffect(() => {
    if (!isElectron) return;
    
    // Use a flag in sessionStorage to ensure we only load data once per session
    const hasLoadedInitialData = sessionStorage.getItem("hasLoadedInitialData");
    
    if (hasLoadedInitialData === "true") {
      setAppInitialized(true);
    } else {
      setAppInitialized(false);
      
      if (selectedFolder) {
        try {
          console.log("Loading saved folder on startup:", selectedFolder);
          setProcessingStatus({
            status: "processing",
            message: "Loading files from previously selected folder...",
            processed: 0,
            directories: 0,
            total: 0
          });
          
          // Clear any previously selected files when loading initial data
          fileSelection.clearSelectedFiles();
          
          // Pass exclusion patterns to the main process
          if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.send("request-file-list", selectedFolder, exclusionPatterns || []);
          }
          
          // Mark that we've loaded the initial data
          sessionStorage.setItem("hasLoadedInitialData", "true");
          setAppInitialized(true);
        } catch (error) {
          console.error("Error loading saved folder:", error);
          setProcessingStatus({
            status: "error",
            message: `Error loading saved folder: ${error instanceof Error ? error.message : "Unknown error"}`,
            processed: 0,
            directories: 0,
            total: 0
          });
        }
      }
    }
  }, [isElectron, selectedFolder, exclusionPatterns, fileSelection, setSelectedFolder]);

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

  // Wrap saveWorkspace in useCallback to avoid recreating it on every render
  const saveWorkspace = useCallback((name: string) => {
    const workspace: WorkspaceState = {
      selectedFolder: selectedFolder,
      fileTreeState: expandedNodes,
      selectedFiles: fileSelection.selectedFiles,
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
    userInstructions,
    promptState.selectedSystemPrompts,
    promptState.selectedRolePrompts,
    persistWorkspace
  ]);

  // This function handles applying workspace data, with proper file selection management
  const applyWorkspaceData = useCallback((workspaceName: string | null, workspaceData: WorkspaceState | null, applyImmediately = false) => {
    if (!workspaceData || !workspaceName) {
      console.warn("[useAppState.applyWorkspaceData] Received null workspace data or name. Cannot apply.", { workspaceName, hasData: !!workspaceData });
      setPendingWorkspaceData(null); // Clear any pending data if null is passed
      return;
    }

    // Access state via refs for consistency
    const currentAllFiles = allFilesRef.current;
    const currentSelectedFolder = selectedFolderRef.current;
    const currentProcessingStatus = processingStatusRef.current;
    const currentPromptState = promptStateRef.current;
    const currentHandleResetFolderState = handleResetFolderStateRef.current;

    const workspaceFolder = workspaceData.selectedFolder || null;
    const folderChanged = currentSelectedFolder !== workspaceFolder;
    const isProcessing = currentProcessingStatus.status === 'processing';

    // Always clear selected files first to avoid stale selections
    fileSelection.clearSelectedFiles();

    if (folderChanged && !isProcessing) {
      // Set the current workspace name immediately before folder change
      setCurrentWorkspace(workspaceName);
      
      if (workspaceFolder === null) {
        // Workspace folder is null, resetting folder state immediately
        currentHandleResetFolderState();
        setPendingWorkspaceData(null); // No pending data needed if resetting
      } else {
        // Defer the rest of the workspace application
        // Using destructuring but ignoring the selectedFolder property since we handle it separately
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { selectedFolder: _, ...restOfData } = workspaceData;
        setPendingWorkspaceData(restOfData);
      }
      
      setSelectedFolder(workspaceFolder);
      return; // Stop execution here, wait for file-list-updated
    } else if (folderChanged && isProcessing) {
      console.warn(`  - Folder changed but currently processing. Cannot change folder to "${workspaceFolder}". Aborting workspace load.`);
      setPendingWorkspaceData(null); // Clear any pending data
      return;
    }

    setCurrentWorkspace(workspaceName); 
    
    setPendingWorkspaceData(null); // Clear pending data as we are applying it now

    // Apply expanded nodes
    const fileTreeState = applyImmediately ? pendingWorkspaceData?.fileTreeState : workspaceData.fileTreeState;
    setExpandedNodes(fileTreeState || {});
    localStorage.setItem(STORAGE_KEYS.EXPANDED_NODES, JSON.stringify(fileTreeState || {}));

    // Apply selected files (filter against current file list)
    const selectedFilesToApply = applyImmediately ? pendingWorkspaceData?.selectedFiles : workspaceData.selectedFiles;
    
    // Filter for valid files that exist in the current file list
    const validFiles = (selectedFilesToApply || []).filter((file: FileData) =>
      currentAllFiles.some((f: FileData) => f.path === file.path)
    );
    
    // Apply the valid files to the selection
    if (validFiles.length > 0) {
      fileSelection.setSelectedFiles(validFiles);
    }

    // Apply user instructions
    const instructionsToApply = applyImmediately ? pendingWorkspaceData?.userInstructions : workspaceData.userInstructions;
    setUserInstructions(instructionsToApply || '');

    // Apply prompts
    const promptsToApply = applyImmediately ? pendingWorkspaceData?.customPrompts : workspaceData.customPrompts;

    // Deselect current prompts first
    for (const prompt of currentPromptState.selectedSystemPrompts) currentPromptState.toggleSystemPromptSelection(prompt);
    for (const prompt of currentPromptState.selectedRolePrompts) currentPromptState.toggleRolePromptSelection(prompt);
    console.log("  - Deselected current prompts.");

    if (promptsToApply?.systemPrompts) {
      for (const savedPrompt of promptsToApply.systemPrompts) {
        const availablePrompt = currentPromptState.systemPrompts.find((p: SystemPrompt) => p.id === savedPrompt.id);
        if (availablePrompt && !currentPromptState.selectedSystemPrompts.some((p: SystemPrompt) => p.id === availablePrompt.id)) {
          currentPromptState.toggleSystemPromptSelection(availablePrompt);
        } else if (!availablePrompt) {
          console.warn(`  - Saved system prompt ID ${savedPrompt.id} not found.`);
        }
      }
    } else {
      console.log('  - No system prompts in workspace data to apply.');
    }

    if (promptsToApply?.rolePrompts) {
      for (const savedPrompt of promptsToApply.rolePrompts) {
        const availablePrompt = currentPromptState.rolePrompts.find((p: RolePrompt) => p.id === savedPrompt.id);
        if (availablePrompt && !currentPromptState.selectedRolePrompts.some((p: RolePrompt) => p.id === availablePrompt.id)) {
          currentPromptState.toggleRolePromptSelection(availablePrompt);
        } else if (!availablePrompt) {
          console.warn(`  - Saved role prompt ID ${savedPrompt.id} not found.`);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
      setUserInstructions,
      setSelectedFolder,
      setPendingWorkspaceData,
      setCurrentWorkspace,
      pendingWorkspaceData,
      fileSelection,
      promptState,
      allFiles,
      expandedNodes
  ]);
  
  useEffect(() => {
    if (!isElectron) return;

    let cleanup: () => void = () => {};
    try {
      cleanup = setupElectronHandlers(
        isElectron,
        setSelectedFolder,
        setAllFiles,
        setProcessingStatus,
        fileSelection.clearSelectedFiles,
        handleFiltersAndSort,
        sortOrder,
        searchTerm,
        setIsLoadingCancellable,
        setAppInitialized,
        currentWorkspace,
        setCurrentWorkspace,
        persistWorkspace
      );
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
    
    return cleanup;
    }, [
      isElectron,
      setSelectedFolder,
      setAllFiles,
      setProcessingStatus,
      fileSelection.clearSelectedFiles,
      setIsLoadingCancellable,
      setAppInitialized,
      setCurrentWorkspace,
      persistWorkspace,
      pendingWorkspaceData,
      applyWorkspaceData,
      selectedFolder,
      allFiles,
      currentWorkspace,
      handleFiltersAndSort,
      searchTerm,
      sortOrder
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
    const workspaceData = loadPersistedWorkspace(name);
    
    if (workspaceData) {
        applyWorkspaceData(name, workspaceData);
    } else {
        console.error(`Failed to load workspace data for "${name}"`);
    }
  }, [loadPersistedWorkspace, applyWorkspaceData]);

  // Initial workspace loading effect
  useEffect(() => {
    // Check if app is ready and files are loaded (currentAllFiles is the state value)
    if (appInitialized && currentAllFiles.length > 0) {
      // Mark that we've initiated workspace handling for this session
      sessionStorage.setItem("hasLoadedInitialWorkspace", "true");
    }
  }, [appInitialized, allFiles, currentAllFiles]);

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

  // Effect to apply pending workspace data after allFiles has updated
  useEffect(() => {
    if (pendingWorkspaceData && currentWorkspace && allFiles.length > 0) {
      console.log('[useAppState.applyPendingEffect] Applying pending workspace data now that allFiles is updated.');
      const fullWorkspaceData: WorkspaceState = {
        selectedFolder: selectedFolder,
        ...pendingWorkspaceData
      };
      applyWorkspaceData(currentWorkspace, fullWorkspaceData, true);
    }
  }, [allFiles, pendingWorkspaceData, currentWorkspace, selectedFolder, applyWorkspaceData]);

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
    
    // Calculations
    calculateTotalTokens,
    fileTreeTokenCounts,
    getCurrentFileTreeTokens,
    systemPromptTokens: calculateSystemPromptsTokens(promptState.selectedSystemPrompts),
    rolePromptTokens: calculateRolePromptsTokens(promptState.selectedRolePrompts),
    
    // Content formatting
    getFormattedContent,
    getFormattedContentWithXml,
    
    // Workspace management
    saveWorkspace,
    loadWorkspace,
    saveCurrentWorkspace,
    headerSaveState
  };
};

export default useAppState;
