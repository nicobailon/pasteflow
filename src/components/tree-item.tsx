import { ChevronRight, Eye, File, Folder } from "lucide-react";
import { useEffect, useRef } from "react";

import { TreeItemProps, TreeNode } from "../types/file-types";

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
    isDisabled: boolean, 
    toggleExpanded: (id: string) => void, 
    toggleFileSelection: (path: string) => void, 
    id: string, 
    path: string
  ) => {
    if (type === "directory") {
      toggleExpanded(id);
    } else if (type === "file" && !isDisabled) {
      toggleFileSelection(path);
    }
  },
  
  handleFileNameClick: (
    e: React.MouseEvent | React.KeyboardEvent, 
    type: "file" | "directory", 
    isDisabled: boolean, 
    onViewFile: ((path: string) => void) | undefined, 
    path: string
  ) => {
    e.stopPropagation();
    if (type === "file" && !isDisabled && onViewFile) {
      onViewFile(path);
    }
  },
  
  handleCheckboxChange: (
    e: React.ChangeEvent<HTMLInputElement>, 
    type: "file" | "directory", 
    toggleFileSelection: (path: string) => void, 
    toggleFolderSelection: (path: string, isChecked: boolean) => void, 
    path: string
  ) => {
    e.stopPropagation();
    if (type === "file") {
      toggleFileSelection(path);
    } else if (type === "directory") {
      toggleFolderSelection(path, e.target.checked);
    }
  }
};

const TreeItem = ({
  node,
  selectedFiles,
  toggleFileSelection,
  toggleFolderSelection,
  toggleExpanded,
  onViewFile
}: TreeItemProps) => {
  const { id, name, path, type, level, isExpanded, fileData } = node;
  // @ts-expect-error - Typed useRef hook is flagged in strict mode
  const checkboxRef = useRef<HTMLInputElement>(null);

  // Find the selected file (if any) for this node
  const selectedFile = selectedFiles.find(f => f.path === path);
  const isSelected = !!selectedFile;
  const isPartiallySelected = isSelected && selectedFile?.lines && selectedFile.lines.length > 0;

  // Check if file is binary or otherwise unselectable
  const isDisabled = fileData ? fileData.isBinary || fileData.isSkipped : false;

  // For directories, determine if fully or partially selected
  const isDirectorySelected = type === "directory" ? isNodeFullySelected(node, selectedFiles) : false;
  const isDirectoryPartiallySelected = type === "directory" ? isNodePartiallySelected(node, selectedFiles) : false;

  // Check if the file is excluded by default (but still selectable)
  const isExcludedByDefault = fileData?.excludedByDefault || false;
  
  // Extract rendering functions to reduce cognitive complexity
  const renderToggleButton = () => {
    if (type !== "directory") return null;
    
    return (
      <div
        className={`tree-item-toggle ${isExpanded ? "expanded" : ""}`}
        onClick={(e) => handleTreeItemActions.handleToggle(e, toggleExpanded, id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTreeItemActions.handleToggle(e, toggleExpanded, id);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
      >
        <ChevronRight size={16} />
      </div>
    );
  };
  
  // Helper functions to simplify renderItemName
  const getItemClassName = () => {
    return `tree-item-name ${type === "file" && !isDisabled ? "clickable" : ""}`;
  };

  const getItemClickHandler = () => {
    if (type !== "file" || isDisabled) return;
    return (e: React.MouseEvent) => handleTreeItemActions.handleFileNameClick(e, type, isDisabled, onViewFile, path);
  };

  const getItemKeyDownHandler = () => {
    if (type !== "file" || isDisabled) return;
    
    return (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTreeItemActions.handleFileNameClick(e, type, isDisabled, onViewFile, path);
      }
    };
  };

  const getItemTitle = () => {
    if (type !== "file" || isDisabled) return name;
    
    if (isSelected) {
      return `Click to view file. ${formatSelectedLines(selectedFile)}`;
    }
    return "Click to view file";
  };
  
  const renderItemName = () => {
    return (
      <div 
        className={getItemClassName()}
        onClick={getItemClickHandler()}
        onKeyDown={getItemKeyDownHandler()}
        role={type === "file" && !isDisabled ? "button" : undefined}
        tabIndex={type === "file" && !isDisabled ? 0 : undefined}
        title={getItemTitle()}
      >
        {name}
        {isPartiallySelected && (
          <span className="partial-selection-indicator" title={formatSelectedLines(selectedFile)}>
            Partial
          </span>
        )}
      </div>
    );
  };
  
  const renderFileMetadata = () => {
    return (
      <>
        {fileData && fileData.tokenCount > 0 && (
          <span className="tree-item-tokens">
            (~{fileData.tokenCount.toLocaleString()})
          </span>
        )}

        {isDisabled && fileData && (
          <span className="tree-item-badge">
            {fileData.isBinary ? "Binary" : "Skipped"}
          </span>
        )}

        {!isDisabled && isExcludedByDefault && (
          <span className="tree-item-badge excluded">Excluded</span>
        )}
      </>
    );
  };
  
  const renderViewButton = () => {
    if (!(type === "file" && !isDisabled && onViewFile)) return null;
    
    return (
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
    );
  };

  // Update the indeterminate state manually whenever it changes
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isDirectoryPartiallySelected;
    }
  }, [isDirectoryPartiallySelected]);

  return (
    <div
      className={`tree-item ${isSelected ? "selected" : ""} ${isPartiallySelected ? "partially-selected" : ""} ${
        isExcludedByDefault ? "excluded-by-default" : ""
      }`}
      style={{ marginLeft: `${level * 16}px` }}
      onClick={() => handleTreeItemActions.handleItemClick(
        type, isDisabled, toggleExpanded, toggleFileSelection, id, path
      )}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleTreeItemActions.handleItemClick(
            type, isDisabled, toggleExpanded, toggleFileSelection, id, path
          );
        }
      }}
      role="button"
      tabIndex={0}
    >
      {renderToggleButton()}
      {type === "file" && <div className="tree-item-indent"></div>}
      <div className="tree-item-checkbox-container">
        <input
          type="checkbox"
          className="tree-item-checkbox"
          checked={type === "file" ? isSelected : isDirectorySelected}
          ref={checkboxRef}
          onChange={(e) => handleTreeItemActions.handleCheckboxChange(
            e, type, toggleFileSelection, toggleFolderSelection, path
          )}
          disabled={isDisabled}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="custom-checkbox"></span>
      </div>

      <div className="tree-item-content">
        <div className="tree-item-icon">
          {type === "directory" ? <Folder size={16} /> : <File size={16} />}
        </div>

        {renderItemName()}
        {renderFileMetadata()}
        {renderViewButton()}
      </div>
    </div>
  );
};

export default TreeItem;