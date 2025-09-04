import { useMemo } from "react";
import { FolderOpen } from "lucide-react";

import { FileData, FileListProps, LineRange, SelectedFileWithLines } from "../types/file-types";
import { buildFolderIndex, getFilesInFolder } from "../utils/folder-selection-index";
import { tokenCountCache } from "../utils/token-cache-adapter";
import { estimateTokenCount } from "../utils/token-utils";

import FileCard from "./file-card";
import FolderCard from "./folder-card";
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
  folderSelectionCache,
  selectedSystemPrompts = [],
  toggleSystemPromptSelection,
  onViewSystemPrompt,
  selectedRolePrompts = [],
  toggleRolePromptSelection,
  onViewRolePrompt,
  selectedInstructions = [],
  toggleInstructionSelection,
  onViewInstruction,
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
  // Also deduplicate by path to prevent duplicate cards if upstream arrays accidentally contain duplicates
  const displayableFiles = [...new Map(
      files
        .filter(
          (file: FileData) =>
            selectedFilesMap.has(file.path) && !file.isBinary && !file.isSkipped
        )
        .map((f: FileData) => [f.path, f] as const)
    ).values()];

  // Build folder index once for grouping and counts
  const folderIndex = useMemo(() => buildFolderIndex(files), [files]);

  // Determine top-most fully selected directories using folderSelectionCache
  const fullDirs = useMemo(() => {
    if (!folderSelectionCache) return [] as string[];
    const allDirs = Array.from((folderIndex as Map<string, string[]>).keys());
    const candidates = allDirs.filter((dir) => folderSelectionCache.get(dir) === 'full');
    // Deduplicate by removing dirs whose ancestor is already 'full'
    candidates.sort((a, b) => a.length - b.length); // ancestors first
    const kept: string[] = [];
    for (const dir of candidates) {
      const isCovered = kept.some((p) => p === '/' ? dir !== '/' : (dir === p || dir.startsWith(p + '/')));
      if (!isCovered) kept.push(dir);
    }
    return kept;
  }, [folderSelectionCache, folderIndex]);

  // Paths to exclude from per-file cards (covered by folder cards)
  const excludedFilePaths = useMemo(() => {
    if (!folderSelectionCache || fullDirs.length === 0) return new Set<string>();
    const set = new Set<string>();
    for (const dir of fullDirs) {
      const filesInDir = getFilesInFolder(folderIndex, dir);
      for (const p of filesInDir) set.add(p);
    }
    return set;
  }, [folderSelectionCache, fullDirs, folderIndex]);

  // Prepare folder cards with counts
  const folderCards = useMemo(() => {
    return fullDirs.map((dir) => ({ dir, count: getFilesInFolder(folderIndex, dir).length }));
  }, [fullDirs, folderIndex]);

  // Create expanded cards - one card per line range for files with multiple line ranges
  const expandedCards: ExpandedFileCard[] = [];
  
  for (const file of displayableFiles) {
    if (excludedFilePaths.has(file.path)) continue; // skip files covered by folder cards
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
      // Deduplicate line ranges by start-end to avoid duplicate cards across refreshes
      const uniqueRanges = [...new Map(
          selectedFileRef.lines.map((r: LineRange) => [`${r.start}-${r.end}`, r] as const)
        ).values()];

      for (const lineRange of uniqueRanges) {
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

  // Calculate if we have any items to display (folders, files, system prompts, role prompts, or instructions)
  // Include folderCards so aggregated folder selections render even before per-file refs are materialized
  const hasItemsToDisplay =
    folderCards.length > 0 ||
    expandedCards.length > 0 ||
    selectedSystemPrompts.length > 0 ||
    selectedRolePrompts.length > 0 ||
    selectedInstructions.length > 0;

  return (
    <div className="file-list-container">
      {hasItemsToDisplay ? (
        <div className="file-list">
          {/* Display selected folders (aggregated) */}
          {folderCards.map(({ dir, count }) => (
            <FolderCard key={`folder-card-${dir}`} folderPath={dir} fileCount={count} />
          ))}
          {/* Display system prompts at the top */}
          {selectedSystemPrompts.map((prompt) => (
            <SystemPromptCard
              key={`system-prompt-${prompt.id}`}
              prompt={prompt}
              toggleSelection={toggleSystemPromptSelection || (() => {})}
              onViewPrompt={onViewSystemPrompt}
            />
          ))}
          
          {/* Display role prompts below system prompts */}
          {selectedRolePrompts.map((prompt) => (
            <RolePromptCard
              key={`role-prompt-${prompt.id}`}
              prompt={prompt}
              toggleSelection={toggleRolePromptSelection || (() => {})}
              onViewPrompt={onViewRolePrompt}
            />
          ))}
          
          {/* Display instructions below role prompts */}
          {selectedInstructions.map((instruction) => (
            <InstructionCard
              key={`instruction-${instruction.id}`}
              instruction={instruction}
              toggleSelection={toggleInstructionSelection || (() => {})}
              onViewInstruction={onViewInstruction}
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
