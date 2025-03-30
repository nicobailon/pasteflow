import { Archive, ChevronDown, Folder, Save } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { useWorkspaceState } from '../hooks/use-workspace-state';
import { FileTreeMode } from '../types/file-types';
import { getFolderNameFromPath } from '../utils/file-utils';

import FileTreeToggle from './file-tree-toggle';
import ThemeToggle from './theme-toggle';
import WorkspaceModal from './workspace-modal';

interface AppHeaderProps {
  selectedFolder: string | null;
  fileTreeMode: FileTreeMode;
  setFileTreeMode: (mode: FileTreeMode) => void;
  tokenCounts: Record<FileTreeMode, number>;
  toggleWorkspaceModal?: () => void;
  currentWorkspace?: string | null;
  saveCurrentWorkspace?: () => void;
}

const AppHeader = ({
  selectedFolder,
  fileTreeMode,
  setFileTreeMode,
  tokenCounts,
  toggleWorkspaceModal,
  currentWorkspace,
  saveCurrentWorkspace
}: AppHeaderProps): JSX.Element => {
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { getWorkspaceNames, loadWorkspace } = useWorkspaceState();
  const [workspaceNames, setWorkspaceNames] = useState([] as string[]);
  
  useEffect(() => {
    if (isWorkspaceModalOpen || isDropdownOpen) {
      setWorkspaceNames(getWorkspaceNames());
    }
  }, [isWorkspaceModalOpen, isDropdownOpen, getWorkspaceNames]);
  
  const handleWorkspaceToggle = () => {
    setIsDropdownOpen(false);
    if (toggleWorkspaceModal) {
      toggleWorkspaceModal();
    } else {
      setIsWorkspaceModalOpen(true);
    }
  };
  
  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };
  
  const handleWorkspaceSelect = (name: string) => {
    const workspace = loadWorkspace(name);
    if (workspace && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workspaceLoaded', { detail: { name, workspace } }));
    }
    setIsDropdownOpen(false);
  };
  
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleDropdown();
    }
  };
  
  const handleWorkspaceItemKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, name: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleWorkspaceSelect(name);
    }
  };
  
  const handleManageWorkspacesKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleWorkspaceToggle();
    }
  };
  
  return (
    <header className="header">
      <div className="header-actions">
        <div className="folder-info">
          <h1 className="app-title">
            {selectedFolder && 
              <span className="folder-name-container"> <Folder className="folder-icon-app-title" size={24} /> 
                {currentWorkspace ? (
                  <div className="workspace-dropdown">
                    <div 
                      className="dropdown-header" 
                      onClick={toggleDropdown}
                      onKeyDown={handleKeyDown}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="true"
                      aria-expanded={isDropdownOpen}
                    >
                      {currentWorkspace} <ChevronDown size={16} />
                    </div>
                    {isDropdownOpen && (
                      <div className="dropdown-menu" role="menu">
                        {workspaceNames.length > 0 && (
                          <>
                            {workspaceNames.map((name: string) => (
                              <div 
                                key={name} 
                                className={`dropdown-item ${name === currentWorkspace ? 'active' : ''}`}
                                onClick={() => handleWorkspaceSelect(name)}
                                onKeyDown={(e) => handleWorkspaceItemKeyDown(e, name)}
                                role="menuitem"
                                tabIndex={0}
                              >
                                {name}
                              </div>
                            ))}
                            <div className="dropdown-divider" role="separator"></div>
                          </>
                        )}
                        <div 
                          className="dropdown-item" 
                          onClick={handleWorkspaceToggle}
                          onKeyDown={handleManageWorkspacesKeyDown}
                          role="menuitem"
                          tabIndex={0}
                        >
                          Manage Workspaces
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="folder-name"> {getFolderNameFromPath(selectedFolder)}</span>
                )}
              </span>
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
            className="workspace-button"
            title={currentWorkspace ? `Save Current Workspace (${currentWorkspace})` : "Save Current Workspace (No workspace loaded)"}
            disabled={!currentWorkspace}
          >
            <Save size={18} />
          </button>
        )}
        <ThemeToggle />
      </div>
      {!toggleWorkspaceModal && (
        <WorkspaceModal
          isOpen={isWorkspaceModalOpen}
          onClose={() => setIsWorkspaceModalOpen(false)}
        />
      )}
    </header>
  );
};

export default AppHeader;