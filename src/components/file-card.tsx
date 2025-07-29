import { Eye, FileText, Plus, X } from "lucide-react";
import { useEffect } from "react";

import { FileCardProps, LineRange } from "../types/file-types";

import CopyButton from "./copy-button";

// Helper to format line ranges for display
const formatLineRanges = (lines?: LineRange[]): string => {
  if (!lines || lines.length === 0) return 'Entire file';
  
  // Since we now have one card per line range, this will only format a single range
  return lines
    .map(range => range.start === range.end ? `Line ${range.start}` : `Lines ${range.start}-${range.end}`)
    .join('');
};

const FileCard = ({
  file,
  selectedFile,
  toggleSelection,
  onViewFile,
  loadFileContent
}: FileCardProps) => {
  const { name, path: filePath, content, isContentLoaded, tokenCount, error, isCountingTokens, tokenCountError } = file;
  const { lines, content: selectedContent, isContentLoaded: selectedIsContentLoaded, tokenCount: selectedTokenCount, isCountingTokens: selectedIsCountingTokens } = selectedFile || {};
  const isSelected = !!selectedFile;

  // Trigger content loading if needed when the component mounts or file path changes
  useEffect(() => {
    if (!isContentLoaded && !error && filePath) {
      loadFileContent(filePath);
    }
    // Only re-run if filePath, isContentLoaded, or error changes
  }, [filePath, isContentLoaded, error, loadFileContent]);

  // Get the appropriate token count (selected lines or full file)
  const getDisplayTokenCount = (): string => {
    // Check if we're currently counting tokens
    if (isCountingTokens || selectedIsCountingTokens) {
      return "Counting...";
    }
    // Use selected file's count if loaded
    if (selectedIsContentLoaded && selectedTokenCount !== undefined) {
      return selectedTokenCount.toLocaleString();
    }
    // Use the general file's count if loaded
    if (isContentLoaded && tokenCount !== undefined) {
      return tokenCount.toLocaleString();
    }
    // Show error if loading failed or token counting failed
    if (error || tokenCountError) {
      return "Error";
    }
    // Show loading indicator if content is not yet loaded and no error
    if (!isContentLoaded) {
      return "...";
    }
    // Fallback if something unexpected happens
    return "N/A";
  };

  // Helper function to format the token count display text
  const getTokenDisplayText = (): string => {
    const count = getDisplayTokenCount();
    switch (count) {
      case "...": {
        return "Loading...";
      }
      case "Counting...": {
        return "Counting tokens...";
      }
      case "Error": {
        return tokenCountError || "Error loading";
      }
      case "N/A": {
        return "N/A tokens";
      }
      default: {
        return `~${count} tokens`;
      }
    }
  };

  // Determine if we should display the line information
  const showLineInfo = isSelected && 
                      selectedFile && 
                      lines && 
                      lines.length > 0 && 
                      !selectedFile.isFullFile;

  return (
    <div className={`file-card ${isSelected ? "selected" : ""}`}>
      <div className="file-card-header">
        <div className="file-card-icon">
          <FileText size={16} />
        </div>
        <div className="file-card-name monospace">{name}</div>
      </div>
      {showLineInfo && (
        <div className="file-card-line-badge">
          {formatLineRanges(lines)}
        </div>
      )}
      <div className="file-card-info">
        <div className="file-card-tokens">
          {getTokenDisplayText()}
        </div>
      </div>

      <div className="file-card-actions">
        {onViewFile && (
          <button
            className="file-card-action"
            onClick={() => onViewFile(filePath)}
            title="View file"
          >
            <Eye size={16} />
          </button>
        )}
        <CopyButton text={selectedContent || (isContentLoaded ? content : "")} className="file-card-action">
          {""}
        </CopyButton>
        <button
          className="file-card-action remove-selection-btn"
          onClick={() => toggleSelection(filePath, lines?.[0])}
          title={isSelected ? "Remove from selection" : "Add to selection"}
        >
          {isSelected ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>
    </div>
  );
};

export default FileCard;