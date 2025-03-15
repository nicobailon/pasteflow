import React, { useState, useEffect, useCallback } from "react";
import useLocalStorage from "./hooks/useLocalStorage";
import Sidebar from "./components/Sidebar";
import FileList from "./components/FileList";
import CopyButton from "./components/CopyButton";
import { FileData, FileTreeMode } from "./types/FileTypes";
import { ThemeProvider } from "./context/ThemeContext";
import ThemeToggle from "./components/ThemeToggle";
import FileTreeToggle from "./components/FileTreeToggle";
import { ApplyChangesModal } from "./components/ApplyChangesModal";
import FilterModal from "./components/FilterModal";
import { FolderOpen, Folder } from "lucide-react";
import { generateAsciiFileTree, getAllDirectories } from "./utils/pathUtils";
import { XML_FORMATTING_INSTRUCTIONS } from "./utils/xmlTemplates";

// Access the electron API from the window object
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, func: (...args: any[]) => void) => void;
        removeListener: (
          channel: string,
          func: (...args: any[]) => void,
        ) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
      };
    };
  }
}

// Keys for localStorage
const STORAGE_KEYS = {
  SELECTED_FOLDER: "pasteflow-selected-folder",
  SELECTED_FILES: "pasteflow-selected-files",
  SORT_ORDER: "pasteflow-sort-order",
  FILE_TREE_SORT_ORDER: "pasteflow-file-tree-sort-order",
  SEARCH_TERM: "pasteflow-search-term",
  EXPANDED_NODES: "pasteflow-expanded-nodes",
  FILE_TREE_MODE: "pasteflow-file-tree-mode",
};

const App = () => {
  // Use custom useLocalStorage hook for persisted state
  const [selectedFolder, setSelectedFolder] = useLocalStorage<string | null>(
    STORAGE_KEYS.SELECTED_FOLDER,
    null
  );
  const [selectedFiles, setSelectedFiles] = useLocalStorage<string[]>(
    STORAGE_KEYS.SELECTED_FILES,
    []
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
  
  // State that doesn't need localStorage persistence
  const [allFiles, setAllFiles] = useState([] as FileData[]);
  const [expandedNodes, setExpandedNodes] = useState({} as Record<string, boolean>);
  const [displayedFiles, setDisplayedFiles] = useState([] as FileData[]);
  const [appInitialized, setAppInitialized] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({
    status: "idle",
    message: "",
    processed: 0,
    directories: 0,
    total: 0
  } as {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
    processed?: number;
    directories?: number;
    total?: number;
  });
  
  // State for modals
  const [showApplyChangesModal, setShowApplyChangesModal] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
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

  // State for sort dropdown
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Check if we're running in Electron or browser environment
  const isElectron = window.electron !== undefined;

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
          console.log("Loading saved folder on startup:", selectedFolder);
          setProcessingStatus({
            status: "processing",
            message: "Loading files from previously selected folder...",
            processed: 0,
            directories: 0
          });
          
          // Clear any previously selected files when loading initial data
          setSelectedFiles([]);
          
          // Pass exclusion patterns to the main process
          window.electron.ipcRenderer.send("request-file-list", selectedFolder, exclusionPatterns);
          
          // Mark that we've loaded the initial data
          sessionStorage.setItem("hasLoadedInitialData", "true");
          setAppInitialized(true);
        }, 1000); // 1-second delay
        
        return () => clearTimeout(timer);
      }
    } else {
      // If we already loaded data in this session, mark as initialized
      setAppInitialized(true);
    }
  }, [isElectron, selectedFolder, exclusionPatterns, setSelectedFiles]);
  


  // Apply filters and sorting to files
  const applyFiltersAndSort = useCallback(
    (files: FileData[], sort: string, filter: string) => {
      let filtered = files;

      // Apply filter
      if (filter) {
        const searchLower = filter.toLowerCase();
        filtered = files.filter(
          (file) =>
            file.path.toLowerCase().includes(searchLower) ||
            file.name.toLowerCase().includes(searchLower),
        );
      }

      // Apply sort
      switch (sort) {
        case "name-asc":
          filtered.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case "name-desc":
          filtered.sort((a, b) => b.name.localeCompare(a.name));
          break;
        case "tokens-asc":
          filtered.sort((a, b) => (a.tokenCount || 0) - (b.tokenCount || 0));
          break;
        case "tokens-desc":
          filtered.sort((a, b) => (b.tokenCount || 0) - (a.tokenCount || 0));
          break;
        default:
          // No sorting
          break;
      }

      // Update displayed files
      setDisplayedFiles(filtered);
      
      return filtered;
    },
    [setDisplayedFiles],
  );

  // Set up event listeners for Electron IPC
  useEffect(() => {
    if (!isElectron) return;

    const handleFolderSelected = (folderPath: string) => {
      if (typeof folderPath === "string") {
        console.log("Folder selected:", folderPath);
        setSelectedFolder(folderPath);
        // Clear any previously selected files
        setSelectedFiles([]);
        // No longer resetting the sort order - will use the saved preference
        // The initial default is already set by useLocalStorage
        setProcessingStatus({
          status: "processing",
          message: "Requesting file list...",
          processed: 0,
          directories: 0
        });
        window.electron.ipcRenderer.send("request-file-list", folderPath, exclusionPatterns);
      } else {
        console.error("Invalid folder path received:", folderPath);
        setProcessingStatus({
          status: "error",
          message: "Invalid folder path received",
        });
      }
    };

    const handleFileListData = (files: FileData[]) => {
      console.log("Received file list data:", files.length, "files");
      setAllFiles(files);
      setProcessingStatus({
        status: "complete",
        message: `Loaded ${files.length} files`,
        processed: files.length,
        total: files.length
      });

      // Apply filters and sort to the new files
      applyFiltersAndSort(files, sortOrder, searchTerm);

      // No files selected by default - user must explicitly select files
      setSelectedFiles([]);
      
      // Ensure the app is marked as initialized when files are loaded
      setAppInitialized(true);
      sessionStorage.setItem("hasLoadedInitialData", "true");
    };

    const handleProcessingStatus = (status: {
      status: "idle" | "processing" | "complete" | "error";
      message: string;
      processed?: number;
      directories?: number;
      total?: number;
    }) => {
      console.log("Processing status:", status);
      setProcessingStatus(status);
      
      // If processing is complete or error, mark as not cancellable
      if (status.status === "complete" || status.status === "error") {
        setIsLoadingCancellable(false);
      } else if (status.status === "processing") {
        setIsLoadingCancellable(true);
      }
    };

    window.electron.ipcRenderer.on("folder-selected", handleFolderSelected);
    window.electron.ipcRenderer.on("file-list-data", handleFileListData);
    window.electron.ipcRenderer.on(
      "file-processing-status",
      handleProcessingStatus,
    );

    return () => {
      window.electron.ipcRenderer.removeListener(
        "folder-selected",
        handleFolderSelected,
      );
      window.electron.ipcRenderer.removeListener(
        "file-list-data",
        handleFileListData,
      );
      window.electron.ipcRenderer.removeListener(
        "file-processing-status",
        handleProcessingStatus,
      );
    };
  }, [isElectron, sortOrder, searchTerm, exclusionPatterns, setSelectedFiles, setSelectedFolder, applyFiltersAndSort]);

  const openFolder = useCallback(() => {
    if (isElectron) {
      console.log("Opening folder dialog");
      setProcessingStatus({ status: "idle", message: "Select a folder..." });
      window.electron.ipcRenderer.send("open-folder");
      
      // Mark the app as initialized once a folder is selected
      sessionStorage.setItem("hasLoadedInitialData", "true");
      setAppInitialized(true);
    } else {
      console.warn("Folder selection not available in browser");
    }
  }, [isElectron]);

  // Function to reset the app to its blank starting state
  const resetFolderState = useCallback(() => {
    console.log("Resetting folder state to blank starting state");
    setSelectedFolder(null);
    setAllFiles([]);
    setSelectedFiles([]);
    setProcessingStatus({ status: "idle", message: "" });
    setAppInitialized(false);
    
    // Clear the session flag to ensure welcome screen appears next time
    sessionStorage.removeItem("hasLoadedInitialData");
    
    // No need to manually clear localStorage entries - handled by useLocalStorage
  }, [setSelectedFolder, setSelectedFiles]);

  // Toggle file selection
  const toggleFileSelection = useCallback((filePath: string) => {
    setSelectedFiles((prev: string[]) => {
      if (prev.includes(filePath)) {
        return prev.filter((path: string) => path !== filePath);
      } else {
        return [...prev, filePath];
      }
    });
  }, [setSelectedFiles]);

  // Toggle folder selection (select/deselect all files in folder)
  const toggleFolderSelection = useCallback((folderPath: string, isSelected: boolean) => {
    const filesInFolder = allFiles.filter(
      (file: FileData) =>
        file.path.startsWith(folderPath) && !file.isBinary && !file.isSkipped,
    );

    if (isSelected) {
      // Add all files from this folder that aren't already selected
      const filePaths = filesInFolder.map((file: FileData) => file.path);
      
      setSelectedFiles((prev: string[]) => {
        // Convert to Set for faster lookups and deduplication
        const newSelectionSet = new Set(prev);
        
        // Add all paths from the folder
        filePaths.forEach((path: string) => {
          newSelectionSet.add(path);
        });
        
        // Convert back to array for state update
        return Array.from(newSelectionSet);
      });
    } else {
      // Remove all files from this folder
      setSelectedFiles((prev: string[]) => {
        // Create a Set of paths to remove for faster lookups
        const folderPathsSet = new Set(filesInFolder.map((file: FileData) => file.path));
        
        // Keep only paths that are not in the folder
        return prev.filter(path => !folderPathsSet.has(path));
      });
    }
  }, [allFiles, setSelectedFiles]);

  // Handle sort change
  const handleSortChange = useCallback((newSort: string) => {
    setSortOrder(newSort);
    applyFiltersAndSort(allFiles, newSort, searchTerm);
    setSortDropdownOpen(false); // Close dropdown after selection
  }, [allFiles, searchTerm, setSortOrder, applyFiltersAndSort]);

  // Handle search change
  const handleSearchChange = useCallback((newSearch: string) => {
    setSearchTerm(newSearch);
    applyFiltersAndSort(allFiles, sortOrder, newSearch);
  }, [allFiles, sortOrder, setSearchTerm, applyFiltersAndSort]);

  // Refresh file tree with current filters
  const refreshFileTree = useCallback(() => {
    if (isElectron && selectedFolder) {
      console.log("Refreshing file tree with filters:", exclusionPatterns);
      setProcessingStatus({
        status: "processing",
        message: "Refreshing file list...",
      });
      
      // Clear selected files to avoid issues with files that might be filtered out
      setSelectedFiles([]);
      
      // Request file list with current exclusion patterns
      window.electron.ipcRenderer.send("request-file-list", selectedFolder, exclusionPatterns);
    }
  }, [isElectron, selectedFolder, exclusionPatterns, setSelectedFiles]);

  /**
   * Toggles the visibility of the sort options dropdown.
   * Inverts the current state of the sortDropdownOpen state variable.
   */
  const toggleSortDropdown = () => {
    setSortDropdownOpen(!sortDropdownOpen);
  };

  /**
   * Calculates the total token count for all selected files.
   * 
   * @returns {number} The sum of token counts from all selected files.
   */
  const calculateTotalTokens = () => {
    return selectedFiles.reduce((total: number, path: string) => {
      const file = allFiles.find((f: FileData) => f.path === path);
      return total + (file ? file.tokenCount : 0);
    }, 0);
  };

  /**
   * Estimates token count for a given text.
   * Uses a simple estimation based on character count.
   * 
   * @param {string} text - The text to estimate tokens for
   * @returns {number} Estimated token count
   */
  const estimateTokenCount = (text: string) => {
    // Simple estimation: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  };

  // Update instructions token count when user instructions change
  const [userInstructions, setUserInstructions] = useState('');
  const [instructionsTokenCount, setInstructionsTokenCount] = useState(0);

  useEffect(() => {
    setInstructionsTokenCount(estimateTokenCount(userInstructions));
  }, [userInstructions]);

  /**
   * Calculate token counts for each file tree mode
   * @returns {Record<FileTreeMode, number>} Token counts for each file tree mode
   */
  const calculateFileTreeTokens = useCallback(() => {
    const tokenCounts: Record<FileTreeMode, number> = {
      "none": 0,
      "selected": 0,
      "selected-with-roots": 0, 
      "complete": 0
    };
    
    if (!selectedFolder) return tokenCounts;
    
    // Create a Set for faster lookups
    const selectedFilesSet = new Set(selectedFiles);
    
    // Pre-calculate commonly used filtered arrays
    const selectedFileItems = allFiles
      .filter((file: FileData) => selectedFilesSet.has(file.path))
      .map((file: FileData) => ({ path: file.path, isFile: true }));
    
    // Calculate token counts for "selected" mode
    if (selectedFileItems.length > 0) {
      const selectedAsciiTree = generateAsciiFileTree(selectedFileItems, selectedFolder);
      const selectedTreeContent = `<file_map>\n${selectedFolder}\n${selectedAsciiTree}\n</file_map>\n\n`;
      tokenCounts["selected"] = estimateTokenCount(selectedTreeContent);
    }
    
    // Calculate token counts for "selected-with-roots" mode
    if (selectedFileItems.length > 0) {
      // Filter non-skipped files only once
      const nonSkippedFiles = allFiles.filter((file: FileData) => !file.isSkipped);
      const allDirs = getAllDirectories(nonSkippedFiles, selectedFolder);
      
      const fileTreeItems = [
        ...allDirs.map(dir => ({ path: dir, isFile: false })),
        ...selectedFileItems
      ];
      
      const asciiTree = generateAsciiFileTree(fileTreeItems, selectedFolder);
      const treeContent = `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
      tokenCounts["selected-with-roots"] = estimateTokenCount(treeContent);
    }
    
    // Calculate token counts for "complete" mode
    const nonSkippedFiles = allFiles.filter((file: FileData) => !file.isSkipped);
    if (nonSkippedFiles.length > 0) {
      const completeFileItems = nonSkippedFiles.map((file: FileData) => ({ path: file.path, isFile: true }));
      const asciiTree = generateAsciiFileTree(completeFileItems, selectedFolder);
      const treeContent = `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
      tokenCounts["complete"] = estimateTokenCount(treeContent);
    }
    
    return tokenCounts;
  }, [selectedFolder, allFiles, selectedFiles]);

  /**
   * Get the token count for the current file tree mode
   * @returns {number} Token count for current file tree mode
   */
  const getCurrentFileTreeTokens = useCallback(() => {
    const tokenCounts = calculateFileTreeTokens();
    return tokenCounts[fileTreeMode];
  }, [calculateFileTreeTokens, fileTreeMode]);

  /**
   * Generates a formatted string containing all selected files' contents without user instructions.
   * The function organizes files according to the current sort order and includes an ASCII file tree
   * representation based on the fileTreeMode setting.
   * 
   * @returns {string} A formatted string with selected files' content wrapped in codebase tags.
   */
  const getSelectedFilesContentWithoutInstructions = () => {
    // Create a Set from selectedFiles for faster lookups
    const selectedFilesSet = new Set(selectedFiles);
    
    // Sort selected files according to current sort order
    const [sortKey, sortDir] = sortOrder.split("-");
    const sortedSelected = allFiles
      .filter((file: FileData) => selectedFilesSet.has(file.path))
      .sort((a: FileData, b: FileData) => {
        let comparison = 0;

        if (sortKey === "name") {
          comparison = a.name.localeCompare(b.name);
        } else if (sortKey === "tokens") {
          comparison = a.tokenCount - b.tokenCount;
        } else if (sortKey === "size") {
          comparison = a.size - b.size;
        }

        return sortDir === "asc" ? comparison : -comparison;
      });

    if (sortedSelected.length === 0) {
      return "No files selected.";
    }

    // Start with opening file_contents tag
    let concatenatedString = "<codebase>\n";
    
    // Add ASCII file tree if enabled
    if (fileTreeMode !== "none" && selectedFolder) {
      let fileTreeItems: { path: string; isFile?: boolean }[] = [];

      if (fileTreeMode === "selected") {
        // Only include selected files
        fileTreeItems = sortedSelected.map((file: FileData) => ({ path: file.path, isFile: true }));
      } else if (fileTreeMode === "selected-with-roots") {
        // Include all directories and selected files to show the complete folder structure
        // Filter out skipped files when getting directories
        const filteredFiles = allFiles.filter((file: FileData) => !file.isSkipped);
        const allDirs = getAllDirectories(filteredFiles, selectedFolder);
        fileTreeItems = [
          ...allDirs.map(dir => ({ path: dir, isFile: false })),
          ...sortedSelected.map((file: FileData) => ({ path: file.path, isFile: true }))
        ];
      } else if (fileTreeMode === "complete") {
        // Include all non-skipped files
        fileTreeItems = allFiles
          .filter((file: FileData) => !file.isSkipped)
          .map((file: FileData) => ({ path: file.path, isFile: true }));
      }

      const asciiTree = generateAsciiFileTree(fileTreeItems, selectedFolder);
      concatenatedString += `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
    }
    
    sortedSelected.forEach((file: FileData) => {
      // Calculate the relative path from the selected folder
      const normalizedFilePath = file.path.replace(/\\/g, "/");
      const normalizedRootPath = selectedFolder ? selectedFolder.replace(/\\/g, "/").replace(/\/$/, "") : "";
      
      // Get the path relative to the project root
      let relativePath = file.path;
      if (normalizedRootPath && normalizedFilePath.startsWith(normalizedRootPath + "/")) {
        relativePath = normalizedFilePath.substring(normalizedRootPath.length + 1);
      }
      
      // Determine the file extension for the code block language
      const extension = file.path.split('.').pop() || '';
      
      // Map file extensions to appropriate language identifiers for code blocks
      let languageIdentifier = extension;
      // Web development languages
      if (extension === 'js') languageIdentifier = 'javascript';
      else if (extension === 'ts') languageIdentifier = 'typescript';
      else if (extension === 'tsx') languageIdentifier = 'tsx';
      else if (extension === 'jsx') languageIdentifier = 'jsx';
      else if (extension === 'css') languageIdentifier = 'css';
      else if (extension === 'scss' || extension === 'sass') languageIdentifier = 'scss';
      else if (extension === 'less') languageIdentifier = 'less';
      else if (extension === 'html') languageIdentifier = 'html';
      else if (extension === 'json') languageIdentifier = 'json';
      else if (extension === 'md') languageIdentifier = 'markdown';
      else if (extension === 'xml') languageIdentifier = 'xml';
      else if (extension === 'svg') languageIdentifier = 'svg';
      
      // Backend languages
      else if (extension === 'py') languageIdentifier = 'python';
      else if (extension === 'rb') languageIdentifier = 'ruby';
      else if (extension === 'php') languageIdentifier = 'php';
      else if (extension === 'java') languageIdentifier = 'java';
      else if (extension === 'cs') languageIdentifier = 'csharp';
      else if (extension === 'go') languageIdentifier = 'go';
      else if (extension === 'rs') languageIdentifier = 'rust';
      else if (extension === 'swift') languageIdentifier = 'swift';
      else if (extension === 'kt' || extension === 'kts') languageIdentifier = 'kotlin';
      else if (extension === 'c' || extension === 'h') languageIdentifier = 'c';
      else if (extension === 'cpp' || extension === 'cc' || extension === 'cxx' || extension === 'hpp') languageIdentifier = 'cpp';
      
      // Shell and configuration
      else if (extension === 'sh' || extension === 'bash') languageIdentifier = 'bash';
      else if (extension === 'ps1') languageIdentifier = 'powershell';
      else if (extension === 'bat' || extension === 'cmd') languageIdentifier = 'batch';
      else if (extension === 'yaml' || extension === 'yml') languageIdentifier = 'yaml';
      else if (extension === 'toml') languageIdentifier = 'toml';
      else if (extension === 'ini') languageIdentifier = 'ini';
      else if (extension === 'dockerfile' || file.path.toLowerCase().endsWith('dockerfile')) languageIdentifier = 'dockerfile';
      
      // Database
      else if (extension === 'sql') languageIdentifier = 'sql';
      
      // Fallback to plaintext if no matching language is found
      else if (!languageIdentifier) languageIdentifier = 'plaintext';
      
      // Add file content with file header and code block
      concatenatedString += `\nFile: ${relativePath}\n\`\`\`${languageIdentifier}\n${file.content}\n\`\`\`\n`;
    });
    
    // Close file_contents tag
    concatenatedString += "</codebase>";
    
    return concatenatedString;
  };

  /**
   * Generates a formatted string containing selected files' content with optional user instructions.
   * This function extends getSelectedFilesContentWithoutInstructions by adding any user-provided 
   * instructions from the textarea input.
   * 
   * @returns {string} A formatted string with selected files' content and optional user instructions.
   */
  const getSelectedFilesContent = () => {
    // Get the base content
    const baseContent = getSelectedFilesContentWithoutInstructions();
    
    // Get user instructions from the input field
    const userInstructionsElement = document.querySelector('.user-instructions-input') as HTMLTextAreaElement;
    const userInstructions = userInstructionsElement?.value?.trim();
    
    // Append user instructions if they exist
    if (userInstructions) {
      return `${baseContent}\n\n<user_instructions>\n${userInstructions}\n</user_instructions>`;
    }
    
    return baseContent;
  };

  // Handle select all files
  const selectAllFiles = useCallback(() => {
    const selectablePaths = displayedFiles
      .filter((file: FileData) => !file.isBinary && !file.isSkipped)
      .map((file: FileData) => file.path);

    setSelectedFiles((prev: string[]) => {
      // Convert previous selections to a Set for faster lookups
      const prevSet = new Set(prev);
      
      // Add each new path if not already in the set
      selectablePaths.forEach((path: string) => {
        prevSet.add(path);
      });
      
      // Convert back to array for state update
      return Array.from(prevSet);
    });
  }, [displayedFiles, setSelectedFiles]);

  // Handle deselect all files
  const deselectAllFiles = useCallback(() => {
    // Convert displayed paths to a Set for faster lookups
    const displayedPathsSet = new Set(displayedFiles.map((file: FileData) => file.path));
    
    setSelectedFiles((prev: string[]) =>
      prev.filter((path: string) => !displayedPathsSet.has(path))
    );
  }, [displayedFiles, setSelectedFiles]);

  // Sort options for the dropdown
  const sortOptions = [
    { value: "tokens-desc", label: "Tokens: High to Low" },
    { value: "tokens-asc", label: "Tokens: Low to High" },
    { value: "name-asc", label: "Name: A to Z" },
    { value: "name-desc", label: "Name: Z to A" },
  ];

  // Handle expand/collapse state changes
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
        JSON.stringify(newState),
      );

      return newState;
    });
  }, []);

  /**
   * Extracts the folder/file name from a full path.
   * 
   * @param {string} path - The full path to extract the name from
   * @returns {string} The last segment of the path (the folder or file name)
   */
  const getFolderNameFromPath = (path: string) => {
    if (!path) return "";
    // Split the path by the separator and get the last part
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1];
  };

  /**
   * Saves the exclusion patterns to local storage and updates the state.
   * Optionally refreshes the file list to apply the new filters.
   *
   * @param {string[]} patterns - Array of exclusion patterns to save
   * @param {boolean} refreshFiles - Whether to refresh the file list after saving
   */
  const saveFilters = useCallback((patterns: string[], refreshFiles: boolean = true) => {
    setExclusionPatterns(patterns);
    
    if (refreshFiles && selectedFolder && isElectron) {
      setProcessingStatus({
        status: "processing",
        message: "Refreshing file list with new filters...",
      });
      
      // Request file list with updated exclusion patterns
      window.electron.ipcRenderer.send("request-file-list", selectedFolder, patterns);
    }
  }, [selectedFolder, isElectron, setExclusionPatterns]);

  // Toggle filter modal visibility
  const toggleFilterModal = useCallback(() => {
    setFilterModalOpen((prevState: boolean) => !prevState);
  }, []);

  // Handler for file tree sort order change
  const handleFileTreeSortChange = useCallback((sortOrder: string) => {
    console.log("File tree sort order changed to:", sortOrder);
    setSortDropdownOpen(false);
  }, []);

  // Add state to track if file loading can be canceled
  const [isLoadingCancellable, setIsLoadingCancellable] = useState(false);
  
  // Add function to cancel file loading process
  const handleCancelLoading = useCallback(() => {
    window.electron.ipcRenderer.send("cancel-file-loading");
    setProcessingStatus({
      status: "idle",
      message: "File loading cancelled",
    });
    setIsLoadingCancellable(false);
  }, []);

  return (
    <ThemeProvider>
      <div className="app-container">
        <header className="header">
          <div className="header-actions">
            <div className="folder-info">
              <h1 className="app-title">
                {selectedFolder && 
                  <span className="folder-name"> <Folder className="folder-icon-app-title" size={24} /> {getFolderNameFromPath(selectedFolder)}</span>
                }
              </h1>
            </div>
            <FileTreeToggle 
              currentMode={fileTreeMode} 
              onChange={setFileTreeMode} 
              tokenCounts={calculateFileTreeTokens()}
            />
            <ThemeToggle />
          </div>
        </header>

        {processingStatus.status === "processing" && (
          <div className="processing-indicator">
            <div className="spinner"></div>
            <span>{processingStatus.message}</span>
            {processingStatus.processed !== undefined && (
              <div className="progress-bar-container">
                <div 
                  className="progress-bar" 
                  style={{ 
                    width: processingStatus.total ? 
                      `${Math.min((processingStatus.processed / processingStatus.total) * 100, 100)}%` : 
                      `${Math.min(processingStatus.processed * 0.1, 100)}%` 
                  }}
                />
                <span className="progress-details">
                  {processingStatus.processed.toLocaleString()} files
                  {processingStatus.directories ? ` · ${processingStatus.directories.toLocaleString()} directories` : ''}
                </span>
              </div>
            )}
            {isLoadingCancellable && (
              <button 
                className="cancel-button"
                onClick={handleCancelLoading}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {processingStatus.status === "error" && (
          <div className="error-message">Error: {processingStatus.message}</div>
        )}

        {(!appInitialized || !selectedFolder) && (
          <div className="welcome-screen">
            <pre className="ascii-logo">
{`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ██████╗  █████╗ ███████╗████████╗███████╗███████╗██╗      ██████╗ ██╗    ██╗ ║
║  ██╔══██╗██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔════╝██║     ██╔═══██╗██║    ██║ ║
║  ██████╔╝███████║███████╗   ██║   █████╗  █████╗  ██║     ██║   ██║██║ █╗ ██║ ║
║  ██╔═══╝ ██╔══██║╚════██║   ██║   ██╔══╝  ██╔══╝  ██║     ██║   ██║██║███╗██║ ║
║  ██║     ██║  ██║███████║   ██║   ███████╗██║     ███████╗╚██████╔╝╚███╔███╔╝ ║
║  ╚═╝     ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝  ║
║                                                                              ║
║                           © 2025 PasteFlow Corp v1.0                         ║
║                                                                              ║
║                        Select a folder to get started                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`}
            </pre>
            <div className="welcome-message">
              <button className="welcome-button" onClick={openFolder}>
                <FolderOpen size={36} />
              </button>
            </div>
          </div>
        )}

        {selectedFolder && (
          <div className="main-content">
            <Sidebar
              selectedFolder={selectedFolder}
              openFolder={openFolder}
              allFiles={allFiles}
              selectedFiles={selectedFiles}
              toggleFileSelection={toggleFileSelection}
              toggleFolderSelection={toggleFolderSelection}
              searchTerm={searchTerm}
              onSearchChange={handleSearchChange}
              selectAllFiles={selectAllFiles}
              deselectAllFiles={deselectAllFiles}
              expandedNodes={expandedNodes}
              toggleExpanded={toggleExpanded}
              resetFolderState={resetFolderState}
              onFileTreeSortChange={handleFileTreeSortChange}
              toggleFilterModal={toggleFilterModal}
              refreshFileTree={refreshFileTree}
            />
            <div className="content-area">
              <div className="selected-files-content-area">
                <div className="selected-files-content-header">
                  <div className="content-actions">
                    <strong className="content-title">Selected Files</strong>
                    <div className="sort-dropdown sort-dropdown-selected-files">
                      <button
                        className="sort-dropdown-button"
                        onClick={toggleSortDropdown}
                      >
                        Sort:{" "}
                        {sortOptions.find((opt) => opt.value === sortOrder)
                          ?.label || sortOrder}
                      </button>
                      {sortDropdownOpen && (
                        <div className="sort-options">
                          {sortOptions.map((option) => (
                            <div
                              key={option.value}
                              className={`sort-option ${
                                sortOrder === option.value ? "active" : ""
                              }`}
                              onClick={() => handleSortChange(option.value)}
                            >
                              {option.label}
                              {sortOrder === option.value && <span className="checkmark">✓</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="file-stats">
                      {selectedFiles.length} files | ~
                      {calculateTotalTokens().toLocaleString()} tokens
                    </div>
                  </div>
                  {selectedFolder && (
                    <button
                      className="apply-changes-btn"
                      onClick={() => setShowApplyChangesModal(true)}
                    >
                      Apply XML Changes
                    </button>
                  )}
                </div>

                <FileList
                  files={allFiles}
                  selectedFiles={selectedFiles}
                  toggleFileSelection={toggleFileSelection}
                  openFolder={openFolder}
                  processingStatus={processingStatus}
                />

                <div className="copy-button-container">
                  <div className="copy-button-group">
                    <CopyButton
                      text={getSelectedFilesContent}
                      className="primary"
                      >
                      <span>COPY ALL SELECTED ({selectedFiles.length} files)</span>
                    </CopyButton>
                    <div className="token-count-display">
                      ~{(calculateTotalTokens() + (fileTreeMode !== "none" ? getCurrentFileTreeTokens() : 0)).toLocaleString()} tokens
                    </div>
                  </div>
                  
                  <div className="copy-button-group">
                    <CopyButton
                      text={() => {
                        // Get the content without user instructions
                        const baseContent = getSelectedFilesContentWithoutInstructions();
                        // Get user instructions
                        const userInstructionsElement = document.querySelector('.user-instructions-input') as HTMLTextAreaElement;
                        const userInstructions = userInstructionsElement?.value?.trim();
                        
                        // Combine content with XML instructions and user instructions at the end
                        let result = `${baseContent}\n\n${XML_FORMATTING_INSTRUCTIONS}`;
                        
                        // Add user instructions at the very end if they exist
                        if (userInstructions) {
                          result += `\n\n<user_instructions>\n${userInstructions}\n</user_instructions>`;
                        }
                        
                        return result;
                      }}
                      className="secondary"
                    >
                      <span>COPY WITH XML PROMPT ({selectedFiles.length} files)</span>
                    </CopyButton>
                    <div className="token-count-display">
                      ~{(() => {
                        // Calculate total tokens for selected files
                        const filesTokens = calculateTotalTokens();
                        
                        // Add tokens for file tree if included
                        const fileTreeTokens = fileTreeMode !== "none" ? getCurrentFileTreeTokens() : 0;
                        
                        // Add tokens for XML formatting instructions
                        const xmlInstructionsTokens = estimateTokenCount(XML_FORMATTING_INSTRUCTIONS);
                        
                        // Add tokens for user instructions if they exist
                        let total = filesTokens + xmlInstructionsTokens + fileTreeTokens;
                        if (userInstructions.trim()) {
                          total += instructionsTokenCount;
                        }
                        
                        return total.toLocaleString();
                      })().toString()} tokens
                    </div>
                  </div>
                </div>
              </div>
              <div className="user-instructions-input-area">
                <div className="instructions-token-count">
                  ~{instructionsTokenCount.toLocaleString()} tokens
                </div>
                <textarea 
                  className="user-instructions-input" 
                  placeholder="Enter your instructions here..." 
                  value={userInstructions}
                  onChange={(e) => setUserInstructions(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
        
        {/* Apply Changes Modal */}
        {showApplyChangesModal && selectedFolder && (
          <ApplyChangesModal
            selectedFolder={selectedFolder}
            onClose={() => setShowApplyChangesModal(false)}
          />
        )}
        
        {/* Filter Modal */}
        {filterModalOpen && (
          <FilterModal
            exclusionPatterns={exclusionPatterns}
            onSave={(patterns: string[]) => {
              saveFilters(patterns, true);
              setFilterModalOpen(false);
            }}
            onClose={() => setFilterModalOpen(false)}
          />
        )}
      </div>
    </ThemeProvider>
  );
};

export default App;