import { useState, useEffect, useCallback } from 'react';
import useLocalStorage from './useLocalStorage';
import useFileSelectionState from './useFileSelectionState';
import usePromptState from './usePromptState';
import useModalState from './useModalState';
import { FileData, FileTreeMode } from '../types/FileTypes';
import { STORAGE_KEYS } from '../constants';
import { estimateTokenCount, calculateFileTreeTokens, getFileTreeModeTokens, calculateSystemPromptsTokens, calculateRolePromptsTokens } from '../utils/tokenUtils';
import { getSelectedFilesContent, getContentWithXmlPrompt } from '../utils/contentFormatter';
import { applyFiltersAndSort, refreshFileTree } from '../handlers/filterHandlers';
import { setupElectronHandlers, openFolderDialog, cancelFileLoading } from '../handlers/electronHandlers';
import { resetFolderState } from '../utils/fileUtils';
import { XML_FORMATTING_INSTRUCTIONS } from '../utils/xmlTemplates';

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
  const [allFiles, setAllFiles] = useState<FileData[]>([]);
  const [displayedFiles, setDisplayedFiles] = useState<FileData[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [appInitialized, setAppInitialized] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({
    status: "idle" as "idle" | "processing" | "complete" | "error",
    message: "",
    processed: 0,
    directories: 0,
    total: 0
  });
  const [isLoadingCancellable, setIsLoadingCancellable] = useState(false);

  // Integration with specialized hooks
  const fileSelection = useFileSelectionState(allFiles);
  const promptState = usePromptState();
  const modalState = useModalState();

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
    setExpandedNodes((prev) => {
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
              directories: 0
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
              message: `Error loading saved folder: ${error instanceof Error ? error.message : "Unknown error"}`
            });
          }
        }, 1000); // 1-second delay
        
        return () => clearTimeout(timer);
      }
    } else {
      // If we already loaded data in this session, mark as initialized
      setAppInitialized(true);
    }
  }, [isElectron, selectedFolder, exclusionPatterns, fileSelection.clearSelectedFiles]);

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
    handleFiltersAndSort
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
  }, [modalState.openFileViewModal]);

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
    getFormattedContentWithXml
  };
};

export default useAppState;