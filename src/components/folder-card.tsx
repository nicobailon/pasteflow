import { FolderOpen } from "lucide-react";

interface FolderCardProps {
  folderPath: string;
  fileCount: number;
}

const FolderCard = ({ folderPath, fileCount }: FolderCardProps) => {
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
    </div>
  );
};

export default FolderCard;

