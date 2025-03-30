import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';

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

// Define a type for the pending data, excluding the folder which is handled separately
type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

/**
 * Main application state hook
 */
const useAppState = () => {
  // Check if we're running in Electron or browser environment
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

  // Non-persistent state - using type assertions instead of generics
  const allFiles = useState([]) as [FileData[], React.Dispatch<React.SetStateAction<FileData[]>>];
  const displayedFiles = useState([]) as [FileData[], React.Dispatch<React.SetStateAction<FileData[]>>];
  const expandedNodes = useState({}) as [Record<string, boolean>, React.Dispatch<React.SetStateAction<Record<string, boolean>>>];
  const [appInitialized, setAppInitialized] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({
    status: "idle" as "idle" | "processing" | "complete" | "error",
    message: "",
    processed: 0,
    directories: 0,
    total: 0
  });
  const [isLoadingCancellable, setIsLoadingCancellable] = useState(false);
  const [pendingWorkspaceData, setPendingWorkspaceData] = useState(null as PendingWorkspaceData | null); // State to hold deferred workspace data
  const [headerSaveState, setHeaderSaveState] = useState('idle' as 'idle' | 'saving' | 'success'); // State for header save button animation
  const headerSaveTimeoutRef = useRef(null as NodeJS.Timeout | null); // Ref for header save timeout
  // Using destructuring for state variables
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);

  // Integration with specialized hooks
  const fileSelection = useFileSelectionState(allFiles[0]);
  const promptState = usePromptState();
  const modalState = useModalState();
  const docState = useDocState();
  const { saveWorkspace: persistWorkspace, loadWorkspace: loadPersistedWorkspace } = useWorkspaceState();

  // Refs for state values needed in callbacks to avoid unstable dependencies
  const allFilesRef = useRef(allFiles[0]);
  const selectedFolderRef = useRef(selectedFolder);
  const processingStatusRef = useRef(processingStatus);
  const promptStateRef = useRef(promptState); // Ref for the whole prompt state object

  // Update refs whenever state changes
  useEffect(() => { allFilesRef.current = allFiles[0]; }, [allFiles[0]]);
  useEffect(() => { selectedFolderRef.current = selectedFolder; }, [selectedFolder]);
  useEffect(() => { processingStatusRef.current = processingStatus; }, [processingStatus]);
  useEffect(() => { promptStateRef.current = promptState; }, [promptState]);

  // Update instructions token count when user instructions change
  const [userInstructions, setUserInstructions] = useState('');
  const [instructionsTokenCount, setInstructionsTokenCount] = useState(0);

  // Move these functions up so they're defined before they're used
  // Reset folder state - moved up before it's used
  const handleResetFolderState = useCallback(() => {
    resetFolderState(
      setSelectedFolder,
      allFiles[1],
      fileSelection.setSelectedFiles,
      setProcessingStatus,
      setAppInitialized
    );
  }, [setSelectedFolder, allFiles[1], fileSelection.setSelectedFiles, setProcessingStatus, setAppInitialized]); // Depend only on stable setters

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
      return applyFiltersAndSort(files, sort, filter, displayedFiles[1]);
    },
    [displayedFiles]
  );

  useEffect(() => {
    setInstructionsTokenCount(estimateTokenCount(userInstructions));
  }, [userInstructions]);

  // Removed the 'storage' event listener useEffect block as it might conflict 
  // with direct state updates in applyWorkspaceData. Initial state is read
  // directly in useState, and updates on load/delete are handled elsewhere.

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
    console.log('[useAppState] Added workspacesChanged event listener.');

    return () => {
      window.removeEventListener('workspacesChanged', handleWorkspacesChanged as EventListener);
      console.log('[useAppState] Removed workspacesChanged event listener.');
    };
  }, [currentWorkspace, setCurrentWorkspace, handleResetFolderState]);

  // Handle sort change
  const handleSortChange = useCallback((newSort: string) => {
    setSortOrder(newSort);
    handleFiltersAndSort(allFiles[0], newSort, searchTerm);
    setSortDropdownOpen(false); // Close dropdown after selection
  }, [allFiles, searchTerm, setSortOrder, handleFiltersAndSort]);

  // Handle search change
  const handleSearchChange = useCallback((newSearch: string) => {
    setSearchTerm(newSearch);
    handleFiltersAndSort(allFiles[0], sortOrder, newSearch);
  }, [allFiles, sortOrder, setSearchTerm, handleFiltersAndSort]);

  // State for sort dropdown
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Toggle sort dropdown
  const toggleSortDropdown = useCallback(() => {
    setSortDropdownOpen(!sortDropdownOpen);
  }, [sortDropdownOpen]);

  // Calculate token counts for file tree modes
  const fileTreeTokenCounts = useCallback(() => {
    return calculateFileTreeTokens(allFiles[0], fileSelection.selectedFiles, selectedFolder);
  }, [allFiles, fileSelection.selectedFiles, selectedFolder]);

  // Get the token count for the current file tree mode
  const getCurrentFileTreeTokens = useCallback(() => {
    return getFileTreeModeTokens(allFiles[0], fileSelection.selectedFiles, selectedFolder, fileTreeMode);
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
    expandedNodes[1]((prev: Record<string, boolean>) => {
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
  }, [expandedNodes]);

  // Format content for copying
  const getFormattedContent = useCallback(() => {
    return getSelectedFilesContent(
      allFiles[0],
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
      allFiles[0],
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
        expandedNodes[1](JSON.parse(savedExpandedNodes));
      } catch (error) {
        console.error("Error parsing saved expanded nodes:", error);
      }
    }
  }, [expandedNodes[1]]); // Depend only on the stable setter function

  // Load initial data from saved folder
  useEffect(() => {
    if (!isElectron) return;
    
    // Use a flag in sessionStorage to ensure we only load data once per session
    const hasLoadedInitialData = sessionStorage.getItem("hasLoadedInitialData");
    
    // If this is the first load in this session, show the welcome screen first
    if (hasLoadedInitialData === "true") {
      // If we already loaded data in this session, mark as initialized
      setAppInitialized(true);
    } else {
      // Mark the app as not initialized yet
      setAppInitialized(false);
      
      // If we have a selected folder from previous session
      if (selectedFolder) {
        // Give a small delay to allow the welcome screen to appear first
        const timer = setTimeout(() => {
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
        }, 1000); // 1-second delay
        
        return () => clearTimeout(timer);
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
    console.log('[useAppState.saveWorkspace] Preparing to save workspace:', name);

    console.log('  - Capturing expandedNodes:', expandedNodes[0]);
    console.log('  - Capturing selectedFiles count:', fileSelection.selectedFiles.length);
    console.log('  - Capturing userInstructions length:', userInstructions.length);
    console.log('  - Capturing selectedSystemPrompts count:', promptState.selectedSystemPrompts.length);
    console.log('  - Capturing selectedRolePrompts count:', promptState.selectedRolePrompts.length);

    const workspace: WorkspaceState = {
      selectedFolder: selectedFolder,
      fileTreeState: expandedNodes[0],
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

    console.log('[useAppState.saveWorkspace] Workspace object constructed:', {
      hasFileTreeState: !!workspace.fileTreeState && Object.keys(workspace.fileTreeState).length > 0,
      selectedFilesCount: workspace.selectedFiles.length,
      userInstructionsLength: workspace.userInstructions?.length || 0,
      systemPromptsCount: workspace.customPrompts?.systemPrompts?.length || 0,
      rolePromptsCount: workspace.customPrompts?.rolePrompts?.length || 0
    });

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

  // Define applyWorkspaceData first so it can be used by loadWorkspace
  // This function now handles the logic for applying workspace data, potentially deferring parts if the folder changes.
  const applyWorkspaceData = useCallback((workspaceName: string | null, workspaceData: WorkspaceState | null, applyImmediately = false) => {
    if (!workspaceData || !workspaceName) {
      console.warn("[useAppState.applyWorkspaceData] Received null workspace data or name. Cannot apply.", { workspaceName, hasData: !!workspaceData });
      setPendingWorkspaceData(null); // Clear any pending data if null is passed
      // Should we reset currentWorkspace if null is passed explicitly? Maybe not here.
      return;
    }
    console.log(`[useAppState.applyWorkspaceData] Applying workspace "${workspaceName}" data (applyImmediately=${applyImmediately})...`);

    // Access state via refs
    const currentAllFiles = allFilesRef.current;
    const currentSelectedFolder = selectedFolderRef.current;
    const currentProcessingStatus = processingStatusRef.current;
    const currentPromptState = promptStateRef.current;
    const currentHandleResetFolderState = handleResetFolderStateRef.current;

    const workspaceFolder = workspaceData.selectedFolder || null;
    const folderChanged = currentSelectedFolder !== workspaceFolder;
    const isProcessing = currentProcessingStatus.status === 'processing';

    console.log(`  - Workspace folder: "${workspaceFolder}", Current folder: "${currentSelectedFolder}", Folder changed: ${folderChanged}, Is processing: ${isProcessing}`);

    // --- Folder Handling ---
    if (folderChanged && !isProcessing) {
      console.log(`  - Folder changed and not processing. Setting selectedFolder to "${workspaceFolder}".`);
      setSelectedFolder(workspaceFolder); // Trigger folder load

      // If setting to null, reset state immediately
      if (workspaceFolder === null) {
        console.log("  - Workspace folder is null, resetting folder state immediately.");
        currentHandleResetFolderState();
        setPendingWorkspaceData(null); // No pending data needed if resetting
      } else {
        // Defer the rest of the workspace application
        const { selectedFolder: _folder, ...restOfData } = workspaceData;
        console.log("  - Deferring application of remaining workspace data:", Object.keys(restOfData));
        // Store the name along with the pending data if needed, though maybe not necessary as it's set below
        setPendingWorkspaceData(restOfData); 
      }
      // Set the current workspace name immediately even if folder is changing
      console.log(`  - Setting current workspace name state to: "${workspaceName}"`);
      setCurrentWorkspace(workspaceName); 
      return; // Stop execution here, wait for file-list-updated
    } else if (folderChanged && isProcessing) {
      console.warn(`  - Folder changed but currently processing. Cannot change folder to "${workspaceFolder}". Aborting workspace load.`);
      setPendingWorkspaceData(null); // Clear any pending data
      // Optionally alert the user or provide feedback
      return;
    }

    // --- Apply Remaining Data (if folder didn't change or applyImmediately is true) ---
    console.log("  - Applying remaining workspace data (or all data if folder didn't change).");
    
    // Set current workspace name state directly
    console.log(`  - Setting current workspace name state to: "${workspaceName}"`);
    setCurrentWorkspace(workspaceName); 
    
    setPendingWorkspaceData(null); // Clear pending data as we are applying it now

    // Apply expanded nodes
    const fileTreeState = applyImmediately ? pendingWorkspaceData?.fileTreeState : workspaceData.fileTreeState;
    expandedNodes[1](fileTreeState || {});
    console.log(`  - Applied ${Object.keys(fileTreeState || {}).length} expanded nodes.`);
    localStorage.setItem(STORAGE_KEYS.EXPANDED_NODES, JSON.stringify(fileTreeState || {}));

    // Apply selected files (filter against current file list)
    const selectedFilesToApply = applyImmediately ? pendingWorkspaceData?.selectedFiles : workspaceData.selectedFiles;
    const validFiles = (selectedFilesToApply || []).filter((file: FileData) => { // Added FileData type
      const exists = currentAllFiles.some((f: FileData) => f.path === file.path);
      if (!exists) console.warn(`  - [applyWorkspaceData] File ${file.path} from workspace "${workspaceName}" no longer exists in current file list.`);
      return exists;
    });
    fileSelection.setSelectedFiles(validFiles);
    console.log(`  - Applied ${validFiles.length} valid selected files (out of ${selectedFilesToApply?.length || 0}).`);

    // Apply user instructions
    const instructionsToApply = applyImmediately ? pendingWorkspaceData?.userInstructions : workspaceData.userInstructions;
    setUserInstructions(instructionsToApply || '');
    console.log(`  - Applied user instructions (length: ${instructionsToApply?.length || 0}).`);

    // Apply prompts
    const promptsToApply = applyImmediately ? pendingWorkspaceData?.customPrompts : workspaceData.customPrompts;

    // Deselect current prompts first
    [...currentPromptState.selectedSystemPrompts].forEach(prompt => currentPromptState.toggleSystemPromptSelection(prompt));
    [...currentPromptState.selectedRolePrompts].forEach(prompt => currentPromptState.toggleRolePromptSelection(prompt));
    console.log("  - Deselected current prompts.");

    // Apply system prompts from workspace
    if (promptsToApply?.systemPrompts) {
      console.log(`  - Restoring ${promptsToApply.systemPrompts.length} system prompts.`);
      promptsToApply.systemPrompts.forEach((savedPrompt: SystemPrompt) => { // Added SystemPrompt type
        const availablePrompt = currentPromptState.systemPrompts.find((p: SystemPrompt) => p.id === savedPrompt.id);
        if (availablePrompt && !currentPromptState.selectedSystemPrompts.some((p: SystemPrompt) => p.id === availablePrompt.id)) {
          currentPromptState.toggleSystemPromptSelection(availablePrompt);
        } else if (!availablePrompt) {
          console.warn(`  - Saved system prompt ID ${savedPrompt.id} not found.`);
        }
      });
    } else {
      console.log('  - No system prompts in workspace data to apply.');
    }

    // Apply role prompts from workspace
    if (promptsToApply?.rolePrompts) {
      console.log(`  - Restoring ${promptsToApply.rolePrompts.length} role prompts.`);
      promptsToApply.rolePrompts.forEach((savedPrompt: RolePrompt) => { // Added RolePrompt type
        const availablePrompt = currentPromptState.rolePrompts.find((p: RolePrompt) => p.id === savedPrompt.id);
        if (availablePrompt && !currentPromptState.selectedRolePrompts.some((p: RolePrompt) => p.id === availablePrompt.id)) {
          currentPromptState.toggleRolePromptSelection(availablePrompt);
        } else if (!availablePrompt) {
          console.warn(`  - Saved role prompt ID ${savedPrompt.id} not found.`);
        }
      });
    } else {
      console.log('  - No role prompts in workspace data to apply.');
    }

    console.log("[useAppState.applyWorkspaceData] Finished applying workspace data.");

  }, [
      // Keep dependencies stable: setters and assumed-stable setters/functions from hooks.
      // State values accessed via refs.
      expandedNodes[1],
      fileSelection.setSelectedFiles,
      setUserInstructions,
      setSelectedFolder,
      setPendingWorkspaceData, 
      setCurrentWorkspace, // Added setter
      promptState.toggleSystemPromptSelection,
      promptState.toggleRolePromptSelection
  ]);
  
  // Set up Electron event handlers (Moved after applyWorkspaceData definition)
  useEffect(() => {
    if (!isElectron) return;

    let cleanup: () => void = () => {};
    try {
      cleanup = setupElectronHandlers(
        isElectron,
        setSelectedFolder,
        allFiles[1],
        setProcessingStatus,
        fileSelection.clearSelectedFiles,
        handleFiltersAndSort,
        sortOrder,
        searchTerm,
        setIsLoadingCancellable,
        setAppInitialized,
        // --- WORKSPACE ARGS ---
        currentWorkspace,
        setCurrentWorkspace,
        persistWorkspace,
        // --- MORE WORKSPACE ARGS ---
        pendingWorkspaceData,
        applyWorkspaceData, // Pass the updated function
        selectedFolder
        // --- END WORKSPACE ARGS ---
      );
    } catch (error) {
      console.error("Error setting up Electron handlers:", error);
      setProcessingStatus({
        status: "error",
        message: `Error initializing app: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
    
    return cleanup;
    }, [
      isElectron,
      // Only include stable dependencies: setters and functions from hooks
      setSelectedFolder,
      allFiles[1], // The setter function is stable
      setProcessingStatus,
      fileSelection.clearSelectedFiles, // Assumed stable from useFileSelectionState
      setIsLoadingCancellable,
      setAppInitialized,
      setCurrentWorkspace,
      persistWorkspace, // Assumed stable from useWorkspaceState
      // Added new stable dependencies
      pendingWorkspaceData,
      applyWorkspaceData, // Add applyWorkspaceData dependency
      selectedFolder
      // Removed unstable dependencies: sortOrder, searchTerm, handleFiltersAndSort, allFiles[0], currentWorkspace
    ]);

  // Define saveCurrentWorkspace after applyWorkspaceData
  const saveCurrentWorkspace = useCallback(() => {
    console.log('[useAppState.saveCurrentWorkspace] Attempting to save current workspace:', currentWorkspace);
    if (!currentWorkspace) {
      console.warn("[useAppState.saveCurrentWorkspace] No current workspace selected, cannot save.");
      return;
    }
    console.log('[useAppState.saveCurrentWorkspace] Calling internal saveWorkspace function for:', currentWorkspace);
    
    // Clear any existing timeout
    if (headerSaveTimeoutRef.current) {
      clearTimeout(headerSaveTimeoutRef.current);
    }
    
    setHeaderSaveState('saving'); // Set state to saving

    try {
      saveWorkspace(currentWorkspace); // Call the actual save logic
      console.log('[useAppState.saveCurrentWorkspace] Save successful for:', currentWorkspace);
      setHeaderSaveState('success'); // Set state to success

      // Set timeout to revert state
      headerSaveTimeoutRef.current = setTimeout(() => {
        setHeaderSaveState('idle');
        console.log('[useAppState.saveCurrentWorkspace] Save success state finished.');
      }, 1500); // Duration for the checkmark visibility

    } catch (error) {
      console.error(`[useAppState.saveCurrentWorkspace] Error saving workspace "${currentWorkspace}":`, error);
      setHeaderSaveState('idle'); // Revert to idle on error
      // Optionally show an alert or other feedback
      alert(`Failed to save workspace "${currentWorkspace}". Check console for details.`);
    }
  }, [currentWorkspace, saveWorkspace]); // Dependencies: currentWorkspace name and the saveWorkspace function

  // Define loadWorkspace after applyWorkspaceData
  const loadWorkspace = useCallback((name: string) => {
    console.log(`[useAppState.loadWorkspace] Attempting to load and apply workspace: ${name}`);
    const workspaceData = loadPersistedWorkspace(name);
    if (workspaceData) {
        console.log(`[useAppState.loadWorkspace] Workspace data loaded for "${name}", applying...`);
        applyWorkspaceData(name, workspaceData); // Pass name and data
    } else {
        console.error(`[useAppState.loadWorkspace] Failed to load workspace data for "${name}" from persistence layer.`);
    }
  }, [loadPersistedWorkspace, applyWorkspaceData]);

  // Initial workspace loading effect
  useEffect(() => {
    // Check if app is ready and files are loaded (allFiles[0] is the state value)
    if (appInitialized && allFiles[0].length > 0) {
      // Mark that we've initiated workspace handling for this session
      sessionStorage.setItem("hasLoadedInitialWorkspace", "true");
    }
    // Dependencies: appInitialized, allFiles state value
  }, [appInitialized, allFiles[0]]);

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
  }, [applyWorkspaceData]); // Only depend on applyWorkspaceData

  // Workspace loaded event listener effect
  useEffect(() => {
    window.addEventListener('workspaceLoaded', handleWorkspaceLoadedEvent as EventListener);
    console.log("[useAppState] Added workspaceLoaded event listener.");
    return () => {
      window.removeEventListener('workspaceLoaded', handleWorkspaceLoadedEvent as EventListener);
      console.log("[useAppState] Removed workspaceLoaded event listener.");
    };
  }, [handleWorkspaceLoadedEvent]); // Depend on the stable handler callback

  // Create new workspace event listener effect
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
  }, []); // No dependencies needed since we use the ref for handleResetFolderState

  return {
    // Core state
    isElectron,
    selectedFolder,
    allFiles: allFiles[0],
    displayedFiles: displayedFiles[0],
    sortOrder,
    searchTerm,
    fileTreeMode,
    setFileTreeMode,
    expandedNodes: expandedNodes[0],
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
    headerSaveState // Pass down the header save state
  };
};

export default useAppState;
