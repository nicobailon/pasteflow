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

// Helper function to create initial workspace state
const createInitialWorkspaceState = (folderPath: string): WorkspaceState => ({
  selectedFolder: folderPath,
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
});

// Helper function to validate folder path
const validateFolderPath = (
  folderPath: string,
  setProcessingStatus: (status: ProcessingStatus) => void
): { isValid: boolean; sanitizedPath?: string } => {
  if (typeof folderPath !== "string") {
    console.error("Invalid folder path received:", folderPath);
    setProcessingStatus({
      status: "error",
      message: "Invalid folder path received",
    });
    return { isValid: false };
  }

  const validator = getPathValidator();
  const validation = validator.validatePath(folderPath);
  
  if (!validation.valid) {
    const error = new ApplicationError(
      `Path validation failed: ${validation.reason}`,
      ERROR_CODES.PATH_VALIDATION_FAILED,
      {
        operation: 'validateFolderPath',
        details: { folderPath, reason: validation.reason },
        timestamp: Date.now()
      },
      getRecoverySuggestions(ERROR_CODES.PATH_VALIDATION_FAILED)
    );
    
    logError(error, error.context);
    
    let userMessage: string;
    switch (validation.reason) {
      case 'BLOCKED_PATH': {
        userMessage = 'Access to this directory is restricted for security reasons';
        break;
      }
      case 'PATH_TRAVERSAL_DETECTED': {
        userMessage = 'Path contains invalid characters';
        break;
      }
      case 'OUTSIDE_WORKSPACE': {
        userMessage = 'Path is outside allowed workspace boundaries';
        break;
      }
      default: {
        userMessage = 'The selected path is invalid';
      }
    }
    
    setProcessingStatus({
      status: "error",
      message: `Invalid path: ${userMessage}`,
    });
    return { isValid: false };
  }

  return { isValid: true, sanitizedPath: validation.sanitizedPath || folderPath };
};

// Helper function to handle workspace creation/selection
const handleWorkspaceUpdate = (
  newPath: string,
  selectedFolder: string | null,
  currentWorkspace: string | null,
  getWorkspaceNames: () => string[],
  persistWorkspace: (name: string, state: WorkspaceState) => void,
  setCurrentWorkspace: (name: string | null) => void,
  handlerId: string
): void => {
  // Check if we're opening the same folder that's already open
  if (selectedFolder === newPath) {
    console.log('[electron-handler] Same folder selected, no workspace change needed:', newPath);
    return;
  }

  const existingWorkspaceNames = getWorkspaceNames();
  const newWorkspaceName = generateUniqueWorkspaceName(existingWorkspaceNames, newPath);
  
  if (currentWorkspace === null) {
    console.log(`[DEBUG] Handler ${handlerId} - No active workspace. Creating new workspace:`, newWorkspaceName);
    console.log(`[DEBUG] Handler ${handlerId} - Existing workspace names:`, existingWorkspaceNames);
  } else {
    console.log(`[DEBUG] Handler ${handlerId} - Creating new workspace "${newWorkspaceName}" for different folder:`, newPath);
    console.log(`[DEBUG] Handler ${handlerId} - Current workspace: ${currentWorkspace}, Existing names:`, existingWorkspaceNames);
  }

  const initialWorkspaceState = createInitialWorkspaceState(newPath);
  persistWorkspace(newWorkspaceName, initialWorkspaceState);
  setCurrentWorkspace(newWorkspaceName);
  
  const message = currentWorkspace === null 
    ? `Workspace "${newWorkspaceName}" created and activated.`
    : `New workspace "${newWorkspaceName}" created and activated.`;
  console.log(`[electron-handler] ${message}`);
};

// Helper function to set up periodic cleanup
const setupPeriodicCleanup = (
  accumulatedFiles: FileData[]
): NodeJS.Timeout => {
  return setInterval(() => {
    // If we have accumulated files but haven't received updates in a while,
    // it might indicate an interrupted process
    if (accumulatedFiles.length > 0) {
      const lastUpdateTime = window.sessionStorage.getItem('lastFileListUpdate');
      const now = Date.now();
      const timeSinceLastUpdate = lastUpdateTime ? now - Number.parseInt(lastUpdateTime) : Number.POSITIVE_INFINITY;
      
      // If no updates for 5 minutes, clear the accumulated files
      if (timeSinceLastUpdate > 5 * 60 * 1000) {
        console.warn('Clearing stale accumulated files due to inactivity');
        accumulatedFiles.length = 0; // Clear array in place
        window.sessionStorage.removeItem('lastFileListUpdate');
      }
    }
  }, 60_000); // Check every minute
};

// Handler params interface to reduce parameter count
interface HandlerParams {
  isElectron: boolean;
  setSelectedFolder: (folder: string | null) => void;
  setAllFiles: (files: FileData[]) => void;
  setProcessingStatus: (status: ProcessingStatus) => void;
  clearSelectedFiles: () => void;
  applyFiltersAndSort: (files: FileData[], sort: string, filter: string) => void;
  sortOrder: string;
  searchTerm: string;
  setIsLoadingCancellable: (cancellable: boolean) => void;
  setAppInitialized: (initialized: boolean) => void;
  currentWorkspace: string | null;
  setCurrentWorkspace: (name: string | null) => void;
  persistWorkspace: (name: string, state: WorkspaceState) => void;
  getWorkspaceNames: () => string[];
  selectedFolder: string | null;
}

// Create the folder selected handler factory
const createFolderSelectedHandler = (
  params: HandlerParams,
  accumulatedFiles: FileData[],
  handlerId: string
) => {
  let folderSelectionTimeout: NodeJS.Timeout | null = null;

  return (folderPath: string) => {
    console.log(`[DEBUG] handleFolderSelected called with handler ID: ${handlerId}, path: ${folderPath}`);
    
    if (folderSelectionTimeout) {
      clearTimeout(folderSelectionTimeout);
    }

    folderSelectionTimeout = setTimeout(() => {
      try {
        const validation = validateFolderPath(folderPath, params.setProcessingStatus);
        if (!validation.isValid) {
          return;
        }
        
        const newPath = validation.sanitizedPath!;
        console.log("Folder selected:", folderPath);
        
        accumulatedFiles.length = 0; // Clear accumulated files

        handleWorkspaceUpdate(
          newPath,
          params.selectedFolder,
          params.currentWorkspace,
          params.getWorkspaceNames,
          params.persistWorkspace,
          params.setCurrentWorkspace,
          handlerId
        );

        params.setSelectedFolder(newPath);
        params.clearSelectedFiles();
        params.setProcessingStatus({
          status: "processing",
          message: "Requesting file list...",
          processed: 0,
          directories: 0
        });
        
        // Generate new request ID
        currentRequestId = Math.random().toString(36).slice(2, 11);
        console.log(`[DEBUG] handleFolderSelected sending request-file-list for: "${newPath}" with requestId: ${currentRequestId}`);
        // Clear accumulated files when starting a new request
        accumulatedFiles.length = 0;
        window.electron.ipcRenderer.send("request-file-list", newPath, [], currentRequestId);
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
        
        params.setProcessingStatus({
          status: "error",
          message: `Error selecting folder: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }, 100);
  };
};

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

  const params: HandlerParams = {
    isElectron,
    setSelectedFolder,
    setAllFiles,
    setProcessingStatus,
    clearSelectedFiles,
    applyFiltersAndSort,
    sortOrder,
    searchTerm,
    setIsLoadingCancellable,
    setAppInitialized,
    currentWorkspace,
    setCurrentWorkspace,
    persistWorkspace,
    getWorkspaceNames,
    selectedFolder
  };
  
  const handlerId = Math.random().toString(36).slice(2, 11);
  console.log(`[DEBUG] Creating handleFolderSelected handler with ID: ${handlerId}`);

  // Keep accumulated files in closure
  let accumulatedFiles: FileData[] = [];
  
  // Track current request ID to filter out stale responses
  let currentRequestId: string | null = null;
  
  const handleFolderSelected = createFolderSelectedHandler(params, accumulatedFiles, handlerId);
  
  // Helper function to process file data based on format
  const processFileData = (
    data: { files?: FileData[]; isComplete?: boolean; processed?: number; directories?: number; total?: number; requestId?: string } | FileData[]
  ): {
    filesArray: FileData[];
    isComplete: boolean;
    processedCount: number;
    directoriesCount: number;
    totalCount: number;
  } => {
    if (Array.isArray(data)) {
      // Legacy format - treat as complete and reset accumulated files
      accumulatedFiles = [];
      const filesArray = data.map(file => ({ 
        ...file, 
        isContentLoaded: file.isContentLoaded ?? false, 
        isDirectory: file.isDirectory ?? false 
      }));
      return {
        filesArray,
        isComplete: true,
        processedCount: filesArray.length,
        directoriesCount: 0,
        totalCount: filesArray.length
      };
    }

    // Check if this data is from the current request
    if ('requestId' in data && data.requestId !== currentRequestId) {
      console.warn(`[processFileData] Ignoring stale file batch from request ${data.requestId}, current request is ${currentRequestId}`);
      return {
        filesArray: [],
        isComplete: false,
        processedCount: 0,
        directoriesCount: 0,
        totalCount: 0
      };
    }
    
    // Clear accumulated files on first batch of new request
    if ('requestId' in data && data.requestId === currentRequestId && data.files && data.files.length > 0) {
      // Check if this looks like the first batch (small file count and low processed count)
      if (data.processed && data.processed <= data.files.length && data.processed < 50) {
        console.log(`[processFileData] First batch of new request ${data.requestId}, clearing accumulated files`);
        accumulatedFiles.length = 0;
      }
    }
    
    // Progressive loading format
    let newFiles = (data.files || []).map(file => ({ 
      ...file, 
      isContentLoaded: file.isContentLoaded ?? false,
      isDirectory: file.isDirectory ?? false 
    }));
    
    // Validate that files belong to current workspace
    const currentFolder = params.selectedFolder;
    if (newFiles.length > 0 && currentFolder) {
      const validFiles = newFiles.filter(file => {
        // Normalize paths for comparison (handle Windows vs Unix paths)
        const normalizedFilePath = file.path.replace(/\\/g, '/');
        const normalizedFolderPath = currentFolder.replace(/\\/g, '/');
        return normalizedFilePath.startsWith(normalizedFolderPath);
      });
      
      if (validFiles.length !== newFiles.length) {
        console.warn(`[processFileData] Filtered out ${newFiles.length - validFiles.length} files from wrong workspace. Current workspace: ${currentFolder}`);
      }
      
      newFiles = validFiles;
    }
    
    if (data.isComplete && newFiles.length === 0) {
      // This is the final signal - use accumulated files
      return {
        filesArray: accumulatedFiles,
        isComplete: data.isComplete ?? false,
        processedCount: data.processed ?? accumulatedFiles.length,
        directoriesCount: data.directories ?? 0,
        totalCount: data.total ?? accumulatedFiles.length
      };
    }

    // Add new files to accumulation with memory limit
    const MAX_FILES_IN_MEMORY = 50_000;
    accumulatedFiles = [...accumulatedFiles, ...newFiles];
    
    // Handle memory limit
    if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
      const error = new ApplicationError(
        `Memory limit exceeded: ${accumulatedFiles.length} files`,
        ERROR_CODES.MEMORY_LIMIT_EXCEEDED,
        {
          operation: 'processFileData',
          details: { 
            fileCount: accumulatedFiles.length,
            limit: MAX_FILES_IN_MEMORY 
          },
          timestamp: Date.now()
        },
        getRecoverySuggestions(ERROR_CODES.MEMORY_LIMIT_EXCEEDED)
      );
      
      logError(error, error.context);
      accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
    }
    
    return {
      filesArray: accumulatedFiles,
      isComplete: data.isComplete ?? false,
      processedCount: data.processed ?? accumulatedFiles.length,
      directoriesCount: data.directories ?? 0,
      totalCount: data.total ?? accumulatedFiles.length
    };
  };

  // Create the file list data handler factory
  const createFileListDataHandler = (
    params: HandlerParams,
    accumulatedFiles: FileData[]
  ) => {
    return (data: { files?: FileData[]; isComplete?: boolean; processed?: number; directories?: number; total?: number } | FileData[]) => {
      window.sessionStorage.setItem('lastFileListUpdate', Date.now().toString());

      const { filesArray, isComplete, processedCount, directoriesCount, totalCount } = processFileData(data);

      params.setAllFiles(filesArray);
      params.applyFiltersAndSort(filesArray, params.sortOrder, params.searchTerm);

      if (isComplete) {
        params.setProcessingStatus({
          status: "complete",
          message: `Loaded ${processedCount} files from ${directoriesCount} directories`,
          processed: processedCount,
          directories: directoriesCount,
          total: totalCount
        });
        params.setIsLoadingCancellable(false);
        params.setAppInitialized(true);
        accumulatedFiles.length = 0; // Clear accumulated files
      }

      const event = new CustomEvent("file-list-updated");
      window.dispatchEvent(event);
    };
  };

  const handleFileListData = createFileListDataHandler(params, accumulatedFiles);

  // Create the processing status handler factory
  const createProcessingStatusHandler = (params: HandlerParams) => {
    return (status: ProcessingStatus) => {
      console.log("Processing status:", status);
      params.setProcessingStatus(status);

      if (status.status === "complete" || status.status === "error") {
        params.setIsLoadingCancellable(false);
      } else if (status.status === "processing") {
        params.setIsLoadingCancellable(true);
      }
    };
  };

  const handleProcessingStatus = createProcessingStatusHandler(params);

  // Check if handlers are already registered globally
  if ((window as any)[HANDLER_KEY]) {
    console.log(`[DEBUG] Handlers already registered globally, skipping registration for handler ID: ${handlerId}`);
    return () => {};
  }
  
  // Mark handlers as registered globally
  (window as any)[HANDLER_KEY] = true;
  
  // Register IPC handlers
  const registerHandlers = () => {
    console.log(`[DEBUG] Registering folder-selected listener with handler ID: ${handlerId}`);
    window.electron.ipcRenderer.on("folder-selected", handleFolderSelected);
    window.electron.ipcRenderer.on("file-list-data", handleFileListData);
    window.electron.ipcRenderer.on("file-processing-status", handleProcessingStatus);
  };

  registerHandlers();
  const cleanupInterval = setupPeriodicCleanup(accumulatedFiles);

  // Return cleanup function
  return () => {
    console.log(`[DEBUG] Cleaning up handler with ID: ${handlerId}`);
    
    // Clean up resources
    accumulatedFiles.length = 0;
    clearInterval(cleanupInterval);
    window.sessionStorage.removeItem('lastFileListUpdate');
    delete (window as any)[HANDLER_KEY];
    
    // Remove IPC listeners
    console.log(`[DEBUG] Removing folder-selected listener for handler ID: ${handlerId}`);
    window.electron.ipcRenderer.removeListener("folder-selected", handleFolderSelected);
    window.electron.ipcRenderer.removeListener("file-list-data", handleFileListData);
    window.electron.ipcRenderer.removeListener("file-processing-status", handleProcessingStatus);
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
    const requestId = Math.random().toString(36).slice(2, 11);
    window.electron.ipcRenderer.send("request-file-list", selectedFolder, exclusionPatterns, requestId);
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