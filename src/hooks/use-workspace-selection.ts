import { useState, useCallback } from 'react';

interface UseWorkspaceSelectionOptions {
  workspaceNames: string[];
  onDelete: (name: string) => void;
  onRefresh: () => void;
}

interface UseWorkspaceSelectionReturn {
  selectedWorkspaces: Set<string>;
  selectAllChecked: boolean;
  handleToggleWorkspace: (name: string) => void;
  handleSelectAll: () => void;
  handleBulkDelete: () => void;
  clearSelection: () => void;
}

export const useWorkspaceSelection = ({
  workspaceNames,
  onDelete,
  onRefresh
}: UseWorkspaceSelectionOptions): UseWorkspaceSelectionReturn => {
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set());
  const [selectAllChecked, setSelectAllChecked] = useState(false);

  const handleToggleWorkspace = useCallback((workspaceName: string) => {
    setSelectedWorkspaces((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(workspaceName)) {
        newSet.delete(workspaceName);
      } else {
        newSet.add(workspaceName);
      }
      // Update select all state based on selection
      setSelectAllChecked(newSet.size === workspaceNames.length && workspaceNames.length > 0);
      return newSet;
    });
  }, [workspaceNames]);

  const handleSelectAll = useCallback(() => {
    if (selectAllChecked) {
      // Unselect all
      setSelectedWorkspaces(new Set());
      setSelectAllChecked(false);
    } else {
      // Select all
      setSelectedWorkspaces(new Set(workspaceNames));
      setSelectAllChecked(true);
    }
  }, [selectAllChecked, workspaceNames]);

  const handleBulkDelete = useCallback(() => {
    const count = selectedWorkspaces.size;
    if (count === 0) return;

    const message = count === 1 
      ? `Are you sure you want to delete 1 workspace? This cannot be undone.`
      : `Are you sure you want to delete ${count} workspaces? This cannot be undone.`;

    if (window.confirm(message)) {
      for (const wsName of selectedWorkspaces) {
        onDelete(wsName);
      }
      setSelectedWorkspaces(new Set());
      setSelectAllChecked(false);
      onRefresh();
    }
  }, [selectedWorkspaces, onDelete, onRefresh]);

  const clearSelection = useCallback(() => {
    setSelectedWorkspaces(new Set());
    setSelectAllChecked(false);
  }, []);

  return {
    selectedWorkspaces,
    selectAllChecked,
    handleToggleWorkspace,
    handleSelectAll,
    handleBulkDelete,
    clearSelection
  };
};