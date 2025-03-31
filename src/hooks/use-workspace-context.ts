import { useContext } from 'react';

import { WorkspaceContext, WorkspaceContextType } from '../context/workspace-context';

export const useWorkspaceContext = (): WorkspaceContextType => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider');
  }
  return context;
}; 