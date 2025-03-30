import { Eye, FileText, Plus, X } from "lucide-react";

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
  onViewFile
}: FileCardProps) => {
  const { name, path: filePath, tokenCount, content } = file;
  const { lines, content: selectedContent } = selectedFile || {};
  const isSelected = !!selectedFile;
  
  // Get the appropriate token count (selected lines or full file)
  const getDisplayTokenCount = (): number => {
    if (selectedFile && selectedFile.tokenCount !== undefined) {
      return selectedFile.tokenCount;
    }
    return tokenCount;
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
        <div className="file-card-tokens">~{getDisplayTokenCount().toLocaleString()} tokens</div>
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
        <CopyButton text={selectedContent || content} className="file-card-action">
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