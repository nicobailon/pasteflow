import { FileData, WorkspaceState } from '../types/file-types';
import { getPathValidator } from '../security/path-validator';
import { ApplicationError, ERROR_CODES, getRecoverySuggestions, logError } from '../utils/error-handling';
import { generateUniqueWorkspaceName } from '../utils/workspace-utils';

export interface ProcessingStatus {
  status: "idle" | "processing" | "complete" | "error";
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
}

// Global tracking to prevent duplicate handler registration
const HANDLER_KEY = '__pasteflow_electron_handlers_registered';

export const setupElectronHandlers = (
  isElectron: boolean,
  setSelectedFolder: (folder: string | null) => void,
  setAllFiles: (files: FileData[]) => void,
  setProcessingStatus: (status: ProcessingStatus) => void,
  clearSelectedFiles: () => void,
  applyFiltersAndSort: (files: FileData[], sort: string, filter: string) => void,
  sortOrder: string,
  searchTerm: string,
  setIsLoadingCancellable: (cancellable: boolean) => void,
  setAppInitialized: (initialized: boolean) => void,
  currentWorkspace: string | null,
  setCurrentWorkspace: (name: string | null) => void,
  persistWorkspace: (name: string, state: WorkspaceState) => void,
  getWorkspaceNames: () => string[],
  selectedFolder: string | null
): (() => void) => {
  if (!isElectron) return () => {};

  // Add debouncing to prevent rapid workspace creation
  let folderSelectionTimeout: NodeJS.Timeout | null = null;
  
  // Add unique handler ID for debugging
  const handlerId = Math.random().toString(36).substr(2, 9);
  console.log(`[DEBUG] Creating handleFolderSelected handler with ID: ${handlerId}`);

  const handleFolderSelected = (folderPath: string) => {
    console.log(`[DEBUG] handleFolderSelected called with handler ID: ${handlerId}, path: ${folderPath}`);
    // Clear any pending folder selection
    if (folderSelectionTimeout) {
      clearTimeout(folderSelectionTimeout);
    }

    // Debounce the folder selection to prevent multiple rapid calls
    folderSelectionTimeout = setTimeout(() => {
    try {
      if (typeof folderPath === "string") {
        console.log("Folder selected:", folderPath);
        
        // Validate the path before proceeding
        const validator = getPathValidator();
        const validation = validator.validatePath(folderPath);
        
        if (!validation.valid) {
          const error = new ApplicationError(
            `Path validation failed: ${validation.reason}`,
            ERROR_CODES.PATH_VALIDATION_FAILED,
            {
              operation: 'handleFolderSelected',
              details: { folderPath, reason: validation.reason },
              timestamp: Date.now()
            },
            getRecoverySuggestions(ERROR_CODES.PATH_VALIDATION_FAILED)
          );
          
          logError(error, error.context);
          
          const userMessage = validation.reason === 'BLOCKED_PATH' 
            ? 'Access to this directory is restricted for security reasons' 
            : (validation.reason === 'PATH_TRAVERSAL_DETECTED' 
                ? 'Path contains invalid characters'
                : (validation.reason === 'OUTSIDE_WORKSPACE' 
                    ? 'Path is outside allowed workspace boundaries' 
                    : 'The selected path is invalid'));
          
          setProcessingStatus({
            status: "error",
            message: `Invalid path: ${userMessage}`,
          });
          return;
        }
        
        const newPath = validation.sanitizedPath || folderPath; // Use sanitized path
        
        // Clear accumulated files when new folder is selected
        accumulatedFiles = [];

        // Check if we're opening the same folder that's already open
        if (selectedFolder === newPath) {
          console.log('[electron-handler] Same folder selected, no workspace change needed:', newPath);
          // Just proceed with refreshing the file list
        } else {
          // Different folder selected - check if we need to create a new workspace
          const existingWorkspaceNames = getWorkspaceNames();
          
          if (currentWorkspace === null) {
            // No active workspace - create a new one
            const newWorkspaceName = generateUniqueWorkspaceName(existingWorkspaceNames, newPath);
            console.log(`[DEBUG] Handler ${handlerId} - No active workspace. Creating new workspace:`, newWorkspaceName);
            console.log(`[DEBUG] Handler ${handlerId} - Existing workspace names:`, existingWorkspaceNames);

            const initialWorkspaceState: WorkspaceState = {
              selectedFolder: newPath,
              allFiles: [],
              selectedFiles: [],
              expandedNodes: {},
              sortOrder: 'alphabetical',
              searchTerm: '',
              fileTreeMode: 'none',
              exclusionPatterns: [],
              userInstructions: '',
              tokenCounts: {},
              customPrompts: { systemPrompts: [], rolePrompts: [] }
            };

            persistWorkspace(newWorkspaceName, initialWorkspaceState);
            setCurrentWorkspace(newWorkspaceName);
            console.log(`[electron-handler] Workspace "${newWorkspaceName}" created and activated.`);
          } else {
            // Workspace is already active - create a new workspace for the different folder
            const newWorkspaceName = generateUniqueWorkspaceName(existingWorkspaceNames, newPath);
            console.log(`[DEBUG] Handler ${handlerId} - Creating new workspace "${newWorkspaceName}" for different folder:`, newPath);
            console.log(`[DEBUG] Handler ${handlerId} - Current workspace: ${currentWorkspace}, Existing names:`, existingWorkspaceNames);
            
            const initialWorkspaceState: WorkspaceState = {
              selectedFolder: newPath,
              allFiles: [],
              selectedFiles: [],
              expandedNodes: {},
              sortOrder: 'alphabetical',
              searchTerm: '',
              fileTreeMode: 'none',
              exclusionPatterns: [],
              userInstructions: '',
              tokenCounts: {},
              customPrompts: { systemPrompts: [], rolePrompts: [] }
            };

            persistWorkspace(newWorkspaceName, initialWorkspaceState);
            setCurrentWorkspace(newWorkspaceName);
            console.log(`[electron-handler] New workspace "${newWorkspaceName}" created and activated.`);
          }
        }

        setSelectedFolder(newPath); // Existing call
        // Clear any previously selected files
        clearSelectedFiles(); // Existing call
        // No longer resetting the sort order - will use the saved preference
        // The initial default is already set by useLocalStorage
        setProcessingStatus({
          status: "processing",
          message: "Requesting file list...",
          processed: 0,
          directories: 0
        });
        console.log(`[DEBUG] handleFolderSelected sending request-file-list for: "${newPath}"`);
        window.electron.ipcRenderer.send("request-file-list", newPath, []); // Use newPath
      } else {
        console.error("Invalid folder path received:", folderPath);
        setProcessingStatus({
          status: "error",
          message: "Invalid folder path received",
        });
      }
    } catch (error) {
      const appError = error instanceof ApplicationError 
        ? error 
        : new ApplicationError(
            'Failed to handle folder selection',
            ERROR_CODES.FILE_LOADING_FAILED,
            {
              operation: 'handleFolderSelected',
              details: { folderPath },
              timestamp: Date.now()
            },
            getRecoverySuggestions(ERROR_CODES.FILE_LOADING_FAILED)
          );
      
      logError(appError, appError.context);
      
      setProcessingStatus({
        status: "error",
        message: `Error selecting folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
    }, 100); // 100ms debounce
  };

  // Keep accumulated files in closure
  let accumulatedFiles: FileData[] = [];
  
  const handleFileListData = (
  data: { files?: FileData[]; isComplete?: boolean; processed?: number; directories?: number; total?: number } | FileData[]
): void => {
  // Update timestamp on each file list update
  window.sessionStorage.setItem('lastFileListUpdate', Date.now().toString());

  let filesArray: FileData[] = [];
  let isComplete = false;
  let processedCount = 0;
  let directoriesCount = 0;
  let totalCount = 0;

  if (Array.isArray(data)) {
    // Legacy format - treat as complete and reset accumulated files
    accumulatedFiles = [];
    filesArray = data.map(file => ({ ...file, isContentLoaded: file.isContentLoaded ?? false, isDirectory: file.isDirectory ?? false }));
    isComplete = true;
    processedCount = filesArray.length;
  } else if (data?.files) {
    // Progressive loading - accumulate files
    const newFiles = data.files.map(file => ({ 
      ...file, 
      isContentLoaded: file.isContentLoaded ?? false,
      isDirectory: file.isDirectory ?? false 
    }));
    
    if (data.isComplete && newFiles.length === 0) {
      // This is the final signal - use accumulated files
      filesArray = accumulatedFiles;
    } else {
      // Add new files to accumulation with memory limit
      const MAX_FILES_IN_MEMORY = 50_000; // Prevent OOM by limiting files in memory
      accumulatedFiles = [...accumulatedFiles, ...newFiles];
      
      // If approaching memory limit, send batch to free up memory
      if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
        const error = new ApplicationError(
          `Memory limit exceeded: ${accumulatedFiles.length} files`,
          ERROR_CODES.MEMORY_LIMIT_EXCEEDED,
          {
            operation: 'handleFileListData',
            details: { 
              fileCount: accumulatedFiles.length,
              limit: MAX_FILES_IN_MEMORY 
            },
            timestamp: Date.now()
          },
          getRecoverySuggestions(ERROR_CODES.MEMORY_LIMIT_EXCEEDED)
        );
        
        logError(error, error.context);
        
        // Keep only the most recent files
        accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
      }
      
      filesArray = accumulatedFiles;
    }
    
    isComplete = data.isComplete ?? false;
    processedCount = data.processed ?? filesArray.length;
    directoriesCount = data.directories ?? 0;
    totalCount = data.total ?? filesArray.length;
  }

  // Always update files, even for partial updates
  setAllFiles(filesArray);
  applyFiltersAndSort(filesArray, sortOrder, searchTerm);

  if (isComplete) {
    setProcessingStatus({
      status: "complete",
      message: `Loaded ${processedCount} files from ${directoriesCount} directories`,
      processed: processedCount,
      directories: directoriesCount,
      total: totalCount
    });
    setIsLoadingCancellable(false);
    setAppInitialized(true);
    // Clear accumulated files after completion
    accumulatedFiles = [];
  }

  const event = new CustomEvent("file-list-updated");
  window.dispatchEvent(event);
};

  const handleProcessingStatus = (status: ProcessingStatus) => {
    console.log("Processing status:", status);
    setProcessingStatus(status);

    // If processing is complete or error, mark as not cancellable
    if (status.status === "complete" || status.status === "error") {
      setIsLoadingCancellable(false);
    } else if (status.status === "processing") {
      setIsLoadingCancellable(true);
    }
  };

  // Check if handlers are already registered globally
  if ((window as any)[HANDLER_KEY]) {
    console.log(`[DEBUG] Handlers already registered globally, skipping registration for handler ID: ${handlerId}`);
    return () => {};
  }
  
  // Mark handlers as registered globally
  (window as any)[HANDLER_KEY] = true;
  
  console.log(`[DEBUG] Registering folder-selected listener with handler ID: ${handlerId}`);
  window.electron.ipcRenderer.on("folder-selected", handleFolderSelected);
  window.electron.ipcRenderer.on("file-list-data", handleFileListData);
  window.electron.ipcRenderer.on(
    "file-processing-status",
    handleProcessingStatus,
  );

  // Set up periodic cleanup to prevent memory buildup in edge cases
  const cleanupInterval = setInterval(() => {
    // If we have accumulated files but haven't received updates in a while,
    // it might indicate an interrupted process
    if (accumulatedFiles.length > 0) {
      const lastUpdateTime = window.sessionStorage.getItem('lastFileListUpdate');
      const now = Date.now();
      const timeSinceLastUpdate = lastUpdateTime ? now - Number.parseInt(lastUpdateTime) : Number.POSITIVE_INFINITY;
      
      // If no updates for 5 minutes, clear the accumulated files
      if (timeSinceLastUpdate > 5 * 60 * 1000) {
        console.warn('Clearing stale accumulated files due to inactivity');
        accumulatedFiles = [];
        window.sessionStorage.removeItem('lastFileListUpdate');
      }
    }
  }, 60_000); // Check every minute


  return () => {
    console.log(`[DEBUG] Cleaning up handler with ID: ${handlerId}`);
    // Clear any pending folder selection timeout
    if (folderSelectionTimeout) {
      clearTimeout(folderSelectionTimeout);
    }
    
    // Clear accumulated files to prevent memory leak
    accumulatedFiles = [];
    clearInterval(cleanupInterval);
    window.sessionStorage.removeItem('lastFileListUpdate');
    
    // Clear the global registration flag
    delete (window as any)[HANDLER_KEY];
    
    console.log(`[DEBUG] Removing folder-selected listener for handler ID: ${handlerId}`);
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
};

/**
 * Opens the folder selection dialog
 */
export const openFolderDialog = (isElectron: boolean, setProcessingStatus: (status: ProcessingStatus) => void) => {
  if (isElectron) {
    console.log("[DEBUG] openFolderDialog called - sending open-folder IPC event");
    setProcessingStatus({ status: "idle", message: "Select a folder..." });
    window.electron.ipcRenderer.send("open-folder");

    // Mark the app as initialized once a folder is selected
    sessionStorage.setItem("hasLoadedInitialData", "true");
    return true;
  } else {
    console.warn("Folder selection not available in browser");
    return false;
  }
};

/**
 * Cancels the file loading process
 */
export const cancelFileLoading = (isElectron: boolean, setProcessingStatus: (status: ProcessingStatus) => void) => {
  if (isElectron) {
    window.electron.ipcRenderer.send("cancel-file-loading");
    setProcessingStatus({
      status: "idle",
      message: "File loading cancelled",
    });
    return true;
  }
  return false;
};

/**
 * Requests the file list for a folder with exclusion patterns
 */
export const requestFileList = (
  isElectron: boolean,
  selectedFolder: string | null,
  exclusionPatterns: string[],
  setProcessingStatus: (status: ProcessingStatus) => void
) => {
  if (isElectron && selectedFolder) {
    setProcessingStatus({
      status: "processing",
      message: "Requesting file list...",
    });
    window.electron.ipcRenderer.send("request-file-list", selectedFolder, exclusionPatterns);
    return true;
  }
  return false;
};

export const requestFileContent = async (filePath: string): Promise<{
  success: boolean;
  content?: string;
  tokenCount?: number;
  error?: string;
}> => {
  if (!window.electron?.ipcRenderer?.invoke) {
    return { success: false, error: "Electron IPC not available" };
  }
  try {
    const result = await window.electron.ipcRenderer.invoke("request-file-content", filePath);
    return result as { success: boolean; content?: string; tokenCount?: number; error?: string };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};