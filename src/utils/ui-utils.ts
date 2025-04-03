/**
 * Function to reset the app to its blank starting state
 * 
 * @param {Function} setSelectedFolder - Setter for selected folder
 * @param {Function} setAllFiles - Setter for all files
 * @param {Function} setSelectedFiles - Setter for selected files
 * @param {Function} setProcessingStatus - Setter for processing status
 * @param {Function} setAppInitialized - Setter for app initialized flag
 */
export const resetFolderState = (
  setSelectedFolder: (folder: string | null) => void,
  setAllFiles: (files: any[]) => void,
  setSelectedFiles: (files: any[]) => void,
  setProcessingStatus: (status: any) => void,
  setAppInitialized: (initialized: boolean) => void
): void => {
  console.log("Resetting folder state to blank starting state");
  setSelectedFolder(null);
  setAllFiles([]);
  setSelectedFiles([]);
  setProcessingStatus({ status: "idle", message: "" });
  setAppInitialized(false);
  
  // Clear the session flag to ensure welcome screen appears next time
  sessionStorage.removeItem("hasLoadedInitialData");
}; 