import useAppState from './useAppState';
import { STORAGE_KEYS } from '../constants.ts';

export const useWorkspaceState = () => {
  const { saveWorkspace, loadWorkspace } = useAppState();

  const deleteWorkspace = (name: string) => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}') as Record<string, string>;
    delete workspaces[name];
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
  };

  const getWorkspaceNames = () => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}') as Record<string, string>;
    return Object.keys(workspaces);
  };

  return { saveWorkspace, loadWorkspace, deleteWorkspace, getWorkspaceNames };
};

export default useWorkspaceState;
