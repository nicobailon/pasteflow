import { WorkspaceState } from '../types/FileTypes';

export const serializeWorkspace = (state: WorkspaceState): string => {
  return JSON.stringify(state);
};

export const deserializeWorkspace = (data: string): WorkspaceState => {
  return JSON.parse(data) as WorkspaceState;
}; 