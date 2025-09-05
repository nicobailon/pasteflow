import { Eye, FolderOpen, X } from "lucide-react";
import CopyButton from "./copy-button";

interface FolderCardProps {
  folderPath: string;
  fileCount: number;
  onExpand?: () => void;
  onRemove?: () => void;
  copyText?: string | (() => string | Promise<string>);
}

const FolderCard = ({ folderPath, fileCount, onExpand, onRemove, copyText }: FolderCardProps) => {
  const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
  return (
    <div className="file-card folder-card selected" title={folderPath}>
      <div className="file-card-header">
        <div className="file-card-icon"><FolderOpen size={16} /></div>
        <div className="file-card-name monospace">{name} / </div>
      </div>
      <div className="file-card-content">
        <div className="file-meta file-card-name">&nbsp; Contains {fileCount.toLocaleString()} files</div>
      </div>
      <div className="file-card-actions">
        {onExpand && (
          <button
            className="file-card-action"
            onClick={onExpand}
            title="View files in folder"
          >
            <Eye size={16} />
          </button>
        )}
        {copyText && (
          <CopyButton text={copyText} className="file-card-action">
            {""}
          </CopyButton>
        )}
        {onRemove && (
          <button
            className="file-card-action remove-selection-btn"
            onClick={onRemove}
            title="Remove folder from selection"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default FolderCard;

