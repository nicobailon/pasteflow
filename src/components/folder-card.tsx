import { FolderOpen } from "lucide-react";

interface FolderCardProps {
  folderPath: string;
  fileCount: number;
}

const FolderCard = ({ folderPath, fileCount }: FolderCardProps) => {
  const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
  return (
    <div className="file-card" title={folderPath}>
      <div className="file-card-header">
        <div className="file-icon"><FolderOpen size={16} /></div>
        <div className="file-name">{name}</div>
      </div>
      <div className="file-card-content">
        <div className="file-meta">Contains {fileCount.toLocaleString()} files</div>
      </div>
    </div>
  );
};

export default FolderCard;

