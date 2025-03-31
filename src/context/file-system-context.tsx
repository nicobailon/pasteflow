import { createContext, useCallback, useEffect, useMemo } from 'react';

import { STORAGE_KEYS } from '../constants';
import { openFolderDialog, cancelFileLoading } from '../handlers/electron-handlers';
import { refreshFileTree } from '../handlers/filter-handlers';
import { FileData } from '../types/file-types';
import { resetFolderState as resetFolderStateUtil } from '../utils/file-utils';
import useLocalStorage from '../hooks/use-local-storage';

// Default no-op function for setters
const noopFunc = () => {};

export interface FileSystemState {
  selectedFolder: string | null;
  allFiles: FileData[];
  displayedFiles: FileData[];
  processingStatus: {
    status: 'idle' | 'processing' | 'complete' | 'error';
    message: string;
    processed?: number;
    directories?: number;
    total?: number;
  };
  exclusionPatterns: string[];
  isLoadingCancellable: boolean;
  appInitialized: boolean;
}

export interface FileSystemContextType extends FileSystemState {
  setSelectedFolder: (folder: string | null) => void;
  setAllFiles: React.Dispatch<React.SetStateAction<FileData[]>>;
  setDisplayedFiles: React.Dispatch<React.SetStateAction<FileData[]>>;
  setProcessingStatus: React.Dispatch<React.SetStateAction<FileSystemState['processingStatus']>>;
  setExclusionPatterns: (patterns: string[]) => void;
  setIsLoadingCancellable: React.Dispatch<React.SetStateAction<boolean>>;
  setAppInitialized: React.Dispatch<React.SetStateAction<boolean>>;
  openFolder: () => void;
  handleCancelLoading: () => void;
  handleRefreshFileTree: () => void;
  handleResetFolderState: () => void;
}

// Define a default state that matches the context type
const defaultProcessingStatus: FileSystemState['processingStatus'] = {
  status: 'idle',
  message: '',
  processed: 0,
  directories: 0,
  total: 0,
};

const defaultContextValue: FileSystemContextType = {
  selectedFolder: null,
  allFiles: [],
  displayedFiles: [],
  processingStatus: defaultProcessingStatus,
  exclusionPatterns: [],
  isLoadingCancellable: false,
  appInitialized: false,
  setSelectedFolder: noopFunc,
  setAllFiles: noopFunc,
  setDisplayedFiles: noopFunc,
  setProcessingStatus: noopFunc,
  setExclusionPatterns: noopFunc,
  setIsLoadingCancellable: noopFunc,
  setAppInitialized: noopFunc,
  openFolder: noopFunc,
  handleCancelLoading: noopFunc,
  handleRefreshFileTree: noopFunc,
  handleResetFolderState: noopFunc,
};

export const FileSystemContext = createContext(defaultContextValue);

interface FileSystemProviderProps {
  children: React.ReactNode;
  allFiles?: FileData[];
  displayedFiles?: FileData[];
  processingStatus?: FileSystemState['processingStatus'];
  exclusionPatterns?: string[];
  isLoadingCancellable?: boolean;
  appInitialized?: boolean;
  setAllFiles?: React.Dispatch<React.SetStateAction<FileData[]>>;
  setDisplayedFiles?: React.Dispatch<React.SetStateAction<FileData[]>>;
  setProcessingStatus?: React.Dispatch<React.SetStateAction<FileSystemState['processingStatus']>>;
  setExclusionPatterns?: (patterns: string[]) => void;
  setIsLoadingCancellable?: React.Dispatch<React.SetStateAction<boolean>>;
  setAppInitialized?: React.Dispatch<React.SetStateAction<boolean>>;
  clearSelectedFiles?: () => void;
}

export const FileSystemProvider = ({
  children,
  allFiles = [],
  displayedFiles = [],
  processingStatus = defaultProcessingStatus,
  exclusionPatterns = [],
  isLoadingCancellable = false,
  appInitialized = false,
  setAllFiles: setAllFilesProp, // Type will be inferred if not explicitly set, but let's add for clarity if needed
  setDisplayedFiles: setDisplayedFilesProp, // Type inferred
  setProcessingStatus: setProcessingStatusProp, // Type inferred
  setExclusionPatterns: setExclusionPatternsProp, // Type inferred
  setIsLoadingCancellable: setIsLoadingCancellableProp, // Type inferred
  setAppInitialized: setAppInitializedProp, // Type inferred
  clearSelectedFiles: clearSelectedFilesProp, // Type inferred
}: FileSystemProviderProps) => { // Add explicit type annotation here
  // State management for selectedFolder
  const [selectedFolder, setSelectedFolder] = useLocalStorage<string | null>(
    STORAGE_KEYS.SELECTED_FOLDER,
    null
  );
  
  // Use memoized setters to prevent dependency changes on each render
  const setAllFilesState = useMemo(() => setAllFilesProp || (() => {}), [setAllFilesProp]);
  const setDisplayedFilesState = useMemo(() => setDisplayedFilesProp || (() => {}), [setDisplayedFilesProp]);
  const setProcessingStatusState = useMemo(() => setProcessingStatusProp || (() => {}), [setProcessingStatusProp]);
  const setExclusionPatternsState = useMemo(() => setExclusionPatternsProp || (() => {}), [setExclusionPatternsProp]);
  const setIsLoadingCancellableState = useMemo(() => setIsLoadingCancellableProp || (() => {}), [setIsLoadingCancellableProp]);
  const setAppInitializedState = useMemo(() => setAppInitializedProp || (() => {}), [setAppInitializedProp]);
  const clearSelectedFilesFunc = useMemo(() => clearSelectedFilesProp || noopFunc, [clearSelectedFilesProp]);

  // Check if we're running in Electron
  const isElectron = window.electron !== undefined;
  
  // Handle selectedFolder changes
  useEffect(() => {
    if (selectedFolder !== null) {
      // When folder changes, ensure we're clearing previous state appropriately
      clearSelectedFilesFunc();
    }
  }, [selectedFolder, clearSelectedFilesFunc]);

  // Function implementations
  const openFolder = useCallback(() => {
    if (openFolderDialog(isElectron, setProcessingStatusState)) {
      setAppInitializedState(true);
    }
  }, [isElectron, setProcessingStatusState, setAppInitializedState]);

  const handleCancelLoading = useCallback(() => {
    cancelFileLoading(isElectron, setProcessingStatusState);
    setIsLoadingCancellableState(false);
  }, [isElectron, setProcessingStatusState, setIsLoadingCancellableState]);

  const handleRefreshFileTree = useCallback(() => {
    refreshFileTree(
      isElectron,
      selectedFolder,
      exclusionPatterns,
      setProcessingStatusState,
      clearSelectedFilesFunc
    );
  }, [isElectron, selectedFolder, exclusionPatterns, setProcessingStatusState, clearSelectedFilesFunc]);

  const handleResetFolderState = useCallback(() => {
    resetFolderStateUtil(
      setSelectedFolder,
      setAllFilesState,
      clearSelectedFilesFunc,
      setProcessingStatusState,
      setAppInitializedState
    );
  }, [setSelectedFolder, setAllFilesState, clearSelectedFilesFunc, setProcessingStatusState, setAppInitializedState]);

  const value: FileSystemContextType = {
    selectedFolder,
    allFiles,
    displayedFiles,
    processingStatus,
    exclusionPatterns,
    isLoadingCancellable,
    appInitialized,
    setSelectedFolder,
    setAllFiles: setAllFilesState,
    setDisplayedFiles: setDisplayedFilesState,
    setProcessingStatus: setProcessingStatusState,
    setExclusionPatterns: setExclusionPatternsState,
    setIsLoadingCancellable: setIsLoadingCancellableState,
    setAppInitialized: setAppInitializedState,
    openFolder,
    handleCancelLoading,
    handleRefreshFileTree,
    handleResetFolderState,
  };

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  );
};