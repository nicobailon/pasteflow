import { Check, ChevronDown, Eye, FileText, Settings, User } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../utils/logger';

import { FileData, Instruction, LineRange, RolePrompt, SelectedFileReference, SystemPrompt } from '../types/file-types';
import { getRelativePath, dirname, normalizePath } from '../utils/path-utils';

import CopyButton from './copy-button';
import Dropdown from './dropdown';
import FileList from './file-list';
import ClipboardPreviewModal from './clipboard-preview-modal';
import './content-area.css';

// Helper: find @mention span preceding caret
const computeQueryFromValue = (text: string, caret: number) => {
  const before = text.slice(0, caret);
  const match = before.match(/@(\S*)$/);
  if (match) {
    return match[1];
  }
  return null;
};

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

  // Calculate cursor position in pixels
  const getCursorCoordinates = (textarea: HTMLTextAreaElement, position: number) => {
    // Get text before cursor to calculate position
    const textBeforeCursor = textarea.value.slice(0, Math.max(0, position));
    const textLines = textBeforeCursor.split('\n');
    const currentLine = textLines[textLines.length - 1];
    
    // Find the @ position in the current line
    const atMatch = currentLine.match(/@(\S*)$/);
    const atPosition = atMatch ? currentLine.length - atMatch[0].length : currentLine.length;
    
    // Get computed styles for measurements
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseInt(computed.lineHeight) || 24;
    const fontSize = Number.parseInt(computed.fontSize) || 14;
    const padding = Number.parseInt(computed.paddingLeft) || 16;
    const charWidth = fontSize * 0.55; // Approximate char width
    
    // Calculate horizontal position - align with @ symbol
    const xPosition = padding + (atPosition * charWidth);
    
    // Calculate vertical position - place just below the current line
    const currentLineY = (textLines.length - 1) * lineHeight;
    const dropdownOffset = 8; // Small gap between text and dropdown
    const yPosition = currentLineY + lineHeight + dropdownOffset + padding;
    
    // Check if dropdown would go outside textarea bounds
    const dropdownHeight = 200; // Max height from CSS
    const wouldOverflow = yPosition + dropdownHeight > textarea.offsetHeight;
    
    // If it would overflow, place above the line instead
    const finalY = wouldOverflow 
      ? Math.max(5, currentLineY - dropdownHeight - dropdownOffset + padding)
      : yPosition;
    
    return {
      x: Math.min(xPosition, textarea.offsetWidth - 250), // Keep within textarea bounds
      y: finalY
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
    if (q === null) {
      setOpen(false);
    } else {
      setQuery(q);
      // Calculate cursor position for dropdown placement
      const coords = getCursorCoordinates(e.target, caret);
      setAnchorPosition(coords);
      setOpen(true);
      setActiveIndex(0);
    }
  };

  const close = () => setOpen(false);

  const acceptSelection = (item: { abs: string; rel: string }) => {
    const el = textareaRef.current;
    const text = value;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const match = before.match(/@(\S*)$/);
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
    switch (e.key) {
    case 'Tab': {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      setActiveIndex((i) => (i + dir + results.length) % results.length);
    
    break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    
    break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    
    break;
    }
    case 'Enter': {
      e.preventDefault();
      acceptSelection(results[activeIndex]);
    
    break;
    }
    case 'Escape': {
      e.preventDefault();
      close();
    
    break;
    }
    // No default
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
            <button
              key={item.abs}
              className={`autocomplete-item ${idx === activeIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptSelection(item);
              }}
              type="button"
            >
              <span>{item.rel}</span>
            </button>
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

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  const handleCopyWithLoading = async (getContent: () => string): Promise<string> => {
    // Always request loads for all selected files; loadFileContent will skip already-loaded ones
    logger.debug('[ContentArea.handleCopyWithLoading] Ensuring selected files are loaded', selectedFiles.map(f => f.path));
    await Promise.all(selectedFiles.map((f) => loadFileContent(f.path)));

    // Minimal backoff loop: wait briefly if files are still marked loading
    let attempts = 0;
    while (attempts < 3) {
      const map = new Map(allFiles.map(file => [file.path, file]));
      const pending = selectedFiles.some(sel => {
        const d = map.get(sel.path);
        return d && !d.isContentLoaded && d.isCountingTokens;
      });
      if (!pending) break;
      attempts += 1;
      await delay(150);
    }

    // Sanity check: log loaded state for all selected files (from current props snapshot)
    const afterMap = new Map(allFiles.map(file => [file.path, file]));
    const stateSummary = selectedFiles.map(sel => {
      const d = afterMap.get(sel.path);
      return { path: sel.path, isContentLoaded: !!d?.isContentLoaded, hasContent: !!d?.content, error: d?.error };
    });
    logger.debug('[ContentArea.handleCopyWithLoading] Post-load selected states (props snapshot)', stateSummary);

    // After loads resolve, call the provided getter (freshness-safe via refs)
    const result = getContent();

    // Optional: quickly check for placeholders
    if (result.includes('[Content is loading...]')) {
      logger.warn('[ContentArea.handleCopyWithLoading] Output still contains loading placeholders');
    }

    return result;
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
      logger.error('Failed to copy to clipboard:', error);
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