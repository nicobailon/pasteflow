import React from "react";
import { TreeItemProps, TreeNode, SelectedFileWithLines } from "../types/FileTypes";
import { ChevronRight, File, Folder, Eye } from "lucide-react";

const TreeItem = ({
  node,
  selectedFiles,
  toggleFileSelection,
  toggleFolderSelection,
  toggleExpanded,
  onViewFile
}: TreeItemProps) => {
  const { id, name, path, type, level, isExpanded, fileData } = node;
  // @ts-ignore - Typed useRef hook is flagged in strict mode
  const checkboxRef = React.useRef<HTMLInputElement>(null);

  // Find the selected file (if any) for this node
  const selectedFile = selectedFiles.find(f => f.path === path);
  const isSelected = !!selectedFile;
  const isPartiallySelected = isSelected && selectedFile?.lines && selectedFile.lines.length > 0;

  // Helper function to check if a node is fully selected
  const isNodeFullySelected = (node: TreeNode): boolean => {
    if (node.type === "file") {
      // Files are selected if they're in the selectedFiles array
      // Non-selectable files (binary/skipped) are ignored
      const isSelectable = !(node.fileData?.isBinary || node.fileData?.isSkipped);
      if (!isSelectable) return false;
      
      const selectedFile = selectedFiles.find(f => f.path === node.path);
      return !!selectedFile;
    }
    
    if (node.type === "directory" && node.children) {
      // A directory is fully selected if all its children are fully selected
      return node.children.length > 0 && node.children.every(isNodeFullySelected);
    }
    
    return false;
  };

  // Helper function to check if a node is partially selected
  const isNodePartiallySelected = (node: TreeNode): boolean => {
    if (node.type === "file") {
      // Files can be partially selected if they have line ranges defined
      const isSelectable = !(node.fileData?.isBinary || node.fileData?.isSkipped);
      if (!isSelectable) return false;
      
      const selectedFile = selectedFiles.find(f => f.path === node.path);
      return !!selectedFile && !!selectedFile.lines && selectedFile.lines.length > 0;
    }
    
    if (node.type === "directory" && node.children) {
      if (node.children.length === 0) return false;
      
      // If any child is selected or partially selected
      const anySelected = node.children.some(child => {
        if (child.type === "file") {
          const isSelectable = !(child.fileData?.isBinary || child.fileData?.isSkipped);
          if (!isSelectable) return false;
          
          return selectedFiles.some(f => f.path === child.path);
        }
        return isNodeFullySelected(child) || isNodePartiallySelected(child);
      });
      
      // If all children are selected, it's fully selected, not partially
      const allSelected = isNodeFullySelected(node);
      
      return anySelected && !allSelected;
    }
    
    return false;
  };

  // For directories, determine if fully or partially selected
  const isDirectorySelected = type === "directory" ? isNodeFullySelected(node) : false;
  const isDirectoryPartiallySelected = type === "directory" ? isNodePartiallySelected(node) : false;

  // Update the indeterminate state manually whenever it changes
  React.useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isDirectoryPartiallySelected;
    }
  }, [isDirectoryPartiallySelected]);

  const handleToggle = (e: any) => {
    e.stopPropagation();
    toggleExpanded(id);
  };

  const handleItemClick = () => {
    if (type === "directory") {
      toggleExpanded(id);
    } else if (type === "file" && !isDisabled) {
      toggleFileSelection(path);
    }
  };

  const handleFileNameClick = (e: any) => {
    e.stopPropagation();
    if (type === "file" && !isDisabled && onViewFile) {
      onViewFile(path);
    }
  };

  const handleCheckboxChange = (e: any) => {
    e.stopPropagation();
    if (type === "file") {
      toggleFileSelection(path);
    } else if (type === "directory") {
      toggleFolderSelection(path, e.target.checked);
    }
  };

  // Check if file is binary or otherwise unselectable
  const isDisabled = fileData ? fileData.isBinary || fileData.isSkipped : false;

  // Check if the file is excluded by default (but still selectable)
  const isExcludedByDefault = fileData?.excludedByDefault || false;

  // Format line ranges for display in tooltip
  const formatSelectedLines = (): string => {
    if (!selectedFile || !selectedFile.lines || selectedFile.lines.length === 0) {
      return 'Entire file selected';
    }
    
    return selectedFile.lines
      .map(range => range.start === range.end 
        ? `Line ${range.start}` 
        : `Lines ${range.start}-${range.end}`)
      .join(', ');
  };

  return (
    <div
      className={`tree-item ${isSelected ? "selected" : ""} ${isPartiallySelected ? "partially-selected" : ""} ${
        isExcludedByDefault ? "excluded-by-default" : ""
      }`}
      style={{ marginLeft: `${level * 16}px` }}
      onClick={handleItemClick}
    >
      {type === "directory" && (
        <div
          className={`tree-item-toggle ${isExpanded ? "expanded" : ""}`}
          onClick={handleToggle}
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          <ChevronRight size={16} />
        </div>
      )}

      {type === "file" && <div className="tree-item-indent"></div>}
      <div className="tree-item-checkbox-container">
        <input
          type="checkbox"
          className="tree-item-checkbox"
          checked={type === "file" ? isSelected : isDirectorySelected}
          ref={checkboxRef}
          onChange={handleCheckboxChange}
          disabled={isDisabled}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="custom-checkbox"></span>
      </div>

      <div className="tree-item-content">
        <div className="tree-item-icon">
          {type === "directory" ? <Folder size={16} /> : <File size={16} />}
        </div>

        <div 
          className={`tree-item-name ${type === "file" && !isDisabled ? "clickable" : ""}`}
          onClick={type === "file" && !isDisabled ? handleFileNameClick : undefined}
          title={type === "file" && !isDisabled 
            ? `Click to view file${isSelected ? `. ${formatSelectedLines()}` : ''}`
            : name}
        >
          {name}
          {isPartiallySelected && (
            <span className="partial-selection-indicator" title={formatSelectedLines()}>
              Partial
            </span>
          )}
        </div>

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
        
        {type === "file" && !isDisabled && onViewFile && (
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
    </div>
  );
};

export default TreeItem;