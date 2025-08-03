
import { FileTreeMode } from "../types/file-types";

import "./file-tree-toggle.css";

interface FileTreeToggleProps {
  currentMode: FileTreeMode;
  onChange: (mode: FileTreeMode) => void;
  tokenCounts?: Record<FileTreeMode, number>;
}

const fileTreeOptions = [
  { value: "none" as FileTreeMode, label: "None" },
  { value: "selected" as FileTreeMode, label: "Selected Files" },
  { value: "selected-with-roots" as FileTreeMode, label: "Selected + Folders" },
  { value: "complete" as FileTreeMode, label: "Full File Tree" },
];

function getTooltipText(mode: FileTreeMode): string {
  switch (mode) {
    case "none": {
      return "No file tree included";
    }
    case "selected": {
      return "Include tree structure for selected files only";
    }
    case "selected-with-roots": {
      return "Include all top-level folders and selected files";
    }
    case "complete": {
      return "Include the complete file tree";
    }
    default: {
      return "";
    }
  }
}

const FileTreeToggle = ({ currentMode, onChange, tokenCounts }: FileTreeToggleProps): JSX.Element => {
  return (
    <div className="theme-segmented-control file-tree-snippet-toggle">
      {fileTreeOptions.map((option) => (
        <button
          key={option.value}
          className={`theme-segment ${currentMode === option.value ? "active" : ""}`}
          onClick={() => onChange(option.value)}
          title={getTooltipText(option.value)}
        >
          <span>{option.label}</span>
          {tokenCounts && tokenCounts[option.value] > 0 && (
            <span className="file-tree-token-count">
              (~{tokenCounts[option.value].toLocaleString()})
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default FileTreeToggle;