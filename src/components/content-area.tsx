import { Check, ChevronDown, FileText, Settings, User } from 'lucide-react';

import { FileData, RolePrompt, SelectedFileWithLines, SystemPrompt } from '../types/file-types';

import CopyButton from './copy-button';
import Dropdown from './dropdown';
import FileList from './file-list';

interface ContentAreaProps {
  selectedFiles: SelectedFileWithLines[];
  allFiles: FileData[];
  toggleFileSelection: (filePath: string) => void;
  toggleSelection: (filePath: string, lineRange?: any) => void;
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
  loadFileContent
}: ContentAreaProps) => {
  
  const handleCopyWithLoading = async (getContent: () => string): Promise<string> => {
    const unloadedFiles = selectedFiles.filter((f) => !f.isContentLoaded);
    if (unloadedFiles.length > 0) {
      await Promise.all(unloadedFiles.map((f) => loadFileContent(f.path)));
    }
    return getContent();
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
              {calculateTotalTokens().toLocaleString()} tokens
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
    </div>
  );
};

export default ContentArea;