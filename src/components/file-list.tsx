import { useMemo } from "react";
import { FolderOpen } from "lucide-react";

import { FileData, FileListProps, LineRange, SelectedFileWithLines } from "../types/file-types";
import { tokenCountCache } from "../utils/token-cache";
import { estimateTokenCount } from "../utils/token-utils";

import FileCard from "./file-card";
import InstructionCard from "./instruction-card";
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

/**
 * FileList component implementing the single-source-of-truth pattern.
 * 
 * This component demonstrates the proper way to handle file data in the new architecture:
 * - `files` (allFiles) contains the authoritative file data
 * - `selectedFiles` contains only references (path + optional line ranges)
 * - The component derives display data by looking up references in the source data
 * 
 * Key implementation details:
 * 1. Maps are memoized for performance when looking up files
 * 2. File content and token counts come from FileData, not SelectedFileReference
 * 3. Line range token counts are cached to avoid recalculation on every render
 * 4. The component never modifies or duplicates FileData
 */
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
  selectedInstructions = [],
  toggleInstructionSelection,
  loadFileContent,
}: FileListProps) => {
  // Create a Map for faster lookups - now just references
  const selectedFilesMap = useMemo(
    () => new Map(selectedFiles.map(file => [file.path, file])),
    [selectedFiles]
  );
  
  // Create a Map of all files for quick access
  const allFilesMap = useMemo(
    () => new Map(files.map(file => [file.path, file])),
    [files]
  );
  
  // Only show files that are in the selectedFiles array and not binary/skipped
  const displayableFiles = files.filter(
    (file: FileData) =>
      selectedFilesMap.has(file.path) && !file.isBinary && !file.isSkipped,
  );

  // Create expanded cards - one card per line range for files with multiple line ranges
  const expandedCards: ExpandedFileCard[] = [];
  
  for (const file of displayableFiles) {
    const selectedFileRef = selectedFilesMap.get(file.path);
    
    if (!selectedFileRef) continue;
    
    // Get the actual file data from allFiles
    const fileData = allFilesMap.get(file.path);
    if (!fileData) continue;
    
    // If the file has no line ranges, create a single card for the entire file
    if (!selectedFileRef.lines || selectedFileRef.lines.length === 0) {
      expandedCards.push({
        originalFile: fileData,
        selectedFilePath: file.path,
        content: fileData.content || '',
        tokenCount: fileData.tokenCount || 0,
        isFullFile: true
      });
    } 
    // If the file has line ranges, create a separate card for each range
    else if (selectedFileRef.lines && selectedFileRef.lines.length > 0) {
      for (const lineRange of selectedFileRef.lines) {
        let rangeContent: string;
        let rangeTokenCount: number;
        
        // Check cache first
        const cachedEntry = tokenCountCache.get(file.path, lineRange);
        
        if (cachedEntry) {
          rangeContent = cachedEntry.content;
          rangeTokenCount = cachedEntry.tokenCount;
        } else {
          // Calculate content and token count for this specific line range
          const lines = fileData.content?.split('\n') || [];
          rangeContent = lines.slice(lineRange.start - 1, lineRange.end).join('\n');
          rangeTokenCount = estimateTokenCount(rangeContent);
          
          // Cache the result
          tokenCountCache.set(file.path, rangeContent, rangeTokenCount, lineRange);
        }
        
        expandedCards.push({
          originalFile: {
            ...fileData,
            tokenCount: rangeTokenCount
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

  // Calculate if we have any items to display (files, system prompts, role prompts, or instructions)
  const hasItemsToDisplay = expandedCards.length > 0 || selectedSystemPrompts.length > 0 || selectedRolePrompts.length > 0 || selectedInstructions.length > 0;

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
          
          {/* Display instructions below role prompts */}
          {selectedInstructions.map((instruction) => (
            <InstructionCard
              key={`instruction-${instruction.id}`}
              instruction={instruction}
              toggleSelection={toggleInstructionSelection || (() => {})}
            />
          ))}
          
          {/* Display selected files */}
          {expandedCards.map((cardData, index) => {
            // Create a selected file object that combines reference and actual data
            const selectedFile: SelectedFileWithLines = {
              path: cardData.selectedFilePath,
              lines: cardData.lineRange ? [cardData.lineRange] : undefined,
              content: cardData.content,
              tokenCount: cardData.tokenCount,
              isFullFile: cardData.isFullFile,
              isContentLoaded: cardData.originalFile.isContentLoaded,
              error: cardData.originalFile.error,
              isCountingTokens: cardData.originalFile.isCountingTokens,
              tokenCountError: cardData.originalFile.tokenCountError
            };
            
            return (
              <FileCard
                key={`${cardData.selectedFilePath}-${cardData.lineRange?.start || 'full'}-${index}`}
                file={cardData.originalFile}
                selectedFile={selectedFile}
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