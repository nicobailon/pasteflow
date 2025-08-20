import { ChevronDown, ChevronUp, Filter, Folder, FolderOpen, RefreshCw, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { STORAGE_KEYS } from '@constants';
import useFileTree from "../hooks/use-file-tree";
import { useSidebarResize } from "../hooks/use-sidebar-resize";
import { useTreeLoadingState } from "../hooks/use-tree-loading-state";
import { useTreeContainerResize } from "../hooks/use-tree-container-resize";
import { useFolderActions } from "../hooks/use-folder-actions";
import { SidebarProps } from "../types/file-types";

import VirtualizedTree, { VirtualizedTreeHandle } from "./virtualized-tree";
import Dropdown, { DropdownRef } from './dropdown';
import SearchBar from "./search-bar";
import { createSortOptions, checkAllFilesSelected } from './sidebar-helpers';
import './sidebar.css';

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
  // Use custom hooks for cleaner logic separation
  const { sidebarWidth, handleResizeStart } = useSidebarResize(300);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<VirtualizedTreeHandle>(null);
  const sortDropdownRef = useRef<DropdownRef>(null);
  const treeHeight = useTreeContainerResize(treeContainerRef);
  
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

  // Use custom hook for loading state management
  const { showLoadingIndicator } = useTreeLoadingState(processingStatus, isTreeBuildingComplete);
  
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
  
  

  // All the tree management logic is now handled by the useFileTree hook

  // Overlay/bulk busy indicator derived from progressive overlay computation
  const isOverlayComputing = !!folderSelectionCache?.isComputing?.();
  const overlayProgress = folderSelectionCache?.getProgress?.() ?? 1;

  // Check if all files are selected (memoized)
  const areAllFilesSelected = useMemo(() => {
    return checkAllFilesSelected(
      folderSelectionCache,
      selectedFolder,
      allFiles.length,
      selectedFiles.length
    );
  }, [allFiles.length, selectedFiles.length, folderSelectionCache, selectedFolder]);

  /**
   * Handles the toggle of the "Select All" checkbox.
   * Uses toggleFolderSelection for the root folder to ensure proper cache updates.
   * 
   * @param {React.ChangeEvent<HTMLInputElement>} e - The change event from the checkbox
   */
  const handleSelectAllToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedFolder) {
      // Use toggleFolderSelection for the root folder to ensure proper cache updates
      toggleFolderSelection(selectedFolder, e.target.checked, { optimistic: true });
    }
  };

  // Use folder actions hook
  const {
    collapseAllFolders,
    expandAllFolders,
    hasExpandedFolders,
    areAllFoldersExpanded,
    closeCurrentFolder: closeFolderAction,
  } = useFolderActions(fileTree, expandedNodes, toggleExpanded);

  const closeCurrentFolder = useCallback(() => {
    closeFolderAction(resetFolderState, openFolder);
  }, [closeFolderAction, resetFolderState, openFolder]);
  
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
   * Refreshes the file tree while preserving selections and current sort.
   */
  const handleRefreshFileTree = useCallback(() => {
    // Do not change sort or selections; just trigger a refresh
    refreshFileTree();
  }, [refreshFileTree]);

  // Define sort options for the dropdown
  const sortOptions = useMemo(() => createSortOptions(), []);

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
                <div className="tree-item-checkbox-container" aria-busy={isOverlayComputing}>
                  <input
                    type="checkbox"
                    className="tree-item-checkbox"
                    checked={areAllFilesSelected}
                    ref={(el) => {
                      if (el && folderSelectionCache && selectedFolder) {
                        const rootFolderState = folderSelectionCache.get(selectedFolder);
                        el.indeterminate = rootFolderState === 'partial';
                      }
                    }}
                    onChange={handleSelectAllToggle}
                    title={areAllFilesSelected ? "Deselect all files" : "Select all files"}
                    disabled={isOverlayComputing}
                  />
                  <span className="custom-checkbox"></span>
                </div>
                <div className="folder-icon">
                  <Folder size={16} />
                </div>
                <div className="folder-path tree-item-name" title={selectedFolder}>
                  {selectedFolder.split(/[/\\]/).pop()}
                  {isOverlayComputing && (
                    <span
                      className="selection-overlay-spinner"
                      aria-label="Updating selection..."
                      title={`Updating selection… ${Math.round(overlayProgress * 100)}%`}
                      style={{ display: 'inline-block', width: 12, height: 12, marginLeft: 8 }}
                    >
                      <div className="spinner" style={{ width: 12, height: 12 }} />
                    </span>
                  )}
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
                    <div 
                      className="progress-bar-container"
                      role="progressbar"
                      aria-valuenow={Math.round(treeProgress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="File tree building progress"
                    >
                      <div 
                        className="progress-bar" 
                        style={{ width: `${treeProgress}%` }}
                      />
                    </div>
                    <span className="progress-text" aria-hidden="true">{Math.round(treeProgress)}%</span>
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
