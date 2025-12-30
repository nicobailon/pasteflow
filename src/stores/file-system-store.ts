import { create } from 'zustand';

import type { FileData, FileTreeMode } from '../types/file-types';

interface ProcessingStatus {
  status: 'idle' | 'loading' | 'processing' | 'counting' | 'complete' | 'cancelled';
  message: string;
  progress?: number;
}

interface FileSystemState {
  selectedFolder: string | null;
  allFiles: FileData[];
  displayedFiles: FileData[];
  expandedNodes: Set<string>;
  fileTreeMode: FileTreeMode;
  exclusionPatterns: string[];
  processingStatus: ProcessingStatus;
  appInitialized: boolean;
  isLoadingCancellable: boolean;
}

interface FileSystemActions {
  setSelectedFolder: (folder: string | null) => void;
  setAllFiles: (files: FileData[]) => void;
  setDisplayedFiles: (files: FileData[]) => void;
  updateFile: (path: string, updates: Partial<FileData>) => void;
  toggleExpanded: (path: string) => void;
  setExpandedNodes: (nodes: Set<string>) => void;
  setFileTreeMode: (mode: FileTreeMode) => void;
  setExclusionPatterns: (patterns: string[]) => void;
  setProcessingStatus: (status: ProcessingStatus) => void;
  setAppInitialized: (initialized: boolean) => void;
  setIsLoadingCancellable: (cancellable: boolean) => void;
  resetFolderState: () => void;
}

const defaultExclusionPatterns = [
  '**/node_modules/',
  '**/.npm/',
  '**/__pycache__/',
  '**/.pytest_cache/',
  '**/.mypy_cache/',
  '**/.gradle/',
  '**/.nuget/',
  '**/.cargo/',
  '**/.stack-work/',
  '**/.ccache/',
  '**/.idea/',
  '**/.vscode/',
  '**/*.swp',
  '**/*~',
  '**/*.tmp',
  '**/*.temp',
  '**/*.bak',
  '**/*.meta',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/poetry.lock',
  '**/Pipfile.lock',
  '**/.git/',
  '**/build/',
  '**/dist/',
  '**/.next/',
  '**/.nuxt/',
  '**/.svelte-kit/',
  '**/coverage/',
  '**/vendor/',
  '**/target/',
  '**/bin/',
  '**/obj/',
];

export const useFileSystemStore = create<FileSystemState & FileSystemActions>((set) => ({
  selectedFolder: null,
  allFiles: [],
  displayedFiles: [],
  expandedNodes: new Set(),
  fileTreeMode: 'none',
  exclusionPatterns: defaultExclusionPatterns,
  processingStatus: { status: 'idle', message: '' },
  appInitialized: false,
  isLoadingCancellable: false,

  setSelectedFolder: (folder) => set({ selectedFolder: folder }),

  setAllFiles: (files) => set({ allFiles: files }),

  setDisplayedFiles: (files) => set({ displayedFiles: files }),

  updateFile: (path, updates) => set((s) => ({
    allFiles: s.allFiles.map((f) => (f.path === path ? { ...f, ...updates } : f)),
  })),

  toggleExpanded: (path) => set((s) => {
    const next = new Set(s.expandedNodes);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    return { expandedNodes: next };
  }),

  setExpandedNodes: (nodes) => set({ expandedNodes: nodes }),

  setFileTreeMode: (mode) => set({ fileTreeMode: mode }),

  setExclusionPatterns: (patterns) => set({ exclusionPatterns: patterns }),

  setProcessingStatus: (status) => set({ processingStatus: status }),

  setAppInitialized: (initialized) => set({ appInitialized: initialized }),

  setIsLoadingCancellable: (cancellable) => set({ isLoadingCancellable: cancellable }),

  resetFolderState: () => set({
    selectedFolder: null,
    allFiles: [],
    displayedFiles: [],
    expandedNodes: new Set(),
    processingStatus: { status: 'idle', message: '' },
    isLoadingCancellable: false,
  }),
}));
