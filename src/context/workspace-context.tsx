import React, { createContext, useContext } from 'react';

import { WorkspaceState } from '../types/file-types';

export type PendingWorkspaceData = Omit<WorkspaceState, 'selectedFolder'>;

export interface WorkspaceStateType {
  currentWorkspace: string | null;
  pendingWorkspaceData: PendingWorkspaceData | null;
}

export interface WorkspaceContextType extends WorkspaceStateType {
  setCurrentWorkspace: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingWorkspaceData: React.Dispatch<React.SetStateAction<PendingWorkspaceData | null>>;
  saveWorkspace: (name: string) => void;
  loadWorkspace: (name: string) => void;
  saveCurrentWorkspace: () => void;
  applyWorkspaceData: (workspaceName: string | null, workspaceData: WorkspaceState | null, applyImmediately?: boolean) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

interface WorkspaceProviderProps {
  children: React.ReactNode;
  currentWorkspace?: string | null;
  pendingWorkspaceData?: PendingWorkspaceData | null;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
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