import { ChevronRight, Eye, File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useRef, memo, useCallback, useMemo } from "react";

import { debounce } from "../utils/debounce";
import { TreeItemProps, TreeNode, SelectedFileReference } from "../types/file-types";
import type { DirectorySelectionCache } from "../utils/selection-cache";

// Helper function to check if a node is fully selected - moved outside component
const isNodeFullySelected = (node: TreeNode, selectedFiles: { path: string; lines?: { start: number; end: number }[] }[]): boolean => {
  const { type, path, fileData, children } = node;
  
  if (type === "file") {
    // Files are selected if they're in the selectedFiles array
    // Non-selectable files (binary/skipped) are ignored
    const isSelectable = !(fileData?.isBinary || fileData?.isSkipped);
    if (!isSelectable) return false;
    
    const nodeSelectedFile = selectedFiles.find(f => f.path === path);
    return !!nodeSelectedFile;
  }
  
  if (type === "directory" && children) {
    return children.length > 0 && children.every(child => isNodeFullySelected(child, selectedFiles));
  }
  
  return false;
};

// Helper function to check if a node is partially selected - moved outside component
const isNodePartiallySelected = (node: TreeNode, selectedFiles: { path: string; lines?: { start: number; end: number }[] }[]): boolean => {
  const { type, path, fileData, children } = node;
  
  if (type === "file") {
    // Files can be partially selected if they have line ranges defined
    const isSelectable = !(fileData?.isBinary || fileData?.isSkipped);
    if (!isSelectable) return false;
    
    const nodeSelectedFile = selectedFiles.find(f => f.path === path);
    return !!nodeSelectedFile && !!nodeSelectedFile.lines && nodeSelectedFile.lines.length > 0;
  }
  
  if (type === "directory" && children) {
    if (children.length === 0) return false;
    
    // If any child is selected or partially selected
    const anySelected = children.some(child => {
      if (child.type === "file") {
        const childFileData = child.fileData;
        const isSelectable = !(childFileData?.isBinary || childFileData?.isSkipped);
        if (!isSelectable) return false;
        
        return selectedFiles.some(f => f.path === child.path);
      }
      return isNodeFullySelected(child, selectedFiles) || isNodePartiallySelected(child, selectedFiles);
    });
    
    // If all children are selected, it's fully selected, not partially
    const allSelected = isNodeFullySelected(node, selectedFiles);
    
    return anySelected && !allSelected;
  }
  
  return false;
};

// Helper function to format line ranges for display in tooltip
const formatSelectedLines = (selectedFile?: { path: string; lines?: { start: number; end: number }[] }): string => {
  if (!selectedFile || !selectedFile.lines || selectedFile.lines.length === 0) {
    return 'Entire file selected';
  }
  
  return selectedFile.lines
    .map(range => range.start === range.end 
      ? `Line ${range.start}` 
      : `Lines ${range.start}-${range.end}`)
    .join(', ');
};

// Handle specific item actions independently to reduce complexity
const handleTreeItemActions = {
  handleToggle: (e: React.MouseEvent | React.KeyboardEvent, toggleExpanded: (path: string, currentState?: boolean) => void, path: string, isExpanded?: boolean) => {
    e.stopPropagation();
    e.preventDefault(); // Also prevent default to avoid any bubbling issues
    toggleExpanded(path, isExpanded);
  },
  
  handleItemClick: (
    type: "file" | "directory", 
    toggleExpanded: (path: string, currentState?: boolean) => void, 
    path: string,
    isExpanded?: boolean
  ) => {
    if (type === "directory") {
      toggleExpanded(path, isExpanded);
    }
    // Removed automatic file selection - files should only be selected via checkbox
  },
  
  handleFileNameClick: (
    e: React.MouseEvent | React.KeyboardEvent, 
    type: "file" | "directory", 
    isDisabled: boolean, 
    onViewFile: ((path: string) => void) | undefined, 
    path: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (type === "file" && !isDisabled && onViewFile) {
      onViewFile(path);
    }
  },
  
  handleCheckboxChange: (
    e: React.ChangeEvent<HTMLInputElement>, 
    type: "file" | "directory", 
    toggleFileSelection: (path: string) => void, 
    toggleFolderSelection: (path: string, isChecked: boolean, opts?: { optimistic?: boolean }) => void, 
    path: string
  ) => {
    e.stopPropagation();
    if (type === "file") {
      toggleFileSelection(path);
    } else if (type === "directory") {
      toggleFolderSelection(path, e.target.checked, { optimistic: true });
    }
  }
};

// Sub-component for the toggle button
interface TreeItemToggleProps {
  isExpanded: boolean;
  onToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

const TreeItemToggle = ({ isExpanded, onToggle }: TreeItemToggleProps) => (
  <div
    className={`tree-item-toggle ${isExpanded ? "expanded" : ""}`}
    onClick={onToggle}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(e);
      }
    }}
    role="button"
    tabIndex={0}
    aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
  >
    <ChevronRight size={16} />
  </div>
);

// Sub-component for the checkbox
interface TreeItemCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const TreeItemCheckbox = ({ 
  checked, 
  indeterminate, 
  disabled, 
  onChange 
}: TreeItemCheckboxProps) => {
  const checkboxRef = useRef(null as HTMLInputElement | null);
  
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <div className="tree-item-checkbox-container">
      <input
        type="checkbox"
        className="tree-item-checkbox"
        checked={checked}
        ref={checkboxRef}
        onChange={onChange}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="custom-checkbox"></span>
    </div>
  );
};

// Sub-component for the file/folder icon
interface TreeItemIconProps {
  type: "file" | "directory";
  isExpanded?: boolean;
}

const TreeItemIcon = ({ type, isExpanded }: TreeItemIconProps) => {
  const icon = type === "directory" 
    ? (isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />)
    : <File size={16} />;
    
  return <div className="tree-item-icon">{icon}</div>;
};

// Sub-component for the item name and badges
interface TreeItemContentProps {
  name: string;
  type: "file" | "directory";
  isDisabled: boolean;
  isPartiallySelected: boolean;
  selectedFile?: SelectedFileReference;
  onNameClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

const TreeItemContent = ({
  name,
  type,
  isDisabled,
  isPartiallySelected,
  selectedFile,
  onNameClick
}: TreeItemContentProps) => {
  const getItemClassName = () => {
    return `tree-item-name ${type === "file" && !isDisabled ? "clickable" : ""}`;
  };

  const getItemTitle = () => {
    if (type !== "file" || isDisabled) return name;
    
    if (selectedFile) {
      return `Click to view file. ${formatSelectedLines(selectedFile)}`;
    }
    return "Click to view file";
  };

  const itemNameProps = {
    className: getItemClassName(),
    onClick: onNameClick,
    onKeyDown: onNameClick ? (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNameClick(e);
      }
    } : undefined,
    role: type === "file" && !isDisabled ? "button" : undefined,
    tabIndex: type === "file" && !isDisabled ? 0 : undefined,
    title: getItemTitle()
  };

  return (
    <div {...itemNameProps}>
      {name}
      {isPartiallySelected && (
        <span className="partial-selection-indicator" title={formatSelectedLines(selectedFile)}>
          Partial
        </span>
      )}
    </div>
  );
};

// Sub-component for metadata badges
interface TreeItemMetadataProps {
  type: "file" | "directory";
  isDisabled: boolean;
  isExcludedByDefault: boolean;
  fileData?: TreeNode['fileData'];
}

const TreeItemMetadata = ({
  type,
  isDisabled,
  isExcludedByDefault,
  fileData
}: TreeItemMetadataProps) => {
  const disabledBadgeText = fileData?.isBinary ? "Binary" : "Skipped";

  return (
    <>
      {isDisabled && fileData && (
        <span className="tree-item-badge">{disabledBadgeText}</span>
      )}
      {!isDisabled && isExcludedByDefault && (
        <span className="tree-item-badge excluded">Excluded</span>
      )}
    </>
  );
};

// Helper function to check if node structure changed
const hasNodeStructureChanged = (prevNode: TreeNode, nextNode: TreeNode): boolean => {
  return prevNode.id !== nextNode.id || 
         prevNode.type !== nextNode.type || 
         prevNode.name !== nextNode.name;
};

// Helper function to check if line selections changed
const hasLineSelectionChanged = (
  prevLines: { start: number; end: number }[] | undefined,
  nextLines: { start: number; end: number }[] | undefined
): boolean => {
  const prev = prevLines || [];
  const next = nextLines || [];
  
  if (prev.length !== next.length) return true;
  
  for (const [i, prevLine] of prev.entries()) {
    if (prevLine.start !== next[i].start || prevLine.end !== next[i].end) {
      return true;
    }
  }
  
  return false;
};

// Helper function to check if selection state changed
const hasSelectionChanged = (
  prevSelected: { path: string; lines?: { start: number; end: number }[] } | undefined,
  nextSelected: { path: string; lines?: { start: number; end: number }[] } | undefined
): boolean => {
  if ((prevSelected && !nextSelected) || (!prevSelected && nextSelected)) return true;
  
  if (prevSelected && nextSelected) {
    return hasLineSelectionChanged(prevSelected.lines, nextSelected.lines);
  }
  
  return false;
};

// Helper function to check if file data changed
const hasFileDataChanged = (
  prevFileData: TreeNode['fileData'],
  nextFileData: TreeNode['fileData']
): boolean => {
  if ((prevFileData && !nextFileData) || (!prevFileData && nextFileData)) return true;
  
  if (prevFileData && nextFileData) {
    // CRITICAL: Check for content loading state transitions first
    const contentTransition = (!prevFileData.content && nextFileData.content) ||
                            (prevFileData.content && !nextFileData.content);
    
    return prevFileData.tokenCount !== nextFileData.tokenCount ||
           prevFileData.isCountingTokens !== nextFileData.isCountingTokens ||
           prevFileData.isContentLoaded !== nextFileData.isContentLoaded ||
           prevFileData.isBinary !== nextFileData.isBinary ||
           prevFileData.isSkipped !== nextFileData.isSkipped ||
           // Enhanced content change detection
           prevFileData.content !== nextFileData.content ||
           contentTransition ||
           // Also check content length changes as a fallback
           (prevFileData.content?.length || 0) !== (nextFileData.content?.length || 0);
  }
  
  return false;
};

// Custom comparison function for memo
const areEqual = (prevProps: TreeItemProps, nextProps: TreeItemProps) => {
  // Check if node structure changed
  if (hasNodeStructureChanged(prevProps.node, nextProps.node)) return false;
  
  // Check if selection state changed for this specific node
  const prevSelected = prevProps.selectedFiles.find(f => f.path === prevProps.node.path);
  const nextSelected = nextProps.selectedFiles.find(f => f.path === nextProps.node.path);
  
  if (hasSelectionChanged(prevSelected, nextSelected)) return false;
  
  // Check if expanded state changed for directories
  if (prevProps.node.type === 'directory' && 
      prevProps.node.isExpanded !== nextProps.node.isExpanded) {
    return false;
  }
  
  // Check if children count changed (affects partial selection state)
  if (prevProps.node.children?.length !== nextProps.node.children?.length) return false;
  
  // Check if fileData changed for files
  if (prevProps.node.type === 'file' && 
      hasFileDataChanged(prevProps.node.fileData, nextProps.node.fileData)) {
    return false;
  }
  
  // Check if folderSelectionCache changed for directories
  if (prevProps.node.type === 'directory' && prevProps.folderSelectionCache && nextProps.folderSelectionCache) {
    const prevCacheState = prevProps.folderSelectionCache.get(prevProps.node.path);
    const nextCacheState = nextProps.folderSelectionCache.get(nextProps.node.path);
    if (prevCacheState !== nextCacheState) return false;
  }
  
  return true;
};

// Helper function to get tree item state
const getTreeItemState = (
  node: TreeNode,
  selectedFiles: SelectedFileReference[],
  folderSelectionCache?: DirectorySelectionCache
) => {
  const { path, type, fileData, level } = node;
  const selectedFile = selectedFiles.find(f => f.path === path);
  const isSelected = !!selectedFile;
  const isPartiallySelected = isSelected && !!selectedFile?.lines?.length;
  const isDisabled = fileData ? fileData.isBinary || fileData.isSkipped : false;
  // Use cache for directory selection state if available
  let isDirectorySelected = false;
  let isDirectoryPartiallySelected = false;
  
  if (type === "directory") {
    if (folderSelectionCache) {
      // For absolute paths, we need to find the relative path from workspace root
      let cacheLookupPath = path;
      if (path.startsWith('/')) {
        // This is an absolute path - need to extract the relative path
        // The folder structure in the cache is like "Users/nicobailon/Documents/development/LibreChat/.devcontainer"
        // But the tree node path is like "/Users/nicobailon/Documents/development/LibreChat/.devcontainer"
        // So we just need to remove the leading slash
        cacheLookupPath = path.slice(1);
      }
      
      const selectionState = folderSelectionCache.get(cacheLookupPath);
      if (level === 0) {
        console.log('[TreeItem] Top-level folder cache check:', { path, cacheLookupPath, selectionState, level });
      }
      isDirectorySelected = selectionState === 'full';
      isDirectoryPartiallySelected = selectionState === 'partial';
    } else {
      // Fallback to recursive calculation if no cache available
      isDirectorySelected = isNodeFullySelected(node, selectedFiles);
      isDirectoryPartiallySelected = isNodePartiallySelected(node, selectedFiles);
    }
  }
  const isExcludedByDefault = fileData?.excludedByDefault || false;

  return {
    selectedFile,
    isSelected,
    isPartiallySelected,
    isDisabled,
    isDirectorySelected,
    isDirectoryPartiallySelected,
    isExcludedByDefault
  };
};

// Custom hook to manage TreeItem state and effects
const useTreeItemState = (
  node: TreeNode,
  selectedFiles: SelectedFileReference[],
  loadFileContent?: (filePath: string) => Promise<void>,
  folderSelectionCache?: DirectorySelectionCache
) => {
  // Get computed state
  const state = getTreeItemState(node, selectedFiles, folderSelectionCache);

  return {
    ...state
  };
};

const TreeItem = memo(({
  node,
  selectedFiles,
  toggleFileSelection,
  toggleFolderSelection,
  toggleExpanded,
  onViewFile,
  loadFileContent,
  folderSelectionCache
}: TreeItemProps) => {
  const { name, path, type, level, isExpanded, fileData } = node;
  const state = useTreeItemState(node, selectedFiles, loadFileContent, folderSelectionCache);

  const getTreeItemClassNames = () => {
    const classes = ['tree-item'];
    if (state.isSelected) classes.push('selected');
    if (state.isPartiallySelected) classes.push('partially-selected');
    if (state.isExcludedByDefault) classes.push('excluded-by-default');
    if (state.isLoading) classes.push('loading');
    return classes.join(' ');
  };

  const handleTreeItemClick = () => {
    handleTreeItemActions.handleItemClick(
      type, toggleExpanded, path, isExpanded
    );
  };

  // Create debounced toggle function - no dependencies on changing state
  const _debouncedToggle = useMemo(
    () => debounce((filePath: unknown) => {
      if (typeof filePath === 'string') {
        toggleFileSelection(filePath);
        // Load content will be triggered by the checkbox handler directly
      }
    }, 100),
    [toggleFileSelection] // Only depend on stable function reference
  );

  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    e.stopPropagation();
    if (type === "file") {
      toggleFileSelection(path);
    } else if (type === "directory") {
      const isChecked = e.target.checked;
      console.log('[TreeItem] Checkbox clicked:', { path, isChecked, level, name });
      // Toggle folder selection with optimistic update for immediate UI feedback
      toggleFolderSelection(path, isChecked, { optimistic: true });
      // Auto-expand folder when checking it
      if (isChecked && !isExpanded) {
        toggleExpanded(path);
      }
    }
  }, [type, path, level, name, toggleFileSelection, toggleFolderSelection, toggleExpanded, isExpanded]);

  const handleToggle = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    // Pass both the path and current expanded state
    handleTreeItemActions.handleToggle(e, toggleExpanded, path, isExpanded);
  }, [toggleExpanded, path, isExpanded]);

  const handleNameClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    handleTreeItemActions.handleFileNameClick(e, type, state.isDisabled, onViewFile, path);
  };

  const checkboxChecked = type === "file" ? state.isSelected : state.isDirectorySelected;
  const shouldShowToggle = type === "directory";
  const shouldShowViewButton = type === "file" && !state.isDisabled && onViewFile;

  return (
    <div
      className={getTreeItemClassNames()}
      style={{ marginLeft: `${level * 16}px` }}
      onClick={(e) => {
        // Stop propagation for all clicks to prevent bubbling issues
        e.stopPropagation();
        
        // Only handle directory clicks if the click target is the tree-item div itself
        // or one of its non-interactive children
        if (type === "directory") {
          const target = e.target as HTMLElement;
          const isInteractiveElement = 
            target.closest('.tree-item-toggle') ||
            target.closest('.tree-item-checkbox-container') ||
            target.closest('.tree-item-view-btn') ||
            target.closest('.tree-item-name.clickable');
          
          if (!isInteractiveElement) {
            handleTreeItemClick();
          }
        }
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (type === "directory" && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleTreeItemClick();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {shouldShowToggle && (
        <TreeItemToggle 
          isExpanded={isExpanded!} 
          onToggle={handleToggle} 
        />
      )}
      {type === "file" && <div className="tree-item-indent"></div>}
      
      <TreeItemCheckbox
        checked={checkboxChecked}
        indeterminate={state.isDirectoryPartiallySelected}
        disabled={state.isDisabled}
        onChange={handleCheckboxChange}
      />
      
      <TreeItemIcon type={type} isExpanded={isExpanded} />
      
      <TreeItemContent
        name={name}
        type={type}
        isDisabled={state.isDisabled}
        isPartiallySelected={state.isPartiallySelected}
        selectedFile={state.selectedFile}
        onNameClick={type === "file" && !state.isDisabled ? handleNameClick : undefined}
      />
      
      <TreeItemMetadata
        type={type}
        isDisabled={state.isDisabled}
        isExcludedByDefault={state.isExcludedByDefault}
        fileData={fileData}
      />
      
      {shouldShowViewButton && (
        <button 
          className="tree-item-view-btn"
          onClick={(e) => {
            e.stopPropagation();
            onViewFile(path);
          }}
          title="View file"
        >
          <Eye size={14} />
        </button>
      )}
    </div>
  );
}, areEqual);

TreeItem.displayName = 'TreeItem';

export default memo(TreeItem);