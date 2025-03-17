import React from "react";
import { RolePrompt } from "../types/FileTypes";
import { X, User } from "lucide-react";
import CopyButton from "./CopyButton";

interface RolePromptCardProps {
  prompt: RolePrompt;
  toggleSelection: (prompt: RolePrompt) => void;
}

const RolePromptCard = ({
  prompt,
  toggleSelection
}: RolePromptCardProps) => {
  const { title, content } = prompt;
  
  // Estimate token count for the prompt (simple calculation)
  const estimateTokenCount = (text: string) => {
    return Math.ceil(text.length / 4);
  };
  
  const tokenCount = estimateTokenCount(content);

  return (
    <div className="file-card role-prompt-card">
      <div className="file-card-header">
        <div className="file-card-icon">
          <User size={16} />
        </div>
        <div className="file-card-name monospace">{title}</div>
      </div>
      <div className="file-card-line-badge role-prompt-badge">
        Role Prompt
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
          onClick={() => toggleSelection(prompt)}
          title="Remove from selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default RolePromptCard;