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
  customPrompts: { systemPrompts: [], rolePrompts: [] },
  instructions: [],
  selectedInstructions: []
});

// Helper function to validate folder path
const validateFolderPath = (
  folderPath: string,
  setProcessingStatus: (status: ProcessingStatus) => void
): { isValid: boolean; sanitizedPath?: string } => {
  if (typeof folderPath !== "string") {
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
const handleWorkspaceUpdate = async (
  newPath: string,
  selectedFolder: string | null,
  currentWorkspace: string | null,
  getWorkspaceNames: () => Promise<string[]>,
  persistWorkspace: (name: string, state: WorkspaceState) => void,
  setCurrentWorkspace: (name: string | null) => void,
): Promise<string | null> => {
  // Check if we're opening the same folder that's already open
  if (selectedFolder === newPath) {
    return currentWorkspace;
  }

  const existingWorkspaceNames = await getWorkspaceNames();
  const newWorkspaceName = generateUniqueWorkspaceName(existingWorkspaceNames, newPath);

  const initialWorkspaceState = createInitialWorkspaceState(newPath);
  persistWorkspace(newWorkspaceName, initialWorkspaceState);
  setCurrentWorkspace(newWorkspaceName);
  
  return newWorkspaceName;
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
  getWorkspaceNames: () => Promise<string[]>;
  selectedFolder: string | null;
}

// Create the folder selected handler factory
const createFolderSelectedHandler = (
  params: HandlerParams,
  accumulatedFiles: FileData[],
  _handlerId: string,
  currentRequestId: { value: string | null }
) => {
  let folderSelectionTimeout: NodeJS.Timeout | null = null;

  return (folderPath: string) => {
    if (folderSelectionTimeout) {
      clearTimeout(folderSelectionTimeout);
    }

    folderSelectionTimeout = setTimeout(async () => {
      try {
        const validation = validateFolderPath(folderPath, params.setProcessingStatus);
        if (!validation.isValid) {
          return;
        }
        
        const newPath = validation.sanitizedPath!;
        
        accumulatedFiles.length = 0; // Clear accumulated files

        const workspaceName = await handleWorkspaceUpdate(
          newPath,
          params.selectedFolder,
          params.currentWorkspace,
          params.getWorkspaceNames,
          params.persistWorkspace,
          params.setCurrentWorkspace
        );

        if (workspaceName) {
          // Create minimal workspace data for the folder opening
          const minimalWorkspaceData = createInitialWorkspaceState(newPath);

          // Dispatch a specific event for direct folder opening to avoid conflicts with workspace loading
          window.dispatchEvent(new CustomEvent('directFolderOpened', { 
            detail: { 
              name: workspaceName, 
              workspace: minimalWorkspaceData 
            } 
          }));
        } else {
          // This should rarely happen, but as a fallback use the old behavior
          params.setSelectedFolder(newPath);
          params.clearSelectedFiles();
          params.setProcessingStatus({
            status: "processing",
            message: "Requesting file list...",
            processed: 0,
            directories: 0
          });
          
          // Generate new request ID
          currentRequestId.value = Math.random().toString(36).slice(2, 11);
          // Clear accumulated files when starting a new request
          accumulatedFiles.length = 0;
          window.electron.ipcRenderer.send("request-file-list", newPath, [], currentRequestId.value);
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
  getWorkspaceNames: () => Promise<string[]>,
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

  // Keep accumulated files in closure
  let accumulatedFiles: FileData[] = [];
  
  // Track current request ID to filter out stale responses
  const currentRequestId = { value: null as string | null };
  
  const handleFolderSelected = createFolderSelectedHandler(params, accumulatedFiles, handlerId, currentRequestId);
  
  // Helper function to process file data based on format
  const processFileData = (
    data: { files?: FileData[]; isComplete?: boolean; processed?: number; directories?: number; total?: number; requestId?: string } | FileData[],
    currentRequestId: { value: string | null }
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
    if ('requestId' in data && data.requestId !== currentRequestId.value) {
      return {
        filesArray: [],
        isComplete: false,
        processedCount: 0,
        directoriesCount: 0,
        totalCount: 0
      };
    }
    
    // Clear accumulated files on first batch of new request
    if ('requestId' in data && data.requestId === currentRequestId.value && data.files && data.files.length > 0) {
      // Check if this looks like the first batch (small file count and low processed count)
      if (data.processed && data.processed <= data.files.length && data.processed < 50) {
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
        // Some files were filtered out
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
    accumulatedFiles: FileData[],
    currentRequestId: { value: string | null }
  ) => {
    return (data: { files?: FileData[]; isComplete?: boolean; processed?: number; directories?: number; total?: number } | FileData[]) => {
      window.sessionStorage.setItem('lastFileListUpdate', Date.now().toString());

      const { filesArray, isComplete, processedCount, directoriesCount, totalCount } = processFileData(data, currentRequestId);

      
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

  const handleFileListData = createFileListDataHandler(params, accumulatedFiles, currentRequestId);

  // Create the processing status handler factory
  const createProcessingStatusHandler = (params: HandlerParams) => {
    return (status: ProcessingStatus) => {
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
  interface ExtendedWindow extends Window {
    [HANDLER_KEY]?: boolean;
  }
  const globalWindow = window as ExtendedWindow;
  if (globalWindow[HANDLER_KEY]) {
    return () => {};
  }
  
  // Mark handlers as registered globally
  globalWindow[HANDLER_KEY] = true;
  
  // Register IPC handlers
  const registerHandlers = () => {
    window.electron.ipcRenderer.on("folder-selected", handleFolderSelected);
    window.electron.ipcRenderer.on("file-list-data", handleFileListData);
    window.electron.ipcRenderer.on("file-processing-status", handleProcessingStatus);
  };

  registerHandlers();
  const cleanupInterval = setupPeriodicCleanup(accumulatedFiles);

  // Return cleanup function
  return () => {
    // Clean up resources
    accumulatedFiles.length = 0;
    clearInterval(cleanupInterval);
    window.sessionStorage.removeItem('lastFileListUpdate');
    delete globalWindow[HANDLER_KEY];
    
    // Remove IPC listeners
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
    setProcessingStatus({ status: "idle", message: "Select a folder..." });
    window.electron.ipcRenderer.send("open-folder");

    // Mark the app as initialized once a folder is selected
    sessionStorage.setItem("hasLoadedInitialData", "true");
    return true;
  } else {
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