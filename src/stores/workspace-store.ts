import { create } from 'zustand';

type HeaderSaveState = 'idle' | 'saving' | 'success' | 'error';

interface WorkspaceStoreState {
  currentWorkspace: string | null;
  isLoadingWorkspace: boolean;
  isAutoSaveEnabled: boolean;
  headerSaveState: HeaderSaveState;
  lastSavedAt: number | null;
}

interface WorkspaceStoreActions {
  setCurrentWorkspace: (name: string | null) => void;
  setIsLoadingWorkspace: (loading: boolean) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setHeaderSaveState: (state: HeaderSaveState) => void;
  setLastSavedAt: (timestamp: number | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState & WorkspaceStoreActions>((set) => ({
  currentWorkspace: null,
  isLoadingWorkspace: false,
  isAutoSaveEnabled: true,
  headerSaveState: 'idle',
  lastSavedAt: null,

  setCurrentWorkspace: (name) => set({ currentWorkspace: name }),
  setIsLoadingWorkspace: (loading) => set({ isLoadingWorkspace: loading }),
  setAutoSaveEnabled: (enabled) => set({ isAutoSaveEnabled: enabled }),
  setHeaderSaveState: (state) => set({ headerSaveState: state }),
  setLastSavedAt: (timestamp) => set({ lastSavedAt: timestamp }),
}));
