import { Eye, MessageSquareCode, X } from "lucide-react";

import { SystemPrompt } from "../types/file-types";
import { TOKEN_COUNTING } from "@constants";

import CopyButton from "./copy-button";
import "./system-prompt-card.css";

// Estimate token count for the prompt (simple calculation)
const estimateTokenCount = (text: string) => {
  return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
};

interface SystemPromptCardProps {
  prompt: SystemPrompt;
  toggleSelection: (prompt: SystemPrompt) => void;
  onViewPrompt?: (prompt: SystemPrompt) => void;
}

const SystemPromptCard = ({
  prompt,
  toggleSelection,
  onViewPrompt
}: SystemPromptCardProps) => {
  const { name, content } = prompt;
  
  const tokenCount = prompt.tokenCount ?? estimateTokenCount(content);

  return (
    <div className="file-card system-prompt-card">
      <div className="file-card-header">
        <div className="file-card-icon">
          <MessageSquareCode size={16} />
        </div>
        <div className="file-card-name monospace">{name}</div>
      </div>
      <div className="file-card-line-badge system-prompt-badge">
        System Prompt
      </div>
      <div className="file-card-info">
        <div className="file-card-tokens">~{tokenCount.toLocaleString()} tokens</div>
      </div>

      <div className="file-card-actions">
        {onViewPrompt && (
          <button
            className="file-card-action"
            onClick={() => onViewPrompt(prompt)}
            title="View prompt"
            aria-label={`View system prompt: ${name}`}
          >
            <Eye size={16} />
          </button>
        )}
        <CopyButton text={content} className="file-card-action" aria-label={`Copy system prompt: ${name}`}>
          {""}
        </CopyButton>
        <button
          className="file-card-action remove-selection-btn"
          onClick={() => toggleSelection(prompt)}
          title="Remove from selection"
          aria-label={`Remove system prompt ${name} from selection`}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default SystemPromptCard; 