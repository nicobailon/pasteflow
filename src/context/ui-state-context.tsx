import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction, ReactNode, FC } from 'react';

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
  setExpandedNodes: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSortDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setUserInstructions: (instructions: string) => void;
  setInstructionsTokenCount: Dispatch<SetStateAction<number>>;
  setHeaderSaveState: Dispatch<SetStateAction<'idle' | 'saving' | 'success'>>;
  handleSortChange: (newSort: string) => void;
  handleSearchChange: (newSearch: string) => void;
  toggleSortDropdown: () => void;
  toggleExpanded: (nodeId: string) => void;
}

export const UIStateContext = createContext<UIStateContextType | undefined>(undefined);

interface UIStateProviderProps {
  children: ReactNode;
  sortOrder?: string;
  searchTerm?: string;
  fileTreeMode?: FileTreeMode;
  expandedNodes?: Record<string, boolean>;
  sortDropdownOpen?: boolean;
  userInstructions?: string;
  instructionsTokenCount?: number;
  headerSaveState?: 'idle' | 'saving' | 'success';
}

export const UIStateProvider: FC<UIStateProviderProps> = ({
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