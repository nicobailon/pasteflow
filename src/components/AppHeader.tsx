import React, { useState, useEffect } from 'react';
import { Folder, Save, ChevronDown } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import FileTreeToggle from './FileTreeToggle';
import WorkspaceModal from './WorkspaceModal';
import { FileTreeMode } from '../types/FileTypes';
import { getFolderNameFromPath } from '../utils/fileUtils';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

interface AppHeaderProps {
  selectedFolder: string | null;
  fileTreeMode: FileTreeMode;
  setFileTreeMode: (mode: FileTreeMode) => void;
  tokenCounts: Record<FileTreeMode, number>;
  toggleWorkspaceModal?: () => void;
  currentWorkspace?: string | null;
}

const AppHeader = ({
  selectedFolder,
  fileTreeMode,
  setFileTreeMode,
  tokenCounts,
  toggleWorkspaceModal,
  currentWorkspace
}: AppHeaderProps): JSX.Element => {
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { getWorkspaceNames, loadWorkspace } = useWorkspaceState();
  const [workspaceNames, setWorkspaceNames] = useState([] as string[]);
  
  useEffect(() => {
    setWorkspaceNames(getWorkspaceNames());
  }, [getWorkspaceNames, isWorkspaceModalOpen]);
  
  useEffect(() => {
    if (isDropdownOpen) {
      setWorkspaceNames(getWorkspaceNames());
    }
  }, [isDropdownOpen, getWorkspaceNames]);
  
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
    loadWorkspace(name);
    setIsDropdownOpen(false);
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
                    <div className="dropdown-header" onClick={toggleDropdown}>
                      {currentWorkspace} <ChevronDown size={16} />
                    </div>
                    {isDropdownOpen && (
                      <div className="dropdown-menu">
                        {workspaceNames.length > 0 && (
                          <>
                            {workspaceNames.map((name: string) => (
                              <div 
                                key={name} 
                                className={`dropdown-item ${name === currentWorkspace ? 'active' : ''}`}
                                onClick={() => handleWorkspaceSelect(name)}
                              >
                                {name}
                              </div>
                            ))}
                            <div className="dropdown-divider"></div>
                          </>
                        )}
                        <div className="dropdown-item" onClick={handleWorkspaceToggle}>
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
          <Save size={18} />
        </button>
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