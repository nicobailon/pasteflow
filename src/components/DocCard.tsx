import React from "react";
import { Doc } from "../types/FileTypes";
import { X, FileText } from "lucide-react";
import CopyButton from "./CopyButton";

/**
 * Interface defining the props for the DocCard component
 */
interface DocCardProps {
  doc: Doc;
  toggleSelection: (doc: Doc) => void;
}

/**
 * DocCard component - Displays a single documentation card
 * with its title, content preview, and token estimate.
 * Provides functionality to copy content and remove from selection.
 * 
 * @param {Doc} doc - The documentation object to display
 * @param {Function} toggleSelection - Function to toggle selection status
 * @returns {JSX.Element} - Rendered DocCard component
 */
const DocCard = ({
  doc,
  toggleSelection
}: DocCardProps) => {
  const { title, content } = doc;
  
  /**
   * Estimates token count for text content
   * Uses a simple calculation of dividing character count by 4
   * 
   * @param {string} text - The text to estimate tokens for
   * @returns {number} - Estimated token count
   */
  const estimateTokenCount = (text: string) => {
    return Math.ceil(text.length / 4);
  };
  
  const tokenCount = estimateTokenCount(content);

  return (
    <div className="file-card doc-card">
      <div className="file-card-header">
        <div className="file-card-icon">
          <FileText size={16} />
        </div>
        <div className="file-card-name monospace">{title}</div>
      </div>
      <div className="file-card-line-badge doc-badge">
        Documentation
      </div>
      <div className="file-card-info">
        <div className="file-card-tokens">~{tokenCount.toLocaleString()} tokens</div>
      </div>

      <div className="file-card-actions">
        <CopyButton text={content} className="file-card-action">
          {""}
        </CopyButton>
        <button
          className="file-card-action remove-selection-btn"
          onClick={() => toggleSelection(doc)}
          title="Remove from selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default DocCard; 