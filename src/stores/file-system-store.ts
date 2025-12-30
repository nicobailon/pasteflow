import { create } from 'zustand';

import type { FileData } from '../types/file-types';

interface ProcessingStatus {
  status: 'idle' | 'processing' | 'complete' | 'error';
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
}

interface FileSystemState {
  selectedFolder: string | null;
  allFiles: FileData[];
  displayedFiles: FileData[];
  expandedNodes: Record<string, boolean>;
  processingStatus: ProcessingStatus;
  appInitialized: boolean;
  isLoadingCancellable: boolean;
}

interface FileSystemActions {
  setSelectedFolder: (folder: string | null) => void;
  setAllFiles: (files: FileData[] | ((prev: FileData[]) => FileData[])) => void;
  setDisplayedFiles: (files: FileData[]) => void;
  updateFile: (path: string, updates: Partial<FileData>) => void;
  toggleExpanded: (path: string) => void;
  setExpandedNodes: (nodes: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  setProcessingStatus: (status: ProcessingStatus) => void;
  setAppInitialized: (initialized: boolean) => void;
  setIsLoadingCancellable: (cancellable: boolean) => void;
  resetFolderState: () => void;
}

export const useFileSystemStore = create<FileSystemState & FileSystemActions>((set) => ({
  selectedFolder: null,
  allFiles: [],
  displayedFiles: [],
  expandedNodes: {},
  processingStatus: { status: 'idle', message: '', processed: 0, directories: 0, total: 0 },
  appInitialized: false,
  isLoadingCancellable: false,

  setSelectedFolder: (folder) => set({ selectedFolder: folder }),

  setAllFiles: (files) => set((s) => ({ 
    allFiles: typeof files === 'function' ? files(s.allFiles) : files 
  })),

  setDisplayedFiles: (files) => set({ displayedFiles: files }),

  updateFile: (path, updates) => set((s) => ({
    allFiles: s.allFiles.map((f) => (f.path === path ? { ...f, ...updates } : f)),
  })),

  toggleExpanded: (path) => set((s) => {
    const next = { ...s.expandedNodes };
    if (next[path]) {
      delete next[path];
    } else {
      next[path] = true;
    }
    return { expandedNodes: next };
  }),

  setExpandedNodes: (nodes) => set((s) => ({ 
    expandedNodes: typeof nodes === 'function' ? nodes(s.expandedNodes) : nodes 
  })),

  setProcessingStatus: (status) => set({ processingStatus: status }),

  setAppInitialized: (initialized) => set({ appInitialized: initialized }),

  setIsLoadingCancellable: (cancellable) => set({ isLoadingCancellable: cancellable }),

  resetFolderState: () => set({
    selectedFolder: null,
    allFiles: [],
    displayedFiles: [],
    expandedNodes: {},
    processingStatus: { status: 'idle', message: '', processed: 0, directories: 0, total: 0 },
    isLoadingCancellable: false,
  }),
}));
