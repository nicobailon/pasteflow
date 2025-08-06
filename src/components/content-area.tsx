import { Check, ChevronDown, Eye, FileText, Settings, User } from 'lucide-react';
import { memo } from 'react';

import { FileData, Instruction, LineRange, RolePrompt, SelectedFileReference, SystemPrompt } from '../types/file-types';

import CopyButton from './copy-button';
import Dropdown from './dropdown';
import FileList from './file-list';
import ClipboardPreviewModal from './clipboard-preview-modal';

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
  selectedRolePrompts: RolePrompt[];
  toggleRolePromptSelection: (prompt: RolePrompt) => void;
  selectedInstructions: Instruction[];
  toggleInstructionSelection: (instruction: Instruction) => void;
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
  setSystemPromptsModalOpen: (open: boolean) => void;
  setRolePromptsModalOpen: (open: boolean) => void;
  setInstructionsModalOpen: (open: boolean) => void;
  loadFileContent: (filePath: string) => Promise<void>;
  clipboardPreviewModalOpen: boolean;
  previewContent: string;
  previewTokenCount: number;
  openClipboardPreviewModal: (content: string, tokenCount: number) => void;
  closeClipboardPreviewModal: () => void;
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
  selectedRolePrompts,
  toggleRolePromptSelection,
  selectedInstructions,
  toggleInstructionSelection,
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
  setSystemPromptsModalOpen,
  setRolePromptsModalOpen,
  setInstructionsModalOpen,
  loadFileContent,
  clipboardPreviewModalOpen,
  previewContent,
  previewTokenCount,
  openClipboardPreviewModal,
  closeClipboardPreviewModal
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
                       (userInstructions.trim() ? instructionsTokenCount : 0);
    openClipboardPreviewModal(content, totalTokens);
  };

  const handleCopyFromPreview = async () => {
    try {
      await navigator.clipboard.writeText(previewContent);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      
      const textarea = document.createElement('textarea');
      textarea.value = previewContent;
      textarea.style.position = 'fixed';
      textarea.style.left = '-99999px';
      document.body.append(textarea);
      textarea.select();
      
      try {
        const successful = document.execCommand('copy');
        if (!successful) {
          throw new Error('Fallback copy method failed');
        }
      } catch (error) {
        console.error('Fallback copy method also failed:', error);
        alert('Failed to copy to clipboard. Please try selecting and copying the text manually.');
      } finally {
        textarea.remove();
      }
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
              {selectedFiles.length} files | ~
              {(() => {
                // Calculate estimated tokens based on file sizes
                const totalSize = selectedFiles.reduce((sum, selectedFile) => {
                  const file = allFiles.find(f => f.path === selectedFile.path);
                  return sum + (file?.size || 0);
                }, 0);
                // Rough estimation: 1 token per 4 characters
                const estimatedTokens = Math.round(totalSize / 4);
                return estimatedTokens.toLocaleString();
              })()} tokens (estimated)
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
          selectedRolePrompts={selectedRolePrompts}
          toggleRolePromptSelection={toggleRolePromptSelection}
          selectedInstructions={selectedInstructions}
          toggleInstructionSelection={toggleInstructionSelection}
          loadFileContent={loadFileContent}
        />
      </div>
      <div className="user-instructions-input-area">
        <div className="instructions-token-count">
          ~{instructionsTokenCount.toLocaleString()} tokens
        </div>
        <textarea 
          className="user-instructions-input" 
          placeholder="Enter your instructions here..." 
          value={userInstructions}
          onChange={(e) => setUserInstructions(e.target.value)}
        />
        <div className="copy-button-container">
          <div className="copy-button-group">
            <button 
              className="preview-button"
              onClick={handlePreview}
              disabled={selectedFiles.length === 0}
            >
              <Eye size={16} />
              <span>Preview</span>
            </button>
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
                let total = filesTokens + fileTreeTokens + systemPromptTokens + rolePromptTokens;
                
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