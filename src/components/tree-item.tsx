import { ChevronRight, Eye, File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, memo } from "react";

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

// Custom comparison function for memo
const areEqual = (prevProps: TreeItemProps, nextProps: TreeItemProps) => {
  // Always re-render if node structure changes
  if (prevProps.node.id !== nextProps.node.id) return false;
  if (prevProps.node.type !== nextProps.node.type) return false;
  if (prevProps.node.name !== nextProps.node.name) return false;
  
  // Check if selection state changed for this specific node
  const prevSelected = prevProps.selectedFiles.find(f => f.path === prevProps.node.path);
  const nextSelected = nextProps.selectedFiles.find(f => f.path === nextProps.node.path);
  
  if ((prevSelected && !nextSelected) || (!prevSelected && nextSelected)) return false;
  if (prevSelected && nextSelected) {
    // Check if line selections changed
    const prevLines = prevSelected.lines || [];
    const nextLines = nextSelected.lines || [];
    if (prevLines.length !== nextLines.length) return false;
    
    for (let i = 0; i < prevLines.length; i++) {
      if (prevLines[i].start !== nextLines[i].start || prevLines[i].end !== nextLines[i].end) {
        return false;
      }
    }
  }
  
  // Check if expanded state changed for directories
  if (prevProps.node.type === 'directory') {
    const prevExpanded = prevProps.node.isExpanded;
    const nextExpanded = nextProps.node.isExpanded;
    if (prevExpanded !== nextExpanded) return false;
  }
  
  // Check if children count changed (affects partial selection state)
  if (prevProps.node.children?.length !== nextProps.node.children?.length) return false;
  
  // Props are equal enough to skip re-render
  return true;
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
  // @ts-expect-error - Typed useRef hook is flagged in strict mode
  const checkboxRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [localTokenCount, setLocalTokenCount] = useState(fileData?.tokenCount);

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

  // Handle loading content when a file is selected
  useEffect(() => {
    if (type === "file" && isSelected && 
        fileData && !fileData.isContentLoaded && !isDisabled && 
        loadFileContent && !isLoading) {
      setIsLoading(true);
      
      loadFileContent(path).then(() => {
        // The content will be loaded in the allFiles state, but we can update our local token count
        if (fileData.tokenCount) {
          setLocalTokenCount(fileData.tokenCount);
        }
        setIsLoading(false);
      }).catch(() => {
        setIsLoading(false);
      });
    }
  }, [type, isSelected, fileData, isDisabled, loadFileContent, path, isLoading]);
  
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
        {type === "file" && (
          <span className="tree-item-tokens">
            {isLoading ? (
              "Loading..."
            ) : (
              (() => {
                if (localTokenCount) {
                  return `(~${localTokenCount.toLocaleString()})`;
                } else if (fileData?.tokenCount) {
                  return `(~${fileData.tokenCount.toLocaleString()})`;
                } else {
                  return null;
                }
              })()
            )}
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
      } ${isLoading ? "loading" : ""}`}
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
            e, type, toggleFileSelection, toggleFolderSelection, path, loadFileContent
          )}
          disabled={isDisabled}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="custom-checkbox"></span>
      </div>
      <div className="tree-item-icon">
        {type === "directory" 
          ? (isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />)
          : <File size={16} />
        }
      </div>
      {renderItemName()}
      {renderFileMetadata()}
      {renderViewButton()}
    </div>
  );
}, areEqual);

TreeItem.displayName = 'TreeItem';

export default TreeItem;