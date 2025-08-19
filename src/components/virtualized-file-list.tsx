import { useMemo, memo, useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FolderOpen } from "lucide-react";

import { FileData, FileListProps, LineRange, SelectedFileWithLines } from "../types/file-types";
import { tokenCountCache } from "../utils/token-cache-adapter";
import { estimateTokenCount } from "../utils/token-utils";

import FileCard from "./file-card";
import InstructionCard from "./instruction-card";
import RolePromptCard from "./role-prompt-card";
import SystemPromptCard from "./system-prompt-card";

interface ExpandedFileCard {
  originalFile: FileData;
  selectedFilePath: string;
  lineRange?: LineRange;
  content: string;
  tokenCount: number;
  isFullFile: boolean;
}

interface RowData {
  expandedCards: ExpandedFileCard[];
  selectedFiles: SelectedFileWithLines[];
  toggleSelection: (filePath: string, lineRange?: LineRange) => void;
  onViewFile?: (filePath: string) => void;
  loadFileContent: (filePath: string) => Promise<void>;
  allFilesMap: Map<string, FileData>;
}

const ITEM_HEIGHT = 120; // Base height for file cards

const Row = memo(({ index, style, data }: { index: number; style: React.CSSProperties; data: RowData }) => {
  const { expandedCards, toggleSelection, onViewFile, loadFileContent } = data;
  const expandedCard = expandedCards[index];
  
  if (!expandedCard) return null;
  
  return (
    <div style={style}>
      <FileCard
        key={`${expandedCard.selectedFilePath}-${expandedCard.lineRange?.start || 'full'}`}
        file={expandedCard.originalFile}
        selectedFile={{
          path: expandedCard.selectedFilePath,
          lines: expandedCard.lineRange ? [expandedCard.lineRange] : undefined,
          content: expandedCard.content,
          tokenCount: expandedCard.tokenCount,
          isFullFile: expandedCard.isFullFile,
          isContentLoaded: !!expandedCard.content,
          isCountingTokens: false
        }}
        toggleSelection={toggleSelection}
        onViewFile={onViewFile}
        loadFileContent={loadFileContent}
      />
    </div>
  );
});

Row.displayName = 'VirtualizedFileRow';

// Calculate item size based on content
const getItemSize = (_index: number) => {
  // Could be made more dynamic based on actual content
  return ITEM_HEIGHT;
};

export interface VirtualizedFileListHandle {
  scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => void;
  scrollTo: (scrollTop: number) => void;
}

const VirtualizedFileList = forwardRef<VirtualizedFileListHandle, FileListProps>((props, ref) => {
  const {
    files,
    selectedFiles,
    toggleFileSelection: _toggleFileSelection,
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
  } = props;
  
  const listRef = useRef<List<RowData>>(null);
  
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => {
      listRef.current?.scrollToItem(index, align);
    },
    scrollTo: (scrollTop: number) => {
      listRef.current?.scrollTo(scrollTop);
    }
  }), []);
  
  // Create a Map for faster lookups
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

  // Helper to create a full file card
  const createFullFileCard = useCallback((fileData: FileData, filePath: string): ExpandedFileCard => {
    return {
      originalFile: fileData,
      selectedFilePath: filePath,
      content: fileData.content || '',
      tokenCount: fileData.tokenCount || 0,
      isFullFile: true
    };
  }, []);

  // Helper to create a line range card
  const createLineRangeCard = useCallback((fileData: FileData, filePath: string, lineRange: LineRange): ExpandedFileCard => {
    // Check cache first
    const cachedEntry = tokenCountCache.get(filePath, lineRange);
    
    let rangeContent: string;
    let rangeTokenCount: number;
    
    if (cachedEntry && cachedEntry.tokenCount !== undefined) {
      rangeContent = cachedEntry.content;
      rangeTokenCount = cachedEntry.tokenCount;
    } else if (fileData.content) {
      // Extract the content for the line range
      const lines = fileData.content.split('\n');
      rangeContent = lines.slice(lineRange.start - 1, lineRange.end).join('\n');
      rangeTokenCount = estimateTokenCount(rangeContent);
      
      // Update cache
      tokenCountCache.set(filePath, rangeContent, rangeTokenCount, lineRange);
    } else {
      rangeContent = '';
      rangeTokenCount = 0;
    }
    
    return {
      originalFile: fileData,
      selectedFilePath: filePath,
      lineRange,
      content: rangeContent,
      tokenCount: rangeTokenCount,
      isFullFile: false
    };
  }, []);

  // Create expanded cards - one card per line range for files with multiple line ranges
  const expandedCards: ExpandedFileCard[] = useMemo(() => {
    const cards: ExpandedFileCard[] = [];
    
    for (const file of displayableFiles) {
      const selectedFileRef = selectedFilesMap.get(file.path);
      if (!selectedFileRef) continue;
      
      const fileData = allFilesMap.get(file.path);
      if (!fileData) continue;
      
      // If the file has no line ranges, create a single card for the entire file
      if (!selectedFileRef.lines || selectedFileRef.lines.length === 0) {
        cards.push(createFullFileCard(fileData, file.path));
      } else {
        // Create a separate card for each line range
        for (const lineRange of selectedFileRef.lines) {
          cards.push(createLineRangeCard(fileData, file.path, lineRange));
        }
      }
    }
    
    return cards;
  }, [displayableFiles, selectedFilesMap, allFilesMap, createFullFileCard, createLineRangeCard]);
  
  const itemData: RowData = useMemo(() => ({
    expandedCards,
    selectedFiles,
    toggleSelection: toggleSelection || (() => {}),
    onViewFile,
    loadFileContent,
    allFilesMap
  }), [expandedCards, selectedFiles, toggleSelection, onViewFile, loadFileContent, allFilesMap]);
  
  // Show empty state if no files
  if (displayableFiles.length === 0 && !processingStatus?.status) {
    return (
      <div className="empty-state">
        <FolderOpen size={48} />
        <h3>No Files Selected</h3>
        <p>
          Open a folder to get started or select files from the sidebar to
          include them.
        </p>
        <button
          className="btn-primary"
          onClick={openFolder}
          disabled={processingStatus?.status === "processing"}
        >
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className="file-list-container">
      {/* Prompt cards - not virtualized as there are usually few of them */}
      {selectedSystemPrompts.length > 0 && toggleSystemPromptSelection && (
        <div className="prompts-section">
          {selectedSystemPrompts.map(prompt => (
            <SystemPromptCard
              key={prompt.id}
              prompt={prompt}
              toggleSelection={toggleSystemPromptSelection}
            />
          ))}
        </div>
      )}
      
      {selectedRolePrompts.length > 0 && toggleRolePromptSelection && (
        <div className="prompts-section">
          {selectedRolePrompts.map(prompt => (
            <RolePromptCard
              key={prompt.id}
              prompt={prompt}
              toggleSelection={toggleRolePromptSelection}
            />
          ))}
        </div>
      )}
      
      {selectedInstructions.length > 0 && toggleInstructionSelection && (
        <div className="instructions-section">
          {selectedInstructions.map(instruction => (
            <InstructionCard
              key={instruction.id}
              instruction={instruction}
              toggleSelection={toggleInstructionSelection}
            />
          ))}
        </div>
      )}
      
      {/* Virtualized file list */}
      {expandedCards.length > 0 && (
        <div style={{ flex: 1, minHeight: 400 }}>
          <AutoSizer>
            {({ height, width }) => (
              <List
                ref={listRef}
                height={height}
                itemCount={expandedCards.length}
                itemSize={getItemSize}
                width={width}
                itemData={itemData}
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        </div>
      )}
    </div>
  );
});

VirtualizedFileList.displayName = 'VirtualizedFileList';

export default memo(VirtualizedFileList);