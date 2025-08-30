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

// Global request ID tracking for file list requests
const GLOBAL_REQUEST_ID_KEY = '__pasteflow_current_request_id';

interface GlobalWindow extends Window {
  [GLOBAL_REQUEST_ID_KEY]?: string | null;
}

export const setGlobalRequestId = (requestId: string | null) => {
  (window as GlobalWindow)[GLOBAL_REQUEST_ID_KEY] = requestId;
};

export const getGlobalRequestId = (): string | null => {
  return (window as GlobalWindow)[GLOBAL_REQUEST_ID_KEY] ?? null;
};

// Helper function to create initial workspace state
const createInitialWorkspaceState = (folderPath: string): WorkspaceState => ({
  selectedFolder: folderPath,
  selectedFiles: [],
  expandedNodes: {},
  sortOrder: 'alphabetical',
  searchTerm: '',
  fileTreeMode: 'none',
  exclusionPatterns: [],
  userInstructions: '',
  tokenCounts: {},
  systemPrompts: [],
  rolePrompts: [],
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
  persistWorkspace: (name: string, state: WorkspaceState) => Promise<void>,
  setCurrentWorkspace: (name: string | null) => void,
): Promise<string | null> => {
  // Check if we're opening the same folder that's already open
  if (selectedFolder === newPath) {
    return currentWorkspace;
  }

  const existingWorkspaceNames = await getWorkspaceNames();
  const newWorkspaceName = generateUniqueWorkspaceName(existingWorkspaceNames, newPath);

  const initialWorkspaceState = createInitialWorkspaceState(newPath);
  // Wait for workspace to be persisted before setting it as current
  await persistWorkspace(newWorkspaceName, initialWorkspaceState);
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
  persistWorkspace: (name: string, state: WorkspaceState) => Promise<void>;
  getWorkspaceNames: () => Promise<string[]>;
  selectedFolder: string | null;
  validateSelectedFilesExist?: () => void;
}

// Create the folder selected handler factory
const createFolderSelectedHandler = (
  params: HandlerParams,
  accumulatedFiles: FileData[],
  _handlerId: string
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
  persistWorkspace: (name: string, state: WorkspaceState) => Promise<void>,
  getWorkspaceNames: () => Promise<string[]>,
  selectedFolder: string | null,
  validateSelectedFilesExist?: () => void
): (() => void) => {
  if (!isElectron) return () => {};

  const handlerConfig = createHandlerConfiguration({
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
    selectedFolder,
    validateSelectedFilesExist
  });

  if (isHandlerAlreadyRegistered()) {
    return () => {};
  }

  return initializeElectronHandlers(handlerConfig);
};

/**
 * Create configuration for electron handlers
 */
function createHandlerConfiguration(params: {
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
  persistWorkspace: (name: string, state: WorkspaceState) => Promise<void>;
  getWorkspaceNames: () => Promise<string[]>;
  selectedFolder: string | null;
  validateSelectedFilesExist?: () => void;
}) {
  const handlerParams: HandlerParams = {
    ...params
  };
  
  const handlerId = Math.random().toString(36).slice(2, 11);
  const accumulatedFiles: FileData[] = [];
  
  const currentRequestId = { 
    get value() { return getGlobalRequestId(); },
    set value(id: string | null) { setGlobalRequestId(id); }
  };
  
  return {
    params: handlerParams,
    handlerId,
    accumulatedFiles,
    currentRequestId
  };
}

/**
 * Check if handlers are already registered
 */
function isHandlerAlreadyRegistered(): boolean {
  interface ExtendedWindow extends Window {
    [HANDLER_KEY]?: boolean;
  }
  const globalWindow = window as ExtendedWindow;
  return globalWindow[HANDLER_KEY] === true;
}

/**
 * Initialize and register electron handlers
 */
function initializeElectronHandlers(config: {
  params: HandlerParams;
  handlerId: string;
  accumulatedFiles: FileData[];
  currentRequestId: { value: string | null };
}): () => void {
  const { params, handlerId, accumulatedFiles, currentRequestId } = config;
  
  const handlers = createElectronHandlers(params, accumulatedFiles, currentRequestId, handlerId);
  
  registerGlobalHandlerFlag();
  registerIPCHandlers(handlers);
  
  const cleanupInterval = setupPeriodicCleanup(accumulatedFiles);
  
  return createCleanupFunction(handlers, accumulatedFiles, cleanupInterval);
}

/**
 * Create electron IPC handlers
 */
function createElectronHandlers(
  params: HandlerParams,
  accumulatedFiles: FileData[],
  currentRequestId: { value: string | null },
  handlerId: string
) {
  const handleFolderSelected = createFolderSelectedHandler(params, accumulatedFiles, handlerId);
  
  const processFileData = createFileDataProcessor(accumulatedFiles, params);
  const handleFileListData = createFileListDataHandler(params, currentRequestId, processFileData, accumulatedFiles);
  const handleProcessingStatus = createProcessingStatusHandlerInternal(params);
  
  return {
    handleFolderSelected,
    handleFileListData,
    handleProcessingStatus
  };
}

/**
 * Create file data processor
 */
function createFileDataProcessor(
  accumulatedFiles: FileData[],
  params: HandlerParams
) {
  return (
    data: FileListIPCData,
    currentRequestId: { value: string | null }
  ) => {
    if (Array.isArray(data)) {
      return processLegacyFileData(data, accumulatedFiles);
    }
    
    if (isStaleRequest(data, currentRequestId)) {
      return createEmptyResult();
    }
    
    clearAccumulatedFilesIfNewRequest(data, currentRequestId, accumulatedFiles);
    
    const validatedFiles = validateAndFilterFiles(data, params);
    
    if (isCompletionSignal(data, validatedFiles)) {
      return createCompletionResult(data, accumulatedFiles);
    }
    
    accumulateFilesWithMemoryLimit(validatedFiles, accumulatedFiles);
    
    return createCompletionResult(data, accumulatedFiles);
  };
}

/**
 * Process legacy array format data
 */
function processLegacyFileData(data: FileData[], accumulatedFiles: FileData[]) {
  accumulatedFiles.length = 0;
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

/**
 * Check if request is stale
 */
function isStaleRequest(
  data: { requestId?: string },
  currentRequestId: { value: string | null }
): boolean {
  return 'requestId' in data && 
         currentRequestId.value !== null && 
         data.requestId !== currentRequestId.value;
}

/**
 * Create empty result for stale requests
 */
function createEmptyResult() {
  return {
    filesArray: [],
    isComplete: false,
    processedCount: 0,
    directoriesCount: 0,
    totalCount: 0
  };
}

/**
 * Clear accumulated files if this is a new request
 */
function clearAccumulatedFilesIfNewRequest(
  data: { requestId?: string; files?: FileData[]; processed?: number },
  currentRequestId: { value: string | null },
  accumulatedFiles: FileData[]
): void {
  const isNewRequest = 'requestId' in data && 
                      data.requestId === currentRequestId.value && 
                      data.files && 
                      data.files.length > 0 && 
                      data.processed && 
                      data.processed <= data.files.length && 
                      data.processed < 50;
  
  if (isNewRequest) {
    accumulatedFiles.length = 0;
  }
}

/**
 * Validate and filter files for current workspace
 */
function validateAndFilterFiles(
  data: { files?: FileData[] },
  params: HandlerParams
): FileData[] {
  let files = (data.files || []).map(file => ({ 
    ...file, 
    isContentLoaded: file.isContentLoaded ?? false,
    isDirectory: file.isDirectory ?? false 
  }));
  
  if (files.length > 0 && params.selectedFolder) {
    files = files.filter(file => {
      const normalizedFilePath = file.path.replace(/\\/g, '/');
      const normalizedFolderPath = params.selectedFolder!.replace(/\\/g, '/');
      return normalizedFilePath.startsWith(normalizedFolderPath);
    });
  }
  
  return files;
}

/**
 * Check if this is a completion signal
 */
function isCompletionSignal(
  data: { isComplete?: boolean },
  files: FileData[]
): boolean {
  return data.isComplete === true && files.length === 0;
}

/**
 * Create completion result
 */
function createCompletionResult(
  data: { isComplete?: boolean; processed?: number; directories?: number; total?: number },
  accumulatedFiles: FileData[]
) {
  return {
    filesArray: accumulatedFiles,
    isComplete: data.isComplete ?? false,
    processedCount: data.processed ?? accumulatedFiles.length,
    directoriesCount: data.directories ?? 0,
    totalCount: data.total ?? accumulatedFiles.length
  };
}

/**
 * Accumulate files with memory limit enforcement
 */
function accumulateFilesWithMemoryLimit(
  newFiles: FileData[],
  accumulatedFiles: FileData[]
): void {
  const MAX_FILES_IN_MEMORY = 50_000;
  accumulatedFiles.push(...newFiles);
  
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
    accumulatedFiles.splice(0, accumulatedFiles.length - MAX_FILES_IN_MEMORY);
  }
}


/**
 * Create file list data handler
 */
function createFileListDataHandler(
  params: HandlerParams,
  currentRequestId: { value: string | null },
  processFileData: (data: FileListIPCData, requestId: { value: string | null }) => {
    filesArray: FileData[];
    isComplete: boolean;
    processedCount: number;
    directoriesCount: number;
    totalCount: number;
  },
  accumulatedFiles: FileData[]
) {
  // Track last seen request ID to reliably reset accumulation on new refreshes
  let lastRequestId: string | null = null;

  return (data: FileListIPCData) => {
    window.sessionStorage.setItem('lastFileListUpdate', Date.now().toString());

    // Robust reset on new request ID to prevent duplicate accumulation across refreshes
    if (!Array.isArray(data) && 'requestId' in data && data.requestId && data.requestId !== lastRequestId) {
      accumulatedFiles.length = 0; // clear for new stream
      lastRequestId = data.requestId;
    }

    const { filesArray, isComplete, processedCount, directoriesCount, totalCount } = processFileData(data, currentRequestId);

    params.setAllFiles(filesArray);
    params.applyFiltersAndSort(filesArray, params.sortOrder, params.searchTerm);
    
    if (params.validateSelectedFilesExist) {
      setTimeout(() => {
        params.validateSelectedFilesExist?.();
      }, 50);
    }

    if (isComplete) {
      params.setProcessingStatus({
        status: "complete" as const,
        message: `Loaded ${processedCount} files from ${directoriesCount} directories`,
        processed: processedCount,
        directories: directoriesCount,
        total: totalCount
      });
      params.setIsLoadingCancellable(false);
      params.setAppInitialized(true);
      setGlobalRequestId(null);
    }

    const event = new CustomEvent("file-list-updated");
    window.dispatchEvent(event);
  };
}

/**
 * Create processing status handler
 */
function createProcessingStatusHandlerInternal(params: HandlerParams) {
  return (status: ProcessingStatus) => {
    params.setProcessingStatus(status);

    if (status.status === "complete" || status.status === "error") {
      params.setIsLoadingCancellable(false);
      if (status.status === "error") {
        setGlobalRequestId(null);
      }
    } else if (status.status === "processing") {
      params.setIsLoadingCancellable(true);
    }
  };
}

/**
 * Register global handler flag
 */
function registerGlobalHandlerFlag(): void {
  interface ExtendedWindow extends Window {
    [HANDLER_KEY]?: boolean;
  }
  const globalWindow = window as ExtendedWindow;
  globalWindow[HANDLER_KEY] = true;
}

/**
 * Type for file list data from IPC
 */
type FileListIPCData = 
  | FileData[] 
  | {
      files?: FileData[];
      isComplete?: boolean;
      processed?: number;
      directories?: number;
      total?: number;
      requestId?: string;
    };

/**
 * Register IPC handlers
 */
function registerIPCHandlers(handlers: {
  handleFolderSelected: (folderPath: string) => void;
  handleFileListData: (data: FileListIPCData) => void;
  handleProcessingStatus: (status: ProcessingStatus) => void;
}): void {
  window.electron.ipcRenderer.on("folder-selected", handlers.handleFolderSelected);
  window.electron.ipcRenderer.on("file-list-data", handlers.handleFileListData);
  window.electron.ipcRenderer.on("file-processing-status", handlers.handleProcessingStatus);
}

/**
 * Create cleanup function
 */
function createCleanupFunction(
  handlers: {
    handleFolderSelected: (folderPath: string) => void;
    handleFileListData: (data: FileListIPCData) => void;
    handleProcessingStatus: (status: ProcessingStatus) => void;
  },
  accumulatedFiles: FileData[],
  cleanupInterval: NodeJS.Timeout
): () => void {
  return () => {
    accumulatedFiles.length = 0;
    clearInterval(cleanupInterval);
    window.sessionStorage.removeItem('lastFileListUpdate');
    
    interface ExtendedWindow extends Window {
      [HANDLER_KEY]?: boolean;
    }
    const globalWindow = window as ExtendedWindow;
    delete globalWindow[HANDLER_KEY];
    
    window.electron.ipcRenderer.removeListener("folder-selected", handlers.handleFolderSelected);
    window.electron.ipcRenderer.removeListener("file-list-data", handlers.handleFileListData);
    window.electron.ipcRenderer.removeListener("file-processing-status", handlers.handleProcessingStatus);
  };
}

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
    setGlobalRequestId(null);
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
    setGlobalRequestId(requestId);
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
  isBinary?: boolean;
}> => {
  if (!window.electron?.ipcRenderer?.invoke) {
    return { success: false, error: 'Electron IPC not available' };
  }
  try {
    const res = await window.electron.ipcRenderer.invoke('request-file-content', filePath);

    // Support new { success, data } envelope or legacy { success, content, tokenCount }
    if (res && typeof res === 'object' && 'success' in (res as any)) {
      const r = res as any;
      if (r.success === true) {
        const data = r.data ?? r;
        return {
          success: true,
          content: data?.content ?? '',
          tokenCount: data?.tokenCount ?? 0
        };
      }
      return {
        success: false,
        error: r.error || 'IPC error',
        isBinary: r.isBinary
      };
    }

    // Legacy pass-through
    return res as { success: boolean; content?: string; tokenCount?: number; error?: string; isBinary?: boolean };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};