import { basename } from './pathUtils';

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

/**
 * Extracts the folder/file name from a full path.
 * 
 * @param {string} filePath - The full path to extract the name from
 * @returns {string} The last segment of the path (the folder or file name)
 */
export const getFolderNameFromPath = (filePath: string): string => {
  if (!filePath) return "";
  
  // Use path.basename to correctly extract the last part of the path
  return basename(filePath);
};