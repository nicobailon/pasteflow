import React from "react";
import { SystemPrompt } from "../types/file-types";
import { X, Settings, MessageSquareCode } from "lucide-react";
import CopyButton from "./copy-button";

interface SystemPromptCardProps {
  prompt: SystemPrompt;
  toggleSelection: (prompt: SystemPrompt) => void;
}

const SystemPromptCard = ({
  prompt,
  toggleSelection
}: SystemPromptCardProps) => {
  const { title, content } = prompt;
  
  // Estimate token count for the prompt (simple calculation)
  const estimateTokenCount = (text: string) => {
    return Math.ceil(text.length / 4);
  };
  
  const tokenCount = estimateTokenCount(content);

  return (
    <div className="file-card system-prompt-card">
      <div className="file-card-header">
        <div className="file-card-icon">
          <MessageSquareCode size={16} />
        </div>
        <div className="file-card-name monospace">{title}</div>
      </div>
      <div className="file-card-line-badge system-prompt-badge">
        System Prompt
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

export default SystemPromptCard; 