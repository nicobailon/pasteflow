import { useContext } from 'react';

import { FileSystemContext, FileSystemContextType } from '../context/file-system-context';

export const useFileSystemState = (): FileSystemContextType => {
  const context = useContext(FileSystemContext);
  if (context === undefined) {
    throw new Error('useFileSystemState must be used within a FileSystemProvider');
  }
  return context;
}; 