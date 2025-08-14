import { Check, ChevronDown, Eye, FileText, Settings, User } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { FileData, Instruction, LineRange, RolePrompt, SelectedFileReference, SystemPrompt } from '../types/file-types';
import { getRelativePath, dirname, normalizePath } from '../utils/path-utils';

import CopyButton from './copy-button';
import Dropdown from './dropdown';
import FileList from './file-list';
import ClipboardPreviewModal from './clipboard-preview-modal';
import './content-area.css';

// Minimal inline component implementing @path autocomplete for the instructions textarea only
const InstructionsTextareaWithPathAutocomplete = ({
  allFiles,
  selectedFolder,
  expandedNodes,
  toggleExpanded,
  value,
  onChange,
  onSelectFilePath,
}: {
  allFiles: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  toggleExpanded: (path: string, currentState?: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  onSelectFilePath: (absolutePath: string) => void;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [anchorPosition, setAnchorPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Build searchable list once per allFiles change
  const fileItems = useMemo(() => {
    const root = selectedFolder || "";
    return allFiles
      .filter((f) => !f.isDirectory)
      .map((f) => {
        const rel = getRelativePath(normalizePath(f.path), normalizePath(root));
        return { abs: f.path, rel };
      });
  }, [allFiles, selectedFolder]);

  // Filter results based on current query
  const results = useMemo(() => {
    if (!open) return [] as { abs: string; rel: string }[];
    const q = query.trim().toLowerCase();
    if (!q) {
      return fileItems.slice(0, 12);
    }
    // Case-insensitive partial match against rel path
    const filtered = fileItems.filter((it) => it.rel.toLowerCase().includes(q));
    // Light sort: shortest rel path first then lexicographic
    filtered.sort((a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
    return filtered.slice(0, 12);
  }, [fileItems, query, open]);

  // Helper: find @mention span preceding caret
  const computeQueryFromValue = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = before.match(/@([^\s]*)$/);
    if (match) {
      return match[1];
    }
    return null;
  };

  // Calculate cursor position in pixels
  const getCursorCoordinates = (textarea: HTMLTextAreaElement, position: number) => {
    // Simplified approach: calculate based on text position
    const textBeforeCursor = textarea.value.substring(0, position);
    const textLines = textBeforeCursor.split('\n');
    const currentLine = textLines[textLines.length - 1];
    
    // Find the @ position in the current line
    const atMatch = currentLine.match(/@([^\s]*)$/);
    const atPosition = atMatch ? currentLine.length - atMatch[0].length : currentLine.length;
    
    // Get computed styles for measurements
    const computed = window.getComputedStyle(textarea);
    const lineHeight = parseInt(computed.lineHeight) || 20;
    const fontSize = parseInt(computed.fontSize) || 14;
    const charWidth = fontSize * 0.6; // Approximate char width for monospace
    
    // Calculate horizontal position - align with @ symbol
    const xPosition = atPosition * charWidth;
    
    // Calculate vertical position - place above with extra spacing
    const dropdownHeight = 260; // Approx dropdown height
    const extraSpacing = 30; // Extra space between dropdown and text
    const yPosition = (textLines.length - 1) * lineHeight - dropdownHeight - extraSpacing;
    
    // If dropdown would go above viewport, place it below instead
    const placeBelow = yPosition < 5;
    const finalY = placeBelow 
      ? textLines.length * lineHeight + extraSpacing 
      : yPosition;
    
    return {
      x: Math.min(xPosition, textarea.offsetWidth - 250), // Keep within textarea bounds
      y: Math.max(finalY, 5) // Ensure minimum distance from top
    };
  };

  // Ensure parent folders expanded to reveal the file
  const ensureAncestorsExpanded = (absPath: string) => {
    if (!selectedFolder) return;
    let current = dirname(absPath);
    const rootNorm = normalizePath(selectedFolder);
    while (current && normalizePath(current).startsWith(rootNorm)) {
      const norm = normalizePath(current);
      if (norm === rootNorm) break;
      const isExpanded = expandedNodes[norm] === true;
      if (!isExpanded) {
        // If we know it's currently false, pass false to toggle to true
        const state = expandedNodes[norm];
        if (state === false) {
          toggleExpanded(norm, false);
        } else {
          toggleExpanded(norm); // undefined -> expand
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };

  // Open/close and derive query on input
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);
    const caret = e.target.selectionStart ?? text.length;
    const q = computeQueryFromValue(text, caret);
    if (q !== null) {
      setQuery(q);
      // Calculate cursor position for dropdown placement
      const coords = getCursorCoordinates(e.target, caret);
      setAnchorPosition(coords);
      setOpen(true);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  };

  const close = () => setOpen(false);

  const acceptSelection = (item: { abs: string; rel: string }) => {
    const el = textareaRef.current;
    const text = value;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const match = before.match(/@([^\s]*)$/);
    if (!match || match.index === undefined) return;
    const start = match.index;
    // Wrap the relative path in backticks for inline code formatting
    const inserted = `\`${item.rel}\``;
    const newText = before.slice(0, start) + inserted + text.slice(caret);
    onChange(newText);
    onSelectFilePath(item.abs);
    ensureAncestorsExpanded(item.abs);
    // keep focus
    setTimeout(() => textareaRef.current?.focus(), 0);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      setActiveIndex((i) => (i + dir + results.length) % results.length);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      acceptSelection(results[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  // Clicking outside closes
  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={containerRef} className="autocomplete-container">
      <textarea
        ref={textareaRef}
        className="user-instructions-input"
        placeholder="Enter your instructions here..."
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {open && results.length > 0 && (
        <div
          className="autocomplete-dropdown"
          style={{
            left: anchorPosition.x,
            top: anchorPosition.y,
          }}
        >
          <div className="autocomplete-header">Files</div>
          {results.map((item, idx) => (
            <div
              key={item.abs}
              className={`autocomplete-item ${idx === activeIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptSelection(item);
              }}
            >
              <span>{item.rel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


interface ContentAreaProps {
  selectedFiles: SelectedFileReference[];
  allFiles: FileData[];
  toggleFileSelection: (filePath: string) => void;
  toggleSelection: (filePath: string, lineRange?: LineRange) => void;
  openFolder: () => void;
  onViewFile: (filePath: string) => void;
  processingStatus: {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
  };
  selectedSystemPrompts: SystemPrompt[];
  toggleSystemPromptSelection: (prompt: SystemPrompt) => void;
  onViewSystemPrompt?: (prompt: SystemPrompt) => void;
  selectedRolePrompts: RolePrompt[];
  toggleRolePromptSelection: (prompt: RolePrompt) => void;
  onViewRolePrompt?: (prompt: RolePrompt) => void;
  selectedInstructions: Instruction[];
  toggleInstructionSelection: (instruction: Instruction) => void;
  onViewInstruction?: (instruction: Instruction) => void;
  sortOrder: string;
  handleSortChange: (newSort: string) => void;
  sortDropdownOpen: boolean;
  toggleSortDropdown: () => void;
  sortOptions: { value: string; label: string }[];
  getSelectedFilesContent: () => string;
  calculateTotalTokens: () => number;
  instructionsTokenCount: number;
  userInstructions: string;
  setUserInstructions: (instructions: string) => void;
  fileTreeTokens: number;
  systemPromptTokens: number;
  rolePromptTokens: number;
  instructionsTokens: number;
  setSystemPromptsModalOpen: (open: boolean) => void;
  setRolePromptsModalOpen: (open: boolean) => void;
  setInstructionsModalOpen: (open: boolean) => void;
  loadFileContent: (filePath: string) => Promise<void>;
  clipboardPreviewModalOpen: boolean;
  previewContent: string;
  previewTokenCount: number;
  openClipboardPreviewModal: (content: string, tokenCount: number) => void;
  closeClipboardPreviewModal: () => void;
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  toggleExpanded: (path: string, currentState?: boolean) => void;
}

const ContentArea = ({
  selectedFiles,
  allFiles,
  toggleFileSelection,
  toggleSelection,
  openFolder,
  onViewFile,
  processingStatus,
  selectedSystemPrompts,
  toggleSystemPromptSelection,
  onViewSystemPrompt,
  selectedRolePrompts,
  toggleRolePromptSelection,
  onViewRolePrompt,
  selectedInstructions,
  toggleInstructionSelection,
  onViewInstruction,
  sortOrder,
  handleSortChange,
  sortOptions,
  getSelectedFilesContent,
  calculateTotalTokens,
  instructionsTokenCount,
  userInstructions,
  setUserInstructions,
  fileTreeTokens,
  systemPromptTokens,
  rolePromptTokens,
  instructionsTokens,
  setSystemPromptsModalOpen,
  setRolePromptsModalOpen,
  setInstructionsModalOpen,
  loadFileContent,
  clipboardPreviewModalOpen,
  previewContent,
  previewTokenCount,
  openClipboardPreviewModal,
  closeClipboardPreviewModal,
  selectedFolder,
  expandedNodes,
  toggleExpanded,
}: ContentAreaProps) => {

  const handleCopyWithLoading = async (getContent: () => string): Promise<string> => {
    // Create a Map of all files for quick lookup
    const allFilesMap = new Map(allFiles.map(file => [file.path, file]));

    // Find selected files that haven't loaded content yet
    const unloadedFiles = selectedFiles.filter((selectedFile) => {
      const file = allFilesMap.get(selectedFile.path);
      return file && !file.isContentLoaded;
    });

    if (unloadedFiles.length > 0) {
      await Promise.all(unloadedFiles.map((f) => loadFileContent(f.path)));
    }
    return getContent();
  };

  const handlePreview = async () => {
    const content = await handleCopyWithLoading(getSelectedFilesContent);
    const totalTokens = calculateTotalTokens() + fileTreeTokens + systemPromptTokens + rolePromptTokens + 
                       instructionsTokens + (userInstructions.trim() ? instructionsTokenCount : 0);
    openClipboardPreviewModal(content, totalTokens);
  };

  const handleCopyFromPreview = async () => {
    try {
      await navigator.clipboard.writeText(previewContent);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Modern browsers should support clipboard API, but show alert if it fails
      alert('Failed to copy to clipboard. Please try selecting and copying the text manually.');
    }
  };

  return (
    <div className="content-area">
      <div className="selected-files-content-area">
        <div className="selected-files-content-header">
          <div className="content-actions">
            <Dropdown
              options={sortOptions.map(option => ({
                value: option.value,
                label: option.label
              }))}
              value={sortOrder}
              onChange={handleSortChange}
              buttonLabel="Sort"
              buttonIcon={<ChevronDown size={16} />}
              containerClassName="sort-dropdown sort-dropdown-selected-files"
              buttonClassName="sort-dropdown-button"
              menuClassName="sort-options"
              itemClassName="sort-option"
              activeItemClassName="active"
            />
            <div className="file-stats">
              {(() => {
                // Count all content items
                const fileCount = selectedFiles.length;
                const promptCount = selectedSystemPrompts.length + selectedRolePrompts.length;
                const docCount = selectedInstructions.length;
                const totalItems = fileCount + promptCount + docCount;
                
                // Calculate total tokens including all sources - using Map for O(1) lookups
                const sizeByPath = new Map(
                  allFiles
                    .filter(f => !f.isDirectory && !f.isBinary && !f.isSkipped)
                    .map(f => [f.path, f.size ?? 0])
                );
                const totalSize = selectedFiles.reduce((sum, s) => sum + (sizeByPath.get(s.path) ?? 0), 0);
                const filesTokens = Math.round(totalSize / 4);
                
                const totalEstimatedTokens = filesTokens + systemPromptTokens + rolePromptTokens + instructionsTokens;
                
                return `${totalItems} items | ~${totalEstimatedTokens.toLocaleString()} tokens (estimated)`;
              })()}
            </div>
          </div>
          <div className="prompts-buttons-container">
            <button
              className="system-prompts-button"
              onClick={() => setSystemPromptsModalOpen(true)}
            >
              <Settings size={16} />
              <span>System Prompts</span>
              {selectedSystemPrompts.length > 0 && (
                <span className="selected-prompt-indicator"><Check size={12} /> {selectedSystemPrompts.length}</span>
              )}
            </button>

            <button
              className="role-prompts-button"
              onClick={() => setRolePromptsModalOpen(true)}
            >
              <User size={16} />
              <span>Role Prompts</span>
              {selectedRolePrompts.length > 0 && (
                <span className="selected-prompt-indicator"><Check size={12} /> {selectedRolePrompts.length}</span>
              )}
            </button>

            <button
              className="docs-button"
              onClick={() => setInstructionsModalOpen(true)}
            >
              <FileText size={16} />
              <span>Docs</span>
              {selectedInstructions.length > 0 && (
                <span className="selected-prompt-indicator"><Check size={12} /> {selectedInstructions.length}</span>
              )}
            </button>
          </div>
        </div>

        <FileList
          files={allFiles}
          selectedFiles={selectedFiles}
          toggleFileSelection={toggleFileSelection}
          toggleSelection={toggleSelection}
          openFolder={openFolder}
          onViewFile={onViewFile}
          processingStatus={processingStatus}
          selectedSystemPrompts={selectedSystemPrompts}
          toggleSystemPromptSelection={toggleSystemPromptSelection}
          onViewSystemPrompt={onViewSystemPrompt}
          selectedRolePrompts={selectedRolePrompts}
          toggleRolePromptSelection={toggleRolePromptSelection}
          onViewRolePrompt={onViewRolePrompt}
          selectedInstructions={selectedInstructions}
          toggleInstructionSelection={toggleInstructionSelection}
          onViewInstruction={onViewInstruction}
          loadFileContent={loadFileContent}
        />
      </div>
      <div className="user-instructions-input-area">
        <div className="instructions-token-count">
          ~{instructionsTokenCount.toLocaleString()} tokens
        </div>
        <InstructionsTextareaWithPathAutocomplete
          allFiles={allFiles}
          selectedFolder={selectedFolder}
          expandedNodes={expandedNodes}
          toggleExpanded={toggleExpanded}
          value={userInstructions}
          onChange={setUserInstructions}
          onSelectFilePath={(path) => {
            // Also select the file
            toggleFileSelection(path);
          }}
        />
        <div className="copy-button-container">
          <div className="copy-button-group">
            {(() => {
              const hasPreviewableContent =
                selectedFiles.length > 0 ||
                selectedSystemPrompts.length > 0 ||
                selectedRolePrompts.length > 0 ||
                selectedInstructions.length > 0 ||
                userInstructions.trim().length > 0;
              return (
                <button
                  className="preview-button"
                  onClick={handlePreview}
                  disabled={!hasPreviewableContent}
                >
                  <Eye size={16} />
                  <span>Preview</span>
                </button>
              );
            })()}
            <CopyButton
              text={() => handleCopyWithLoading(getSelectedFilesContent)}
              className="primary copy-selected-files-btn"
            >
              <span>COPY ALL SELECTED ({selectedFiles.length} files)</span>
            </CopyButton>
            <div className="token-count-display">
              ~{(() => {
                // Calculate total tokens for selected files
                const filesTokens = calculateTotalTokens();

                // Add tokens for file tree and prompts from props
                let total = filesTokens + fileTreeTokens + systemPromptTokens + rolePromptTokens + instructionsTokens;

                // Add tokens for user instructions if they exist
                if (userInstructions.trim()) {
                  total += instructionsTokenCount;
                }

                return total.toLocaleString();
              })().toString()} tokens (loaded files only)
            </div>
          </div>
        </div>
      </div>

      <ClipboardPreviewModal
        isOpen={clipboardPreviewModalOpen}
        onClose={closeClipboardPreviewModal}
        content={previewContent}
        tokenCount={previewTokenCount}
        onCopy={handleCopyFromPreview}
      />
    </div>
  );
};

export default memo(ContentArea);