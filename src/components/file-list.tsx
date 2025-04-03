import { FolderOpen } from "lucide-react";

import { FileData, FileListProps, LineRange, SelectedFileWithLines } from "../types/file-types";

import FileCard from "./file-card";
import RolePromptCard from "./role-prompt-card";
import SystemPromptCard from "./system-prompt-card";

// Interface for expanded file card display
interface ExpandedFileCard {
  originalFile: FileData;
  selectedFilePath: string;
  lineRange?: LineRange;
  content: string;
  tokenCount: number;
  isFullFile: boolean;
}

const FileList = ({
  files,
  selectedFiles,
  toggleFileSelection,
  toggleSelection,
  openFolder,
  onViewFile,
  processingStatus,
  selectedSystemPrompts = [],
  toggleSystemPromptSelection,
  selectedRolePrompts = [],
  toggleRolePromptSelection,
  loadFileContent,
}: FileListProps) => {
  // Create a Map for faster lookups
  const selectedFilesMap = new Map(selectedFiles.map(file => [file.path, file]));
  
  // Only show files that are in the selectedFiles array and not binary/skipped
  const displayableFiles = files.filter(
    (file: FileData) =>
      selectedFilesMap.has(file.path) && !file.isBinary && !file.isSkipped,
  );

  // Create expanded cards - one card per line range for files with multiple line ranges
  const expandedCards: ExpandedFileCard[] = [];
  
  for (const file of displayableFiles) {
    const selectedFile = selectedFilesMap.get(file.path);
    
    if (!selectedFile) continue;
    
    // If the file has no line ranges or is a full file, create a single card
    if (!selectedFile.lines || selectedFile.lines.length === 0 || selectedFile.isFullFile) {
      expandedCards.push({
        originalFile: {
          ...file,
          isContentLoaded: selectedFile.isContentLoaded || file.isContentLoaded,
          tokenCount: selectedFile.tokenCount || file.tokenCount,
          error: selectedFile.error || file.error
        },
        selectedFilePath: file.path,
        content: selectedFile.content || file.content,
        tokenCount: selectedFile.tokenCount || file.tokenCount,
        isFullFile: !!selectedFile.isFullFile
      });
    } 
    // If the file has line ranges, create a separate card for each range
    else if (selectedFile.lines && selectedFile.lines.length > 0) {
      for (const lineRange of selectedFile.lines) {
        // Calculate content and token count for this specific line range
        const lines = file.content?.split('\n') || [];
        const rangeContent = lines.slice(lineRange.start - 1, lineRange.end).join('\n');
        // Simple estimation: ~4 characters per token on average
        const rangeTokenCount = Math.ceil(rangeContent.length / 4);
        
        expandedCards.push({
          originalFile: {
            ...file,
            isContentLoaded: selectedFile.isContentLoaded || file.isContentLoaded,
            tokenCount: rangeTokenCount,
            error: selectedFile.error || file.error
          },
          selectedFilePath: file.path,
          lineRange: lineRange,
          content: rangeContent,
          tokenCount: rangeTokenCount,
          isFullFile: false
        });
      }
    }
  }

  // Calculate if we have any items to display (files, system prompts, or role prompts)
  const hasItemsToDisplay = expandedCards.length > 0 || selectedSystemPrompts.length > 0 || selectedRolePrompts.length > 0;

  return (
    <div className="file-list-container">
      {hasItemsToDisplay ? (
        <div className="file-list">
          {/* Display system prompts at the top */}
          {selectedSystemPrompts.map((prompt) => (
            <SystemPromptCard
              key={`system-prompt-${prompt.id}`}
              prompt={prompt}
              toggleSelection={toggleSystemPromptSelection || (() => {})}
            />
          ))}
          
          {/* Display role prompts below system prompts */}
          {selectedRolePrompts.map((prompt) => (
            <RolePromptCard
              key={`role-prompt-${prompt.id}`}
              prompt={prompt}
              toggleSelection={toggleRolePromptSelection || (() => {})}
            />
          ))}
          
          {/* Display selected files */}
          {expandedCards.map((cardData, index) => {
            // Create a modified selected file object for each card
            const modifiedSelectedFile: SelectedFileWithLines = {
              path: cardData.selectedFilePath,
              lines: cardData.lineRange ? [cardData.lineRange] : undefined,
              content: cardData.content,
              tokenCount: cardData.tokenCount,
              isFullFile: cardData.isFullFile
            };
            
            return (
              <FileCard
                key={`${cardData.selectedFilePath}-${cardData.lineRange?.start || 'full'}-${index}`}
                file={cardData.originalFile}
                selectedFile={modifiedSelectedFile}
                toggleSelection={toggleSelection || toggleFileSelection}
                onViewFile={onViewFile}
                loadFileContent={loadFileContent}
              />
            );
          })}
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