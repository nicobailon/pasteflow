import { FileData, WorkspaceState } from '../types/file-types';

// Define locally to avoid circular dependency with useAppState
type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

// Type for processing status
export interface ProcessingStatus {
  status: "idle" | "processing" | "complete" | "error";
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
}

/**
 * Sets up event listeners for Electron IPC
 * ... (other params) ...
 * @param {string | null} currentWorkspace - The currently active workspace name
 * @param {Function} setCurrentWorkspace - Setter for the current workspace name
 * @param {Function} persistWorkspace - Function to save workspace state
 * @returns {Function} Cleanup function to remove event listeners
 */
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
  // --- NEW PARAMS ---
  currentWorkspace: string | null,
  setCurrentWorkspace: (name: string | null) => void,
  persistWorkspace: (name: string, state: WorkspaceState) => void,
  // --- MORE NEW PARAMS ---
  pendingWorkspaceData: PendingWorkspaceData | null,
  applyWorkspaceData: (data: WorkspaceState | null, applyImmediately?: boolean) => void,
  selectedFolder: string | null // Need current folder to reconstruct WorkspaceState
  // --- END MORE NEW PARAMS ---
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
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  };

  const handleFileListData = (files: FileData[]) => {
    try {
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

      // Ensure the app is marked as initialized when files are loaded
      setAppInitialized(true);
      sessionStorage.setItem("hasLoadedInitialData", "true");

      // --- APPLY PENDING WORKSPACE DATA ---
      if (pendingWorkspaceData) {
        console.log("[electron-handler.handleFileListData] Pending workspace data found. Applying now...");
        // Reconstruct the full WorkspaceState object
        const fullWorkspaceData: WorkspaceState = {
          selectedFolder: selectedFolder, // Use the folder that was just loaded
          ...pendingWorkspaceData
        };
        applyWorkspaceData(fullWorkspaceData, true); // Apply immediately
        // applyWorkspaceData should clear the pending state itself
      }
      // --- END APPLY PENDING WORKSPACE DATA ---

    } catch (error) {
      console.error("Error handling file list data:", error);
      setProcessingStatus({
        status: "error",
        message: `Error processing files: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
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
