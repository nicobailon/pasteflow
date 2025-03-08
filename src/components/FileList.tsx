import React from "react";
import { FileListProps, FileData } from "../types/FileTypes";
import FileCard from "./FileCard";
import { FolderOpen } from "lucide-react";

const FileList = ({
  files,
  selectedFiles,
  toggleFileSelection,
  openFolder,
  processingStatus,
}: FileListProps) => {
  // Only show files that are in the selectedFiles array and not binary/skipped
  const displayableFiles = files.filter(
    (file: FileData) =>
      selectedFiles.includes(file.path) && !file.isBinary && !file.isSkipped,
  );

  return (
    <div className="file-list-container">
      {displayableFiles.length > 0 ? (
        <div className="file-list">
          {displayableFiles.map((file: FileData) => (
            <FileCard
              key={file.path}
              file={file}
              isSelected={true} // All displayed files are selected
              toggleSelection={toggleFileSelection}
            />
          ))}
        </div>
      ) : (
        <div className="file-list-empty">
          {files.length > 0
            ? "No files selected. Select files from the sidebar."
            :
            <button
                className="select-folder-btn"
                onClick={openFolder}
                disabled={processingStatus.status === "processing"}
                title="Select Folder"
              >
                <FolderOpen size={32} />
            </button> 
          }
        </div>
      )}
    </div>
  );
};

export default FileList;
