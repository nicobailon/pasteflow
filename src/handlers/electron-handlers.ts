import { FileData, WorkspaceState } from '../types/file-types';

export interface ProcessingStatus {
  status: "idle" | "processing" | "complete" | "error";
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
}

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
  persistWorkspace: (name: string, state: WorkspaceState) => void
): (() => void) => {
  if (!isElectron) return () => {};

  const handleFolderSelected = (folderPath: string) => {
    try {
      if (typeof folderPath === "string") {
        console.log("Folder selected:", folderPath);
        const newPath = folderPath; // Use newPath consistent with prompt

        // ---> START OF NEW LOGIC BLOCK <---
        if (currentWorkspace === null) {
          console.log('[electron-handler] No active workspace. Creating "Untitled" workspace for new folder:', newPath);

          // Define the initial state for the new workspace
          const initialWorkspaceState: WorkspaceState = {
            selectedFolder: newPath, // Use the newly selected path
            fileTreeState: {},       // Default empty expanded nodes
            selectedFiles: [],       // Default empty selection
            userInstructions: '',    // Default empty instructions
            tokenCounts: {},         // Default empty token counts
            customPrompts: { systemPrompts: [], rolePrompts: [] } // Default empty prompts
          };

          // Persist this new "Untitled" workspace
          persistWorkspace("Untitled", initialWorkspaceState);

          // Update the application's current workspace state
          setCurrentWorkspace("Untitled");
          console.log('[electron-handler] "Untitled" workspace created and activated.');

        } else {
          // A workspace is already active. The new folder will be associated with it.
          // No specific action needed here for workspace creation/activation.
          console.log(`[electron-handler] Workspace "${currentWorkspace}" is active. Associating new folder:`, newPath);
        }
        // ---> END OF NEW LOGIC BLOCK <---

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
        window.electron.ipcRenderer.send("request-file-list", newPath, []); // Use newPath
      } else {
        console.error("Invalid folder path received:", folderPath);
        setProcessingStatus({
          status: "error",
          message: "Invalid folder path received",
        });
      }
    } catch (error) {
      console.error("Error handling folder selection:", error);
      setProcessingStatus({
        status: "error",
        message: `Error selecting folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  };

  const handleFileListData = (data: { 
    files?: FileData[], 
    isComplete?: boolean,
    processed?: number,
    directories?: number,
    total?: number
  } | FileData[]) => {
    try {
      let filesArray: FileData[] = [];
      let isComplete = false;
      let processedCount = 0;
      let directoriesCount = 0;
      let totalCount = 0;
      
      if (!data) {
        setProcessingStatus({
          status: "error",
          message: "Invalid file data received: data is null or undefined"
        });
        
        const event = new CustomEvent('file-list-updated');
        window.dispatchEvent(event);
        return;
      }
      
      if (Array.isArray(data)) {
        filesArray = data;
        isComplete = true;
        processedCount = data.length;
        
        setAllFiles(filesArray);
        
        setProcessingStatus({
          status: "complete",
          message: `Loaded ${processedCount} files directly.`,
          processed: processedCount,
          directories: directoriesCount,
          total: totalCount
        });
        
        applyFiltersAndSort(filesArray, sortOrder, searchTerm);
        
        setIsLoadingCancellable(false);
        setAppInitialized(true);
        
        const event = new CustomEvent('file-list-updated');
        window.dispatchEvent(event);
        return;
      }
      
      if (data.files === undefined) {
        filesArray = [];
        
        setProcessingStatus({
          status: "error",
          message: "Invalid file data received: files property is missing"
        });
      } else if (Array.isArray(data.files)) {
        filesArray = data.files;
        isComplete = data.isComplete || false;
        processedCount = data.processed || 0;
        directoriesCount = data.directories || 0;
        totalCount = data.total || 0;
      } else {
        try {
          filesArray = Array.isArray(data.files) ? data.files : 
                      ((typeof data.files === 'object' && data.files !== null) ? 
                      Object.values(data.files as Record<string, FileData>) : []);
        } catch {
          filesArray = [];
        }
        
        setProcessingStatus({
          status: "error",
          message: "Invalid file data received: files property is not an array"
        });
      }
      
      setAllFiles(filesArray);
      
      if (isComplete) {
        applyFiltersAndSort(filesArray, sortOrder, searchTerm);
        
        setProcessingStatus({
          status: "complete",
          message: `Loaded ${processedCount} files from ${directoriesCount} directories.`,
          processed: processedCount,
          directories: directoriesCount,
          total: totalCount
        });
        
        setIsLoadingCancellable(false);
        setAppInitialized(true);
      }
      
      const event = new CustomEvent('file-list-updated');
      window.dispatchEvent(event);
      
    } catch (error) {
      setProcessingStatus({
        status: "error",
        message: `Error processing files: ${error instanceof Error ? error.message : "Unknown error"}`
      });
      
      const event = new CustomEvent('file-list-updated');
      window.dispatchEvent(event);
    }
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
};

/**
 * Opens the folder selection dialog
 */
export const openFolderDialog = (isElectron: boolean, setProcessingStatus: (status: ProcessingStatus) => void) => {
  if (isElectron) {
    console.log("Opening folder dialog");
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