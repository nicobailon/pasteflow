import { ChevronRight, Eye, File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, memo, useMemo, useCallback } from "react";

import { debounce } from "../utils/debounce";

import { TreeItemProps, TreeNode, SelectedFileWithLines } from "../types/file-types";

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
  handleToggle: (e: React.MouseEvent | React.KeyboardEvent, toggleExpanded: (id: string) => void, id: string) => {
    e.stopPropagation();
    toggleExpanded(id);
  },
  
  handleItemClick: (
    type: "file" | "directory", 
    toggleExpanded: (id: string) => void, 
    id: string
  ) => {
    if (type === "directory") {
      toggleExpanded(id);
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
    toggleFolderSelection: (path: string, isChecked: boolean) => void, 
    path: string,
    loadFileContent?: (filePath: string) => Promise<void>
  ) => {
    e.stopPropagation();
    if (type === "file") {
      toggleFileSelection(path);
      // If this is a newly checked file, load its content
      if (e.target.checked && loadFileContent) {
        loadFileContent(path);
      }
    } else if (type === "directory") {
      toggleFolderSelection(path, e.target.checked);
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
  selectedFile?: SelectedFileWithLines;
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
  isLoading: boolean;
  isDisabled: boolean;
  isExcludedByDefault: boolean;
  fileData?: TreeNode['fileData'];
  tokenCount?: number;
}

const TreeItemMetadata = ({
  type,
  isLoading,
  isDisabled,
  isExcludedByDefault,
  fileData,
  tokenCount
}: TreeItemMetadataProps) => {
  const getTokenCountDisplay = () => {
    if (isLoading || fileData?.isCountingTokens) return "Counting...";
    if (tokenCount) return `(~${tokenCount.toLocaleString()})`;
    if (fileData?.tokenCount) return `(~${fileData.tokenCount.toLocaleString()})`;
    if (fileData?.isContentLoaded && fileData.isBinary) return "(binary)";
    return null;
  };

  const tokenDisplay = type === "file" ? getTokenCountDisplay() : null;
  const disabledBadgeText = fileData?.isBinary ? "Binary" : "Skipped";

  return (
    <>
      {tokenDisplay && (
        <span className="tree-item-tokens">{tokenDisplay}</span>
      )}
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
    return prevFileData.tokenCount !== nextFileData.tokenCount ||
           prevFileData.isCountingTokens !== nextFileData.isCountingTokens ||
           prevFileData.isContentLoaded !== nextFileData.isContentLoaded ||
           prevFileData.isBinary !== nextFileData.isBinary ||
           prevFileData.isSkipped !== nextFileData.isSkipped;
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
  return !(prevProps.node.type === 'file' && 
           hasFileDataChanged(prevProps.node.fileData, nextProps.node.fileData));
};

// Helper function to get tree item state
const getTreeItemState = (
  node: TreeNode,
  selectedFiles: SelectedFileWithLines[]
) => {
  const { path, type, fileData } = node;
  const selectedFile = selectedFiles.find(f => f.path === path);
  const isSelected = !!selectedFile;
  const isPartiallySelected = isSelected && !!selectedFile?.lines?.length;
  const isDisabled = fileData ? fileData.isBinary || fileData.isSkipped : false;
  const isDirectorySelected = type === "directory" ? isNodeFullySelected(node, selectedFiles) : false;
  const isDirectoryPartiallySelected = type === "directory" ? isNodePartiallySelected(node, selectedFiles) : false;
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
  selectedFiles: SelectedFileWithLines[],
  loadFileContent?: (filePath: string) => Promise<void>
) => {
  const { fileData, type, path } = node;
  const [isLoading, setIsLoading] = useState(false);
  const [localTokenCount, setLocalTokenCount] = useState(fileData?.tokenCount);

  // Get computed state
  const state = getTreeItemState(node, selectedFiles);

  // Update token count when fileData changes
  useEffect(() => {
    if (fileData?.tokenCount && fileData.tokenCount !== localTokenCount) {
      setLocalTokenCount(fileData.tokenCount);
    }
  }, [fileData?.tokenCount, localTokenCount]);

  // Handle file content loading
  useEffect(() => {
    if (isLoading || fileData?.isContentLoaded || type !== "file" || 
        !state.isSelected || !fileData || state.isDisabled || !loadFileContent) {
      return;
    }

    setIsLoading(true);
    
    loadFileContent(path)
      .then(() => {
        if (fileData.tokenCount) {
          setLocalTokenCount(fileData.tokenCount);
        }
      })
      .catch((error) => {
        console.warn(`Failed to load content for ${path}:`, error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [type, state.isSelected, path, fileData, state.isDisabled, isLoading, loadFileContent]);

  return {
    ...state,
    isLoading,
    localTokenCount
  };
};

const TreeItem = memo(({
  node,
  selectedFiles,
  toggleFileSelection,
  toggleFolderSelection,
  toggleExpanded,
  onViewFile,
  loadFileContent
}: TreeItemProps) => {
  const { id, name, path, type, level, isExpanded, fileData } = node;
  const state = useTreeItemState(node, selectedFiles, loadFileContent);

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
      type, toggleExpanded, id
    );
  };

  const handleTreeItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleTreeItemClick();
    }
  };

  // Create debounced toggle function
  const debouncedToggle = useMemo(
    () => debounce((filePath: unknown) => {
      if (typeof filePath === 'string') {
        toggleFileSelection(filePath);
        if (!fileData?.isContentLoaded && type === "file" && loadFileContent) {
          loadFileContent(filePath);
        }
      }
    }, 100),
    [toggleFileSelection, loadFileContent, fileData?.isContentLoaded, type]
  );

  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    e.stopPropagation();
    if (type === "file") {
      debouncedToggle(path);
    } else if (type === "directory") {
      toggleFolderSelection(path, e.target.checked);
    }
  }, [type, path, debouncedToggle, toggleFolderSelection]);

  const handleToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    handleTreeItemActions.handleToggle(e, toggleExpanded, id);
  };

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
      onClick={type === "directory" ? handleTreeItemClick : (e) => e.stopPropagation()}
      onKeyDown={type === "directory" ? handleTreeItemKeyDown : (e) => e.stopPropagation()}
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
        isLoading={state.isLoading}
        isDisabled={state.isDisabled}
        isExcludedByDefault={state.isExcludedByDefault}
        fileData={fileData}
        tokenCount={state.localTokenCount}
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

export default TreeItem;