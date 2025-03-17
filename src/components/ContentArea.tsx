import React from 'react';
import { Settings, User } from 'lucide-react';
import FileList from './FileList';
import CopyButton from './CopyButton';
import { FileData, SelectedFileWithLines, SystemPrompt, RolePrompt } from '../types/FileTypes';

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
  getContentWithXmlPrompt: () => string;
  calculateTotalTokens: () => number;
  instructionsTokenCount: number;
  userInstructions: string;
  setUserInstructions: (instructions: string) => void;
  fileTreeTokens: number;
  systemPromptTokens: number;
  rolePromptTokens: number;
  setShowApplyChangesModal: (show: boolean) => void;
  setSystemPromptsModalOpen: (open: boolean) => void;
  setRolePromptsModalOpen: (open: boolean) => void;
}

const ContentArea: React.FC<ContentAreaProps> = ({
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
  sortDropdownOpen,
  toggleSortDropdown,
  sortOptions,
  getSelectedFilesContent,
  getContentWithXmlPrompt,
  calculateTotalTokens,
  instructionsTokenCount,
  userInstructions,
  setUserInstructions,
  fileTreeTokens,
  systemPromptTokens,
  rolePromptTokens,
  setShowApplyChangesModal,
  setSystemPromptsModalOpen,
  setRolePromptsModalOpen
}) => {
  return (
    <div className="content-area">
      <div className="selected-files-content-area">
        <div className="selected-files-content-header">
          <div className="content-actions">
            <strong className="content-title">Selected Files</strong>
            <div className="sort-dropdown sort-dropdown-selected-files">
              <button
                className="sort-dropdown-button"
                onClick={toggleSortDropdown}
              >
                Sort:{" "}
                {sortOptions.find((opt) => opt.value === sortOrder)
                  ?.label || sortOrder}
              </button>
              {sortDropdownOpen && (
                <div className="sort-options">
                  {sortOptions.map((option) => (
                    <div
                      key={option.value}
                      className={`sort-option ${
                        sortOrder === option.value ? "active" : ""
                      }`}
                      onClick={() => handleSortChange(option.value)}
                    >
                      {option.label}
                      {sortOrder === option.value && <span className="checkmark">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="file-stats">
              {selectedFiles.length} files | ~
              {calculateTotalTokens().toLocaleString()} tokens
            </div>
          </div>
          <button
            className="apply-changes-btn"
            onClick={() => setShowApplyChangesModal(true)}
          >
            Apply XML Changes
          </button>

          <div className="prompts-buttons-container">
            <button 
              className="system-prompts-button"
              onClick={() => setSystemPromptsModalOpen(true)}
            >
              <Settings size={16} />
              <span>System Prompts</span>
              {selectedSystemPrompts.length > 0 && (
                <span className="selected-prompt-indicator">{selectedSystemPrompts.length} selected</span>
              )}
            </button>
            
            <button 
              className="role-prompts-button"
              onClick={() => setRolePromptsModalOpen(true)}
            >
              <User size={16} />
              <span>Role Prompts</span>
              {selectedRolePrompts.length > 0 && (
                <span className="selected-prompt-indicator">{selectedRolePrompts.length} selected</span>
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
              text={getSelectedFilesContent}
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
              })().toString()} tokens
            </div>
          </div>
          
          <div className="copy-button-group">
            <CopyButton
              text={getContentWithXmlPrompt}
              className="secondary copy-selected-files-btn"
            >
              <span>COPY WITH XML PROMPT ({selectedFiles.length} files)</span>
            </CopyButton>
            <div className="token-count-display">
              ~{(() => {
                // Calculate total tokens for content with XML prompt
                // This is a simplified calculation since the actual function isn't called here
                const baseTokens = calculateTotalTokens() + fileTreeTokens + systemPromptTokens + rolePromptTokens;
                // Add XML formatting instructions tokens using accurate method
                // We use 800 as more realistic estimation based on actual XML formatting instructions length
                const xmlInstructionsTokens = 800;
                
                let total = baseTokens + xmlInstructionsTokens;
                if (userInstructions.trim()) {
                  total += instructionsTokenCount;
                }
                
                return total.toLocaleString();
              })().toString()} tokens
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContentArea;