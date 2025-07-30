import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction, ReactNode, FC } from 'react';

import { WorkspaceState } from '../types/file-types';

export type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

export interface WorkspaceStateType {
  currentWorkspace: string | null;
  pendingWorkspaceData: PendingWorkspaceData | null;
}

export interface WorkspaceContextType extends WorkspaceStateType {
  setCurrentWorkspace: Dispatch<SetStateAction<string | null>>;
  setPendingWorkspaceData: Dispatch<SetStateAction<PendingWorkspaceData | null>>;
  saveWorkspace: (name: string) => void;
  loadWorkspace: (name: string) => void;
  saveCurrentWorkspace: () => void;
  applyWorkspaceData: (workspaceName: string | null, workspaceData: WorkspaceState | null, applyImmediately?: boolean) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

interface WorkspaceProviderProps {
  children: ReactNode;
  currentWorkspace?: string | null;
  pendingWorkspaceData?: PendingWorkspaceData | null;
}

export const WorkspaceProvider: FC<WorkspaceProviderProps> = ({
  children,
  currentWorkspace = null,
  pendingWorkspaceData = null,
}) => {
  const value: WorkspaceContextType = {
    currentWorkspace,
    pendingWorkspaceData,
    setCurrentWorkspace: () => {},
    setPendingWorkspaceData: () => {},
    saveWorkspace: () => {},
    loadWorkspace: () => {},
    saveCurrentWorkspace: () => {},
    applyWorkspaceData: () => {},
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspaceContext = (): WorkspaceContextType => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider');
  }
  return context;
};