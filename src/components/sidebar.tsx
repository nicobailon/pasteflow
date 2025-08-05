import { ChevronDown, ChevronUp, Filter, Folder, FolderOpen, RefreshCw, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { STORAGE_KEYS } from '../constants';
import useFileTree from "../hooks/use-file-tree";
import { SidebarProps, TreeNode } from "../types/file-types";

import VirtualizedTree, { VirtualizedTreeHandle } from "./virtualized-tree";
import Dropdown, { DropdownOption, DropdownRef } from './dropdown';
import SearchBar from "./search-bar";

// Custom type for resize events
type ResizeMouseEvent = {
  preventDefault: () => void;
  clientX: number;
};

export interface SidebarRef {
  closeSortDropdown: () => void;
}

const Sidebar = forwardRef<SidebarRef, SidebarProps>(
  ({
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
    onFileTreeSortChange = () => {/* Default handler - no operation */},
    toggleFilterModal = () => {/* Default handler - no operation */},
    refreshFileTree = () => {/* Default handler - no operation */},
    onViewFile,
    processingStatus,
    loadFileContent,
    folderSelectionCache,
  }: SidebarProps, ref) => {
  // State for the sidebar width and resizing
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [treeHeight, setTreeHeight] = useState(600);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<VirtualizedTreeHandle>(null);
  const sortDropdownRef = useRef<DropdownRef>(null);
  
  // Get the current file tree sort order from localStorage
  const [currentSortOption, setCurrentSortOption] = useState(
    localStorage.getItem(STORAGE_KEYS.FILE_TREE_SORT_ORDER) || 'default'
  );

  // Use the custom hook for file tree management
  const { fileTree, visibleTree, isTreeBuildingComplete, treeProgress } = useFileTree({
    allFiles,
    selectedFolder,
    expandedNodes,
    searchTerm,
    fileTreeSortOrder: currentSortOption
  });
  
  // Pass tree progress to parent if available
  useEffect(() => {
    if (processingStatus?.status === 'processing' && treeProgress < 100) {
      // The tree is building, but we can't directly modify processingStatus here
      // This would need to be handled by the parent component
    }
  }, [treeProgress, processingStatus]);
  
  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    closeSortDropdown: () => sortDropdownRef.current?.close()
  }), []);

  // Min and max width constraints
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 500;

  const [isTreeLoading, setIsTreeLoading] = useState(false);
  const loadingTimerRef = useRef<number | null>(null);
  
  // Consolidated loading state that takes into account both processing status and tree building
  const showLoadingIndicator = isTreeLoading || !isTreeBuildingComplete;
  
  // Wrapper functions to adapt prop signatures for VirtualizedTree
  const handleToggleFolderSelection = useCallback((path: string, isSelected: boolean, opts?: { optimistic?: boolean }) => {
    // Pass through to the original toggleFolderSelection
    toggleFolderSelection(path, isSelected, opts);
  }, [toggleFolderSelection]);
  
  const handleLoadFileContent = useCallback(async (path: string): Promise<void> => {
    // VirtualizedTree expects Promise<void>
    if (loadFileContent) {
      await loadFileContent(path);
    }
  }, [loadFileContent]);
  
  /**
   * Initiates the sidebar resizing operation.
   * Sets the isResizing state to true when the user starts dragging the resize handle.
   * 
   * @param {ResizeMouseEvent} e - The mouse event that triggered the resize operation
   */
  const handleResizeStart = (e: ResizeMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Handle resize effect
  useEffect(() => {
    /**
     * Handles the resizing of the sidebar during mouse movement.
     * Updates the sidebar width based on mouse position, within min/max constraints.
     * 
     * @param {globalThis.MouseEvent} e - The mouse move event
     */
    const handleResize = (e: globalThis.MouseEvent) => {
      if (isResizing) {
        // Calculate width from the right side of the window instead of from the left
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
          setSidebarWidth(newWidth);
        }
      }
    };

    /**
     * Completes the sidebar resizing operation.
     * Sets the isResizing state to false when the user releases the mouse button.
     */
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

  // Handle loading state with minimum display time
  useEffect(() => {
    // Start loading if processing status is "processing" or tree isn't built yet
    if ((processingStatus && processingStatus.status === "processing") || !isTreeBuildingComplete) {
      setIsTreeLoading(true);
      
      // Clear any existing timer
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    } else if (processingStatus && processingStatus.status !== "processing" && isTreeBuildingComplete && isTreeLoading) {
      // Ensure loading spinner stays visible for at least 800ms to avoid flickering
      const timerId = window.setTimeout(() => {
        setIsTreeLoading(false);
        loadingTimerRef.current = null;
      }, 800);
      
      loadingTimerRef.current = timerId;
    }
    
    return () => {
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current);
      }
    };
  }, [processingStatus, isTreeLoading, isTreeBuildingComplete]);
  
  // Handle tree container resize
  useEffect(() => {
    if (!treeContainerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTreeHeight(entry.contentRect.height);
      }
    });
    
    resizeObserver.observe(treeContainerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // All the tree management logic is now handled by the useFileTree hook

  // Check if all files are selected (memoized)
  const areAllFilesSelected = useCallback(() => {
    return allFiles.length > 0 && selectedFiles.length === allFiles.length;
  }, [allFiles.length, selectedFiles.length])();

  /**
   * Handles the toggle of the "Select All" checkbox.
   * Calls selectAllFiles when checked and deselectAllFiles when unchecked.
   * 
   * @param {any} e - The change event from the checkbox
   */
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
      
      for (const node of nodes) {
        if (node.type === "directory") {
          result.push(node.id);
          if (node.children) {
            result = [...result, ...getAllDirectoryNodes(node.children)];
          }
        }
      }
      
      return result;
    };

    // Collapse all directory nodes
    const allDirectories = getAllDirectoryNodes(fileTree);
    
    for (const nodeId of allDirectories) {
      // Only toggle expanded nodes - since toggleExpanded toggles the state
      // we only want to call it for nodes that are currently expanded
      if (expandedNodes[nodeId] === true) {
        toggleExpanded(nodeId);
      }
    }
  }, [fileTree, expandedNodes, toggleExpanded]);

  // Function to expand all folders
  const expandAllFolders = useCallback(() => {
    // Get all directory nodes that are not expanded
    const getCollapsedDirectoryNodes = (nodes: TreeNode[]): string[] => {
      let result: string[] = [];
      
      for (const node of nodes) {
        if (node.type === "directory") {
          if (!expandedNodes[node.id]) {
            result.push(node.id);
          }
          if (node.children) {
            result = [...result, ...getCollapsedDirectoryNodes(node.children)];
          }
        }
      }
      
      return result;
    };

    // Expand all collapsed directory nodes
    const collapsedDirectories = getCollapsedDirectoryNodes(fileTree);
    
    for (const nodeId of collapsedDirectories) {
      // Only toggle collapsed nodes - since toggleExpanded toggles the state
      // we only want to call it for nodes that are currently collapsed
      // This means nodes where expandedNodes[nodeId] is either false or undefined
      if (expandedNodes[nodeId] !== true) {
        toggleExpanded(nodeId);
      }
    }
  }, [fileTree, expandedNodes, toggleExpanded]);

  // Check if there are any expanded folders
  const hasExpandedFolders = useCallback(() => {
    return Object.values(expandedNodes).some(Boolean);
  }, [expandedNodes]);

  // Check if all folders are expanded
  const areAllFoldersExpanded = useCallback(() => {
    // Get all directory nodes
    const getAllDirectoryIds = (nodes: TreeNode[]): string[] => {
      let result: string[] = [];
      
      for (const node of nodes) {
        if (node.type === "directory") {
          result.push(node.id);
          if (node.children) {
            result = [...result, ...getAllDirectoryIds(node.children)];
          }
        }
      }
      
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
    // Use the resetFolderState function if available, otherwise fall back to openFolder
    if (resetFolderState) {
      resetFolderState();
    } else if (openFolder) {
      // Legacy fallback - this will open a new folder dialog
      openFolder();
    }
  }, [openFolder, resetFolderState]);
  
  /**
   * Handles changes to the file tree sort option.
   * Updates the local sort state and propagates the change to the parent component.
   * 
   * @param {string} sortOption - The selected sort option
   */
  const handleFileTreeSortChange = useCallback((sortOption: string) => {
    setCurrentSortOption(sortOption);
    onFileTreeSortChange(sortOption);
  }, [onFileTreeSortChange]);
  
  /**
   * Toggles the visibility of the filter modal.
   * Delegates to the parent component's toggleFilterModal function.
   */
  const handleToggleFilterModal = useCallback(() => {
    // Close the sort dropdown before opening modal
    sortDropdownRef.current?.close();
    toggleFilterModal();
  }, [toggleFilterModal]);
  
  /**
   * Refreshes the file tree and resets sorting and selection state.
   * Resets sort to default, deselects all files, and triggers a refresh.
   */
  const handleRefreshFileTree = useCallback(() => {
    // Reset sort to "Developer" option
    setCurrentSortOption('default');
    localStorage.setItem(STORAGE_KEYS.FILE_TREE_SORT_ORDER, 'default');
    
    // Deselect all files
    deselectAllFiles();
    
    // Refresh the file tree
    refreshFileTree();
    
    // Notify about sort change
    onFileTreeSortChange('default');
  }, [refreshFileTree, deselectAllFiles, onFileTreeSortChange]);

  // Define sort options for the dropdown
  const sortOptions: DropdownOption[] = [
    { value: 'default', label: 'Developer-Focused', icon: <span>↕</span> },
    { value: 'name-asc', label: 'Name (A–Z)', icon: <span>↑</span> },
    { value: 'name-desc', label: 'Name (Z–A)', icon: <span>↓</span> },
    { value: 'extension-asc', label: 'Extension (A–Z)', icon: <span>↑</span> },
    { value: 'extension-desc', label: 'Extension (Z–A)', icon: <span>↓</span> },
    { value: 'date-desc', label: 'Date Modified (Newest)', icon: <span>↓</span> },
    { value: 'date-asc', label: 'Date Modified (Oldest)', icon: <span>↑</span> },
  ];

  return (
    <div className="sidebar" style={{ width: `${sidebarWidth}px` }}>
      <div className="sidebar-buttons">
        <Dropdown
          ref={sortDropdownRef}
          options={sortOptions}
          value={currentSortOption}
          onChange={handleFileTreeSortChange}
          buttonLabel="Sort"
          buttonIcon={<ChevronDown size={16} />}
          containerClassName="sort-dropdown-container sort-dropdown-container-file-tree"
          buttonClassName="sidebar-button sort-dropdown-button"
          menuClassName="sort-dropdown-file-tree"
        />
        <button onClick={handleToggleFilterModal} className="sidebar-button filter-button" title="Filters">
          <Filter size={16} />
        </button>
        <button onClick={handleRefreshFileTree} className="sidebar-button" title="Refresh">
          <RefreshCw size={16} />
        </button>
        <button onClick={openFolder} className="sidebar-button" title="Open Folder">
          <FolderOpen size={16} />
        </button>
      </div>
      <div className="sidebar-search">
        <SearchBar
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          placeholder="Search files..."
        />
      </div>

      {allFiles.length > 0 ? (
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
                  onClick={() => collapseAllFolders()}
                  title="Collapse all folders"
                  disabled={!hasExpandedFolders()}
                >
                  <ChevronUp size={16} />
                </button>
                <button 
                  className="folder-action-btn" 
                  onClick={() => expandAllFolders()}
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
          
          <div className="tree-view" ref={treeContainerRef}>
            {showLoadingIndicator ? (
              <div className="tree-loading">
                <div className="spinner"></div>
                <span>Building file tree...</span>
                {treeProgress !== undefined && treeProgress < 100 && (
                  <div className="tree-progress">
                    <div className="progress-bar-container">
                      <div 
                        className="progress-bar" 
                        style={{ width: `${treeProgress}%` }}
                      />
                    </div>
                    <span className="progress-text">{Math.round(treeProgress)}%</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                {visibleTree.length > 0 ? (
                  <VirtualizedTree
                    ref={virtualListRef}
                    visibleTree={visibleTree}
                    selectedFiles={selectedFiles}
                    toggleFileSelection={toggleFileSelection}
                    toggleFolderSelection={handleToggleFolderSelection}
                    toggleExpanded={toggleExpanded}
                    onViewFile={onViewFile}
                    loadFileContent={handleLoadFileContent}
                    height={treeHeight}
                    folderSelectionCache={folderSelectionCache}
                  />
                ) : (
                  <div className="no-results">
                    <span>No files found.</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="tree-empty">No files found in this folder.</div>
      )}

      <button
        className="sidebar-resize-handle"
        onMouseDown={handleResizeStart}
        aria-label="Resize sidebar"
        title="Drag to resize sidebar"
      ></button>
    </div>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
