import { Eye, User, X } from "lucide-react";

import { RolePrompt } from "../types/file-types";
import { TOKEN_COUNTING } from "../constants/app-constants";

import CopyButton from "./copy-button";
import "./role-prompt-card.css";

// Estimate token count for the prompt (simple calculation)
const estimateTokenCount = (text: string) => {
  return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
};

interface RolePromptCardProps {
  prompt: RolePrompt;
  toggleSelection: (prompt: RolePrompt) => void;
  onViewPrompt?: (prompt: RolePrompt) => void;
}

const RolePromptCard = ({
  prompt,
  toggleSelection,
  onViewPrompt
}: RolePromptCardProps) => {
  const { name, content } = prompt;
  
  const tokenCount = prompt.tokenCount ?? estimateTokenCount(content);

  return (
    <div className="file-card role-prompt-card">
      <div className="file-card-header">
        <div className="file-card-icon">
          <User size={16} />
        </div>
        <div className="file-card-name monospace">{name}</div>
      </div>
      <div className="file-card-line-badge role-prompt-badge">
        Role Prompt
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
            aria-label={`View role prompt: ${name}`}
          >
            <Eye size={16} />
          </button>
        )}
        <CopyButton text={content} className="file-card-action" aria-label={`Copy role prompt: ${name}`}>
          {""}
        </CopyButton>
        <button
          className="file-card-action remove-selection-btn"
          onClick={() => toggleSelection(prompt)}
          title="Remove from selection"
          aria-label={`Remove role prompt ${name} from selection`}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default RolePromptCard;