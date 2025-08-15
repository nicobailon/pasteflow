import { useCallback } from 'react';

import { TreeNode } from '../types/file-types';
import {
  getAllDirectoryNodeIds,
  getCollapsedDirectoryNodeIds,
  areAllDirectoriesExpanded,
  hasAnyExpandedFolders,
} from '../utils/tree-node-utils';

export const useFolderActions = (
  fileTree: TreeNode[],
  expandedNodes: Record<string, boolean>,
  toggleExpanded: (nodeId: string) => void
) => {
  const collapseAllFolders = useCallback(() => {
    const allDirectories = getAllDirectoryNodeIds(fileTree);
    for (const nodeId of allDirectories) {
      if (expandedNodes[nodeId] === true) {
        toggleExpanded(nodeId);
      }
    }
  }, [fileTree, expandedNodes, toggleExpanded]);

  const expandAllFolders = useCallback(() => {
    const collapsedDirectories = getCollapsedDirectoryNodeIds(fileTree, expandedNodes);
    for (const nodeId of collapsedDirectories) {
      if (expandedNodes[nodeId] !== true) {
        toggleExpanded(nodeId);
      }
    }
  }, [fileTree, expandedNodes, toggleExpanded]);

  const hasExpandedFolders = useCallback(() => {
    return hasAnyExpandedFolders(expandedNodes);
  }, [expandedNodes]);

  const areAllFoldersExpanded = useCallback(() => {
    return areAllDirectoriesExpanded(fileTree, expandedNodes);
  }, [fileTree, expandedNodes]);

  const closeCurrentFolder = useCallback((
    resetFolderState?: () => void,
    openFolder?: () => void
  ) => {
    if (resetFolderState) {
      resetFolderState();
    } else if (openFolder) {
      openFolder();
    }
  }, []);

  return {
    collapseAllFolders,
    expandAllFolders,
    hasExpandedFolders,
    areAllFoldersExpanded,
    closeCurrentFolder,
  };
};