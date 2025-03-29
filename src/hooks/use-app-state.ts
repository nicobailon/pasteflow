import { useState, useEffect, useCallback } from 'react';
import useLocalStorage from './use-local-storage';
import useFileSelectionState from './use-file-selection-state';
import usePromptState from './use-prompt-state';
import useDocState from './use-doc-state';
import useModalState from './use-modal-state';
import { FileData, FileTreeMode, WorkspaceState } from '../types/file-types';
import { STORAGE_KEYS } from '../constants';
import { estimateTokenCount, calculateFileTreeTokens, getFileTreeModeTokens, calculateSystemPromptsTokens, calculateRolePromptsTokens } from '../utils/token-utils';
import { getSelectedFilesContent, getContentWithXmlPrompt } from '../utils/content-formatter';
import { applyFiltersAndSort, refreshFileTree } from '../handlers/filter-handlers';
import { setupElectronHandlers, openFolderDialog, cancelFileLoading } from '../handlers/electron-handlers';
import { resetFolderState } from '../utils/file-utils';
import { XML_FORMATTING_INSTRUCTIONS } from '../utils/xml-templates';

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

  // Non-persistent state
  const [allFiles, setAllFiles] = useState([]);
  const [displayedFiles, setDisplayedFiles] = useState([]);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [appInitialized, setAppInitialized] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({
    status: "idle" as "idle" | "processing" | "complete" | "error",
    message: "",
    processed: 0,
    directories: 0,
    total: 0
  });
  const [isLoadingCancellable, setIsLoadingCancellable] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState(() => {
    // Initialize with the last loaded workspace if it exists
    return localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE) || null;
  });

  // Integration with specialized hooks
  const fileSelection = useFileSelectionState(allFiles);
  const promptState = usePromptState();
  const modalState = useModalState();
  const docState = useDocState();

  // Update instructions token count when user instructions change
  const [userInstructions, setUserInstructions] = useState('');
  const [instructionsTokenCount, setInstructionsTokenCount] = useState(0);

  useEffect(() => {
    setInstructionsTokenCount(estimateTokenCount(userInstructions));
  }, [userInstructions]);

  // Apply filters and sorting to files
  const handleFiltersAndSort = useCallback(
    (files: FileData[], sort: string, filter: string) => {
      return applyFiltersAndSort(files, sort, filter, setDisplayedFiles);
    },
    [setDisplayedFiles]
  );

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

  // Reset folder state
  const handleResetFolderState = useCallback(() => {
    resetFolderState(
      setSelectedFolder,
      setAllFiles,
      fileSelection.setSelectedFiles,
      setProcessingStatus,
      setAppInitialized
    );
  }, [setSelectedFolder, fileSelection.setSelectedFiles]);

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
        setExpandedNodes(JSON.parse(savedExpandedNodes));
      } catch (error) {
        console.error("Error parsing saved expanded nodes:", error);
      }
    }
  }, []);

  // Load initial data from saved folder
  useEffect(() => {
    if (!isElectron) return;
    
    // Use a flag in sessionStorage to ensure we only load data once per session
    const hasLoadedInitialData = sessionStorage.getItem("hasLoadedInitialData");
    
    // If this is the first load in this session, show the welcome screen first
    if (hasLoadedInitialData !== "true") {
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
    } else {
      // If we already loaded data in this session, mark as initialized
      setAppInitialized(true);
    }
  }, [isElectron, selectedFolder, exclusionPatterns, fileSelection, setSelectedFolder]);

  // Set up Electron event handlers
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
        setAppInitialized
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
    sortOrder,
    searchTerm,
    fileSelection.clearSelectedFiles,
    handleFiltersAndSort,
    setSelectedFolder,
    setAllFiles, 
    setProcessingStatus, 
    setIsLoadingCancellable, 
    setAppInitialized
  ]);

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

  const saveWorkspace = (name: string) => {
    console.log("saveWorkspace function called with name:", name);
    
    const workspace: WorkspaceState = {
      fileTreeState: expandedNodes,
      selectedFiles: fileSelection.selectedFiles,
      userInstructions: userInstructions,
      tokenCounts: fileSelection.selectedFiles.reduce((acc, file) => {
        acc[file.path] = file.tokenCount || 0;
        return acc;
      }, {} as { [filePath: string]: number }),
      customPrompts: {
        systemPrompts: promptState.selectedSystemPrompts,
        rolePrompts: promptState.selectedRolePrompts
      }
    };
    
    console.log("Workspace object created:", {
      hasFileTreeState: Object.keys(workspace.fileTreeState || {}).length > 0,
      selectedFilesCount: workspace.selectedFiles.length,
      userInstructionsLength: workspace.userInstructions.length,
      instructionsPreview: workspace.userInstructions.substring(0, 50) + (workspace.userInstructions.length > 50 ? "..." : ""),
    });
    
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    console.log("Existing workspaces object:", { workspaceNames: Object.keys(workspaces) });
    
    workspaces[name] = JSON.stringify(workspace);
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    console.log("Workspace saved to localStorage");
    
    // After saving, immediately set it as current
    setCurrentWorkspace(name);
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
    console.log("Current workspace set to:", name);
    
    // Verify the save by reading it back
    try {
      const savedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      const savedWorkspace = JSON.parse(savedWorkspaces[name] || 'null');
      console.log("Verification - Workspace read back:", {
        exists: !!savedWorkspace,
        userInstructionsMatch: savedWorkspace?.userInstructions === workspace.userInstructions,
        selectedFilesCountMatch: savedWorkspace?.selectedFiles?.length === workspace.selectedFiles.length
      });
    } catch (error) {
      console.error("Error verifying saved workspace:", error);
    }
  };

  const saveCurrentWorkspace = useCallback(() => {
    console.log("saveCurrentWorkspace called", { currentWorkspace });
    
    if (!currentWorkspace) {
      console.warn("No current workspace selected, cannot save.");
      return;
    }

    // Log all data that will be saved
    console.log("About to save workspace data:", {
      workspaceName: currentWorkspace,
      fileTreeState: expandedNodes,
      selectedFiles: fileSelection.selectedFiles,
      userInstructions: userInstructions,
      numOfSelectedFiles: fileSelection.selectedFiles.length,
      hasSystemPrompts: promptState.selectedSystemPrompts.length > 0,
      hasRolePrompts: promptState.selectedRolePrompts.length > 0
    });

    // Reuse the existing saveWorkspace function with the current workspace name
    saveWorkspace(currentWorkspace);
    
    console.log("Workspace saved successfully");
  }, [
    currentWorkspace, 
    expandedNodes, 
    fileSelection.selectedFiles, 
    userInstructions, 
    promptState.selectedSystemPrompts, 
    promptState.selectedRolePrompts,
    saveWorkspace
  ]);

  const loadWorkspace = (name: string) => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    if (!workspaces[name]) {
      console.error(`Workspace "${name}" not found`);
      return;
    }
    const workspace: WorkspaceState = JSON.parse(workspaces[name]);
    
    // Set current workspace name and store in localStorage
    setCurrentWorkspace(name);
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
    
    applyWorkspaceData(workspace);
  };
  
  const applyWorkspaceData = useCallback((workspace: WorkspaceState) => {
    // Validate that selected files exist in the current workspace
    const validFiles = workspace.selectedFiles.filter((file) => {
      const exists = allFiles.some((f: FileData) => f.path === file.path);
      if (!exists) console.warn(`File ${file.path} no longer exists`);
      return exists;
    });
    
    // Restore file tree state
    setExpandedNodes(workspace.fileTreeState || {});
    
    // Restore selected files (only valid ones)
    fileSelection.setSelectedFiles(validFiles);
    
    // Restore user instructions
    setUserInstructions(workspace.userInstructions || '');
    
    // Clear current system prompts and add the saved ones
    // We need to toggle each prompt individually since there's no direct setter exposed
    const currentSystemPrompts = [...promptState.selectedSystemPrompts];
    
    // First, deselect all current system prompts
    currentSystemPrompts.forEach(prompt => {
      promptState.toggleSystemPromptSelection(prompt);
    });
    
    // Then select all the ones from the workspace
    if (workspace.customPrompts?.systemPrompts) {
      workspace.customPrompts.systemPrompts.forEach(prompt => {
        // Find the prompt in the available prompts
        const availablePrompt = promptState.systemPrompts.find(p => p.id === prompt.id);
        if (availablePrompt) {
          promptState.toggleSystemPromptSelection(availablePrompt);
        }
      });
    }
    
    // Do the same for role prompts
    const currentRolePrompts = [...promptState.selectedRolePrompts];
    
    // First, deselect all current role prompts
    currentRolePrompts.forEach(prompt => {
      promptState.toggleRolePromptSelection(prompt);
    });
    
    // Then select all the ones from the workspace
    if (workspace.customPrompts?.rolePrompts) {
      workspace.customPrompts.rolePrompts.forEach(prompt => {
        // Find the prompt in the available prompts
        const availablePrompt = promptState.rolePrompts.find(p => p.id === prompt.id);
        if (availablePrompt) {
          promptState.toggleRolePromptSelection(availablePrompt);
        }
      });
    }
  }, [
    allFiles,
    setExpandedNodes,
    fileSelection,
    setUserInstructions,
    promptState
  ]);
  
  // Listen for workspace loaded events
  useEffect(() => {
    const handleWorkspaceLoaded = (event: CustomEvent) => {
      if (event.detail && event.detail.workspace) {
        setCurrentWorkspace(event.detail.name);
        applyWorkspaceData(event.detail.workspace);
      }
    };
    
    window.addEventListener('workspaceLoaded', handleWorkspaceLoaded as EventListener);
    
    return () => {
      window.removeEventListener('workspaceLoaded', handleWorkspaceLoaded as EventListener);
    };
  }, [allFiles, promptState.systemPrompts, promptState.rolePrompts, applyWorkspaceData]);

  return {
    // Core state
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
    saveCurrentWorkspace
  };
};

export default useAppState;
