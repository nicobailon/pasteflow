import { create } from 'zustand';

import type { SystemPrompt, RolePrompt, Instruction } from '../types/file-types';

interface ModalState {
  showApplyChangesModal: boolean;
  filterModalOpen: boolean;
  fileViewModalOpen: boolean;
  systemPromptsModalOpen: boolean;
  rolePromptsModalOpen: boolean;
  instructionsModalOpen: boolean;
  clipboardPreviewModalOpen: boolean;
  currentViewedFilePath: string;
  previewContent: string;
  previewTokenCount: number;
  systemPromptToEdit: SystemPrompt | null;
  rolePromptToEdit: RolePrompt | null;
  instructionToEdit: Instruction | null;
}

interface UIState extends ModalState {
  sortDropdownOpen: boolean;
  sortOrder: string;
  searchTerm: string;
}

interface UIActions {
  toggleApplyChangesModal: () => void;
  toggleFilterModal: () => void;
  toggleSystemPromptsModal: () => void;
  toggleRolePromptsModal: () => void;
  toggleInstructionsModal: () => void;
  toggleClipboardPreviewModal: () => void;
  openFileViewModal: (filePath: string) => void;
  closeFileViewModal: () => void;
  openClipboardPreviewModal: (content: string, tokenCount: number) => void;
  closeClipboardPreviewModal: () => void;
  openSystemPromptsModalForEdit: (prompt: SystemPrompt) => void;
  openRolePromptsModalForEdit: (prompt: RolePrompt) => void;
  openInstructionsModalForEdit: (instruction: Instruction) => void;
  closeSystemPromptsModal: () => void;
  closeRolePromptsModal: () => void;
  closeInstructionsModal: () => void;
  toggleSortDropdown: () => void;
  setSortOrder: (order: string) => void;
  setSearchTerm: (term: string) => void;
  setFilterModalOpen: (open: boolean) => void;
  setSystemPromptsModalOpen: (open: boolean) => void;
  setRolePromptsModalOpen: (open: boolean) => void;
  setInstructionsModalOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  showApplyChangesModal: false,
  filterModalOpen: false,
  fileViewModalOpen: false,
  systemPromptsModalOpen: false,
  rolePromptsModalOpen: false,
  instructionsModalOpen: false,
  clipboardPreviewModalOpen: false,
  currentViewedFilePath: '',
  previewContent: '',
  previewTokenCount: 0,
  systemPromptToEdit: null,
  rolePromptToEdit: null,
  instructionToEdit: null,
  sortDropdownOpen: false,
  sortOrder: 'tokens-desc',
  searchTerm: '',

  toggleApplyChangesModal: () => set((s) => ({ showApplyChangesModal: !s.showApplyChangesModal })),
  toggleFilterModal: () => set((s) => ({ filterModalOpen: !s.filterModalOpen })),
  toggleSystemPromptsModal: () => set((s) => ({ systemPromptsModalOpen: !s.systemPromptsModalOpen })),
  toggleRolePromptsModal: () => set((s) => ({ rolePromptsModalOpen: !s.rolePromptsModalOpen })),
  toggleInstructionsModal: () => set((s) => ({ instructionsModalOpen: !s.instructionsModalOpen })),
  toggleClipboardPreviewModal: () => set((s) => ({ clipboardPreviewModalOpen: !s.clipboardPreviewModalOpen })),

  openFileViewModal: (filePath) => set({ currentViewedFilePath: filePath, fileViewModalOpen: true }),
  closeFileViewModal: () => set({ fileViewModalOpen: false }),

  openClipboardPreviewModal: (content, tokenCount) => set({
    previewContent: content,
    previewTokenCount: tokenCount,
    clipboardPreviewModalOpen: true,
  }),
  closeClipboardPreviewModal: () => set({ clipboardPreviewModalOpen: false }),

  openSystemPromptsModalForEdit: (prompt) => set({ systemPromptToEdit: prompt, systemPromptsModalOpen: true }),
  openRolePromptsModalForEdit: (prompt) => set({ rolePromptToEdit: prompt, rolePromptsModalOpen: true }),
  openInstructionsModalForEdit: (instruction) => set({ instructionToEdit: instruction, instructionsModalOpen: true }),

  closeSystemPromptsModal: () => set({ systemPromptsModalOpen: false, systemPromptToEdit: null }),
  closeRolePromptsModal: () => set({ rolePromptsModalOpen: false, rolePromptToEdit: null }),
  closeInstructionsModal: () => set({ instructionsModalOpen: false, instructionToEdit: null }),

  toggleSortDropdown: () => set((s) => ({ sortDropdownOpen: !s.sortDropdownOpen })),
  setSortOrder: (order) => set({ sortOrder: order, sortDropdownOpen: false }),
  setSearchTerm: (term) => set({ searchTerm: term }),
  setFilterModalOpen: (open) => set({ filterModalOpen: open }),
  setSystemPromptsModalOpen: (open) => set({ systemPromptsModalOpen: open }),
  setRolePromptsModalOpen: (open) => set({ rolePromptsModalOpen: open }),
  setInstructionsModalOpen: (open) => set({ instructionsModalOpen: open }),
}));
