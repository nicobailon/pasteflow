import { Eye, FileText, X } from "lucide-react";

import { Instruction } from "../types/file-types";
import { TOKEN_COUNTING } from "../constants/app-constants";

import CopyButton from "./copy-button";
import "./instruction-card.css";

// Estimate token count for the instruction (simple calculation)
const estimateTokenCount = (text: string) => {
  return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
};

interface InstructionCardProps {
  instruction: Instruction;
  toggleSelection: (instruction: Instruction) => void;
  onViewInstruction?: (instruction: Instruction) => void;
}

const InstructionCard = ({
  instruction,
  toggleSelection,
  onViewInstruction
}: InstructionCardProps) => {
  const { name, content } = instruction;
  
  const tokenCount = instruction.tokenCount ?? estimateTokenCount(content);

  return (
    <div className="file-card instruction-card">
      <div className="file-card-header">
        <div className="file-card-icon">
          <FileText size={16} />
        </div>
        <div className="file-card-name monospace">{name}</div>
      </div>
      <div className="file-card-line-badge instruction-badge">
        Doc
      </div>
      <div className="file-card-info">
        <div className="file-card-tokens">~{tokenCount.toLocaleString()} tokens</div>
      </div>

      <div className="file-card-actions">
        {onViewInstruction && (
          <button
            className="file-card-action"
            onClick={() => onViewInstruction(instruction)}
            title="View doc"
            aria-label={`View doc: ${name}`}
          >
            <Eye size={16} />
          </button>
        )}
        <CopyButton text={content} className="file-card-action" aria-label={`Copy doc: ${name}`}>
          {""}
        </CopyButton>
        <button
          className="file-card-action remove-selection-btn"
          onClick={() => toggleSelection(instruction)}
          title="Remove from selection"
          aria-label={`Remove doc ${name} from selection`}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default InstructionCard;