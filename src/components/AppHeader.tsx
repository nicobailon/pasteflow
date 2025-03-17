import React from 'react';
import { Folder } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import FileTreeToggle from './FileTreeToggle';
import { FileTreeMode } from '../types/FileTypes';
import { getFolderNameFromPath } from '../utils/fileUtils';

interface AppHeaderProps {
  selectedFolder: string | null;
  fileTreeMode: FileTreeMode;
  setFileTreeMode: (mode: FileTreeMode) => void;
  tokenCounts: Record<FileTreeMode, number>;
}

const AppHeader = ({
  selectedFolder,
  fileTreeMode,
  setFileTreeMode,
  tokenCounts
}: AppHeaderProps): JSX.Element => {
  return (
    <header className="header">
      <div className="header-actions">
        <div className="folder-info">
          <h1 className="app-title">
            {selectedFolder && 
              <span className="folder-name"> <Folder className="folder-icon-app-title" size={24} /> {getFolderNameFromPath(selectedFolder)}</span>
            }
          </h1>
        </div>
        <FileTreeToggle 
          currentMode={fileTreeMode} 
          onChange={setFileTreeMode} 
          tokenCounts={tokenCounts}
        />
        <ThemeToggle />
      </div>
    </header>
  );
};

export default AppHeader;