import { Archive, Check, Folder, Loader2, Save } from 'lucide-react'; // Added Check, Loader2
import { useState } from 'react';

import { FileTreeMode } from '../types/file-types';

import FileTreeToggle from './file-tree-toggle';
import ThemeToggle from './theme-toggle';
import WorkspaceDropdown from './workspace-dropdown'; // Import the actual component
import WorkspaceModal from './workspace-modal';

interface AppHeaderProps {
  selectedFolder: string | null;
  fileTreeMode: FileTreeMode;
  setFileTreeMode: (mode: FileTreeMode) => void;
  tokenCounts: Record<FileTreeMode, number>;
  toggleWorkspaceModal?: () => void;
  currentWorkspace?: string | null;
  saveCurrentWorkspace?: () => void;
  headerSaveState?: 'idle' | 'saving' | 'success'; // Add the new prop type
}

const AppHeader = ({
  selectedFolder,
  fileTreeMode,
  setFileTreeMode,
  tokenCounts,
  toggleWorkspaceModal,
  currentWorkspace,
  saveCurrentWorkspace,
  headerSaveState // Destructure the new prop
}: AppHeaderProps): JSX.Element => {
  const [localIsWorkspaceModalOpen, setLocalIsWorkspaceModalOpen] = useState(false);
  // Removed renameTarget state
  
  console.log("[AppHeader] Rendering with currentWorkspace:", currentWorkspace);
  
  const handleWorkspaceToggle = () => {
    console.log("[AppHeader] Toggling workspace modal.");
    // Removed renameTarget logic
    if (toggleWorkspaceModal) {
      // Use parent-provided toggle if available
      toggleWorkspaceModal();
    } else {
      // Fallback to local state
      setLocalIsWorkspaceModalOpen(!localIsWorkspaceModalOpen); // Toggle local state
    }
  };

  // --- Removed rename-related handlers: ---
  // handleRenameRequest
  // clearRenameTarget

  // --- Removed redundant internal dropdown logic: ---
  // handleSelectAndLoadWorkspace
  // getWorkspaceOptions
  // handleWorkspaceDropdownChange
  // renderCustomOption
  
  const getButtonClassName = () => {
    let className = "workspace-button save-button";
    if (headerSaveState && headerSaveState !== 'idle') {
      className += ` save-${headerSaveState}`;
    }
    return className;
  };

  const getButtonTitle = () => {
    if (headerSaveState === 'saving') {
      return "Saving...";
    } else if (headerSaveState === 'success') {
      return "Saved!";
    } else if (currentWorkspace) {
      return `Save Current Workspace (${currentWorkspace})`;
    } else {
      return "Save Current Workspace (No workspace loaded)";
    }
  };

  return (
    <header className="header">
      <div className="header-actions">
        <div className="folder-info">
          <h1 className="app-title">
            <WorkspaceDropdown
                currentWorkspace={currentWorkspace}
                toggleWorkspaceModal={handleWorkspaceToggle}
                containerClassName="workspace-dropdown"
                buttonClassName="dropdown-header"
            />
            {selectedFolder && 
                <Folder className="folder-icon-app-title" size={24} style={{ marginLeft: '8px', verticalAlign: 'middle' }} />
            }
          </h1>
        </div>
        <FileTreeToggle 
          currentMode={fileTreeMode} 
          onChange={setFileTreeMode} 
          tokenCounts={tokenCounts}
        />
        <button 
          onClick={handleWorkspaceToggle} 
          className="workspace-button"
          title="Manage Workspaces"
        >
          <Archive size={18} />
        </button>
        {saveCurrentWorkspace && (
          <button
            onClick={saveCurrentWorkspace}
            className={getButtonClassName()}
            title={getButtonTitle()}
            disabled={!currentWorkspace || headerSaveState === 'saving' || headerSaveState === 'success'} // Disable when no workspace or during save/success
            style={{ position: 'relative', overflow: 'hidden' }} // Needed for icon positioning
          >
            {/* Conditionally render icon based on headerSaveState */}
            {headerSaveState === 'idle' && <Save size={18} />}
            {headerSaveState === 'saving' && <Loader2 size={18} className="button-icon spin" />}
            {headerSaveState === 'success' && <Check size={18} className="button-icon success-check" />}
          </button>
        )}
        <ThemeToggle />
      </div>
      {!toggleWorkspaceModal && (
        <WorkspaceModal
          isOpen={localIsWorkspaceModalOpen}
          onClose={() => {
            setLocalIsWorkspaceModalOpen(false);
            // clearRenameTarget call removed
          }}
          // initialRenameTarget prop removed
          // onClearInitialRenameTarget prop removed
        />
      )}
    </header>
  );
};

export default AppHeader;