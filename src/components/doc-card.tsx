import { FileText, X } from "lucide-react";

import { Instruction } from "../types/file-types";

import CopyButton from "./copy-button";

// Estimate token count for the doc (simple calculation)
const estimateTokenCount = (text: string) => {
  return Math.ceil(text.length / 4);
};

interface DocCardProps {
  instruction: Instruction;
  toggleSelection: (instruction: Instruction) => void;
}

const DocCard = ({
  instruction,
  toggleSelection
}: DocCardProps) => {
  const { title, content } = instruction;
  
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
          onClick={() => toggleSelection(instruction)}
          title="Remove from selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default DocCard; 