import React, {
  useRef,
  useEffect,
} from "react";
import { TreeItemProps, TreeNode } from "../types/FileTypes";
import { ChevronRight, File, Folder } from "lucide-react";

const TreeItem = ({
  node,
  selectedFiles,
  toggleFileSelection,
  toggleFolderSelection,
  toggleExpanded,
}: TreeItemProps) => {
  const { id, name, path, type, level, isExpanded, fileData } = node;
  const checkboxRef = useRef(null);

  const isSelected = type === "file" && selectedFiles.includes(path);

  // Helper function to check if a node is fully selected
  const isNodeFullySelected = (node: TreeNode): boolean => {
    if (node.type === "file") {
      // Files are selected if they're in the selectedFiles array
      // Non-selectable files (binary/skipped) are ignored
      const isSelectable = !(node.fileData?.isBinary || node.fileData?.isSkipped);
      return !isSelectable || selectedFiles.includes(node.path);
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
      return false; // Files can't be partially selected
    }
    
    if (node.type === "directory" && node.children) {
      if (node.children.length === 0) return false;
      
      // If any child is selected or partially selected
      const anySelected = node.children.some(child => {
        if (child.type === "file") {
          const isSelectable = !(child.fileData?.isBinary || child.fileData?.isSkipped);
          return isSelectable && selectedFiles.includes(child.path);
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
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isDirectoryPartiallySelected;
    }
  }, [isDirectoryPartiallySelected]);

  const handleToggle = (e: any) => {
    e.stopPropagation();
    toggleExpanded(id);
  };

  const handleItemClick = (e: any) => {
    if (type === "directory") {
      toggleExpanded(id);
    } else if (type === "file" && !isDisabled) {
      toggleFileSelection(path);
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

  return (
    <div
      className={`tree-item ${isSelected ? "selected" : ""} ${
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

        <div className="tree-item-name">{name}</div>

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
      </div>
    </div>
  );
};

export default TreeItem;