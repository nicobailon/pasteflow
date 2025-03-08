import React, { useState, useEffect, useCallback } from "react";
import { SidebarProps, TreeNode } from "../types/FileTypes";
import useFileTree from "../hooks/useFileTree";
import SearchBar from "./SearchBar";
import TreeItem from "./TreeItem";
import { Folder, ChevronDown, ChevronUp, X, FolderOpen } from "lucide-react";

// Storage keys for local storage
const STORAGE_KEYS = {
  EXPANDED_NODES: "pasteflow_expanded_nodes",
};

// Custom type for resize events
type ResizeMouseEvent = {
  preventDefault: () => void;
  clientX: number;
};

const Sidebar = ({
  selectedFolder,
  openFolder,
  allFiles,
  selectedFiles,
  toggleFileSelection,
  toggleFolderSelection,
  searchTerm,
  onSearchChange,
  selectAllFiles,
  deselectAllFiles,
  expandedNodes,
  toggleExpanded,
  resetFolderState,
}: SidebarProps) => {
  // Use the custom hook for file tree management
  const { fileTree, visibleTree, isTreeBuildingComplete } = useFileTree({
    allFiles,
    selectedFolder,
    expandedNodes,
    searchTerm
  });
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);

  // Min and max width constraints
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 500;

  // Handle mouse down for resizing
  const handleResizeStart = (e: ResizeMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Handle resize effect
  useEffect(() => {
    const handleResize = (e: globalThis.MouseEvent) => {
      if (isResizing) {
        const newWidth = e.clientX;
        if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
          setSidebarWidth(newWidth);
        }
      }
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", handleResizeEnd);

    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [isResizing]);

  // All the tree management logic is now handled by the useFileTree hook

  // Check if all files are selected (memoized)
  const areAllFilesSelected = useCallback(() => {
    return allFiles.length > 0 && selectedFiles.length === allFiles.length;
  }, [allFiles.length, selectedFiles.length])();

  // Handle checkbox change for selectAll/deselectAll
  const handleSelectAllToggle = (e: any) => {
    if (e.target.checked) {
      selectAllFiles();
    } else {
      deselectAllFiles();
    }
  };

  // Function to close all expanded folders
  const collapseAllFolders = useCallback(() => {
    // Get all directory nodes from the file tree
    const getAllDirectoryNodes = (nodes: TreeNode[]): string[] => {
      let result: string[] = [];
      
      nodes.forEach(node => {
        if (node.type === "directory") {
          result.push(node.id);
          if (node.children) {
            result = [...result, ...getAllDirectoryNodes(node.children)];
          }
        }
      });
      
      return result;
    };

    // Collapse all directory nodes
    const allDirectories = getAllDirectoryNodes(fileTree);
    allDirectories.forEach(nodeId => {
      if (expandedNodes[nodeId]) {
        toggleExpanded(nodeId);
      }
    });
  }, [fileTree, expandedNodes, toggleExpanded]);

  // Function to expand all folders
  const expandAllFolders = useCallback(() => {
    // Get all directory nodes that are not expanded
    const getCollapsedDirectoryNodes = (nodes: TreeNode[]): string[] => {
      let result: string[] = [];
      
      nodes.forEach(node => {
        if (node.type === "directory") {
          if (!expandedNodes[node.id]) {
            result.push(node.id);
          }
          if (node.children) {
            result = [...result, ...getCollapsedDirectoryNodes(node.children)];
          }
        }
      });
      
      return result;
    };

    // Expand all collapsed directory nodes
    const collapsedDirectories = getCollapsedDirectoryNodes(fileTree);
    collapsedDirectories.forEach(nodeId => {
      toggleExpanded(nodeId);
    });
  }, [fileTree, expandedNodes, toggleExpanded]);

  // Check if there are any expanded folders
  const hasExpandedFolders = useCallback(() => {
    return Object.values(expandedNodes).some(isExpanded => isExpanded);
  }, [expandedNodes]);

  // Check if all folders are expanded
  const areAllFoldersExpanded = useCallback(() => {
    // Get all directory nodes
    const getAllDirectoryIds = (nodes: TreeNode[]): string[] => {
      let result: string[] = [];
      
      nodes.forEach(node => {
        if (node.type === "directory") {
          result.push(node.id);
          if (node.children) {
            result = [...result, ...getAllDirectoryIds(node.children)];
          }
        }
      });
      
      return result;
    };

    const allDirectoryIds = getAllDirectoryIds(fileTree);
    
    // If there are no directories, all folders are considered expanded
    if (allDirectoryIds.length === 0) return true;
    
    // Check if all directory nodes are expanded
    return allDirectoryIds.every(id => expandedNodes[id]);
  }, [fileTree, expandedNodes]);

  // Function to close the current folder
  const closeCurrentFolder = useCallback(() => {
    // Reset the fileTree and other relevant state
    setFileTree([]);
    setIsTreeBuildingComplete(false);
    
    // Use the resetFolderState function if available, otherwise fall back to openFolder
    if (resetFolderState) {
      resetFolderState();
    } else if (openFolder) {
      // Legacy fallback - this will open a new folder dialog
      openFolder();
    }
  }, [openFolder, resetFolderState]);

  return (
    <div className="sidebar" style={{ width: `${sidebarWidth}px` }}>
      <div className="sidebar-search">
        <SearchBar
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          placeholder="Search files..."
        />
      </div>

      {allFiles.length > 0 ? (
        isTreeBuildingComplete ? (
          <div className="file-tree">
            {selectedFolder && (
              <div className="folder-header tree-item">
                <div className="folder-header-left">
                  <div className="tree-item-checkbox-container">
                    <input
                      type="checkbox"
                      className="tree-item-checkbox"
                      checked={areAllFilesSelected}
                      onChange={handleSelectAllToggle}
                      title={areAllFilesSelected ? "Deselect all files" : "Select all files"}
                    />
                    <span className="custom-checkbox"></span>
                  </div>
                  <div className="folder-icon">
                    <Folder size={16} />
                  </div>
                  <div className="folder-path tree-item-name" title={selectedFolder}>
                    {selectedFolder.split(/[/\\]/).pop()}
                  </div>
                </div>
                <div className="folder-actions">
                  <button 
                    className="folder-action-btn" 
                    onClick={collapseAllFolders}
                    title="Collapse all folders"
                    disabled={!hasExpandedFolders()}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button 
                    className="folder-action-btn" 
                    onClick={expandAllFolders}
                    title="Expand all folders"
                    disabled={areAllFoldersExpanded()}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button 
                    className="folder-action-btn" 
                    onClick={closeCurrentFolder}
                    title="Close folder"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}
            
            {visibleTree.length > 0 ? (
              visibleTree.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedFiles={selectedFiles}
                  toggleFileSelection={toggleFileSelection}
                  toggleFolderSelection={toggleFolderSelection}
                  toggleExpanded={toggleExpanded}
                />
              ))
            ) : (
              <div className="tree-empty">No files match your search.</div>
            )}
          </div>
        ) : (
          <div className="tree-loading">
            <div className="spinner"></div>
            <span>Building file tree...</span>
          </div>
        )
      ) : (
        <div className="tree-empty">No files found in this folder.</div>
      )}

      <div
        className="sidebar-resize-handle"
        onMouseDown={handleResizeStart}
        title="Drag to resize sidebar"
      ></div>
    </div>
  );
};

export default Sidebar;