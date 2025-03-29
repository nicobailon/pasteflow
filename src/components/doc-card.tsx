import React from "react";
import { Doc } from "../types/file-types";
import { X, FileText } from "lucide-react";
import CopyButton from "./copy-button";

interface DocCardProps {
  doc: Doc;
  toggleSelection: (doc: Doc) => void;
}

const DocCard = ({
  doc,
  toggleSelection
}: DocCardProps) => {
  const { title, content } = doc;
  
  // Estimate token count for the doc (simple calculation)
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