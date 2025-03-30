import React, { createContext, useContext } from 'react';

import { FileTreeMode } from '../types/file-types';

export interface UIState {
  sortOrder: string;
  searchTerm: string;
  fileTreeMode: FileTreeMode;
  expandedNodes: Record<string, boolean>;
  sortDropdownOpen: boolean;
  userInstructions: string;
  instructionsTokenCount: number;
  headerSaveState: 'idle' | 'saving' | 'success';
}

export interface UIStateContextType extends UIState {
  setSortOrder: (order: string) => void;
  setSearchTerm: (term: string) => void;
  setFileTreeMode: (mode: FileTreeMode) => void;
  setExpandedNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSortDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setUserInstructions: (instructions: string) => void;
  setInstructionsTokenCount: React.Dispatch<React.SetStateAction<number>>;
  setHeaderSaveState: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'success'>>;
  handleSortChange: (newSort: string) => void;
  handleSearchChange: (newSearch: string) => void;
  toggleSortDropdown: () => void;
  toggleExpanded: (nodeId: string) => void;
}

export const UIStateContext = createContext<UIStateContextType | undefined>(undefined);

interface UIStateProviderProps {
  children: React.ReactNode;
  sortOrder?: string;
  searchTerm?: string;
  fileTreeMode?: FileTreeMode;
  expandedNodes?: Record<string, boolean>;
  sortDropdownOpen?: boolean;
  userInstructions?: string;
  instructionsTokenCount?: number;
  headerSaveState?: 'idle' | 'saving' | 'success';
}

export const UIStateProvider: React.FC<UIStateProviderProps> = ({
  children,
  sortOrder = 'tokens-desc',
  searchTerm = '',
  fileTreeMode = 'none',
  expandedNodes = {},
  sortDropdownOpen = false,
  userInstructions = '',
  instructionsTokenCount = 0,
  headerSaveState = 'idle',
}) => {
  const value: UIStateContextType = {
    sortOrder,
    searchTerm,
    fileTreeMode,
    expandedNodes,
    sortDropdownOpen,
    userInstructions,
    instructionsTokenCount,
    headerSaveState,
    setSortOrder: () => {},
    setSearchTerm: () => {},
    setFileTreeMode: () => {},
    setExpandedNodes: () => {},
    setSortDropdownOpen: () => {},
    setUserInstructions: () => {},
    setInstructionsTokenCount: () => {},
    setHeaderSaveState: () => {},
    handleSortChange: () => {},
    handleSearchChange: () => {},
    toggleSortDropdown: () => {},
    toggleExpanded: () => {},
  };

  return (
    <UIStateContext.Provider value={value}>
      {children}
    </UIStateContext.Provider>
  );
};

export const useUIState = (): UIStateContextType => {
  const context = useContext(UIStateContext);
  if (context === undefined) {
    throw new Error('useUIState must be used within a UIStateProvider');
  }
  return context;
};