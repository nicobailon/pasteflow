import { useState, useCallback } from 'react';

import { SystemPrompt, RolePrompt, Instruction } from '../types/file-types';

/**
 * Custom hook to manage the visibility state of all modals
 * 
 * @returns {Object} Modal state and toggle functions
 */
const useModalState = () => {
  // Modal visibility states
  const [showApplyChangesModal, setShowApplyChangesModal] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [fileViewModalOpen, setFileViewModalOpen] = useState(false);
  const [systemPromptsModalOpen, setSystemPromptsModalOpen] = useState(false);
  const [rolePromptsModalOpen, setRolePromptsModalOpen] = useState(false);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);
  const [clipboardPreviewModalOpen, setClipboardPreviewModalOpen] = useState(false);
  
  // Track currently viewed file path for file view modal
  const [currentViewedFilePath, setCurrentViewedFilePath] = useState("");
  
  // Track which prompt/instruction to edit when opening modal
  const [systemPromptToEdit, setSystemPromptToEdit] = useState<SystemPrompt | null>(null);
  const [rolePromptToEdit, setRolePromptToEdit] = useState<RolePrompt | null>(null);
  const [instructionToEdit, setInstructionToEdit] = useState<Instruction | null>(null);
  
  // Track clipboard preview content and token count
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewTokenCount, setPreviewTokenCount] = useState<number>(0);

  // Modal toggle functions
  const toggleApplyChangesModal = useCallback(() => {
    setShowApplyChangesModal((prev: boolean) => !prev);
  }, []);

  const toggleFilterModal = useCallback(() => {
    setFilterModalOpen((prev: boolean) => !prev);
  }, []);

  const toggleSystemPromptsModal = useCallback(() => {
    setSystemPromptsModalOpen((prev: boolean) => !prev);
  }, []);

  const toggleRolePromptsModal = useCallback(() => {
    setRolePromptsModalOpen((prev: boolean) => !prev);
  }, []);
  
  const toggleInstructionsModal = useCallback(() => {
    setInstructionsModalOpen((prev: boolean) => !prev);
  }, []);

  const toggleClipboardPreviewModal = useCallback(() => {
    setClipboardPreviewModalOpen((prev: boolean) => !prev);
  }, []);

  // Function to open the file view modal
  const openFileViewModal = useCallback((filePath: string) => {
    setCurrentViewedFilePath(filePath);
    setFileViewModalOpen(true);
  }, []);

  // Function to close the file view modal
  const closeFileViewModal = useCallback(() => {
    setFileViewModalOpen(false);
  }, []);

  // Function to open the clipboard preview modal
  const openClipboardPreviewModal = useCallback((content: string, tokenCount: number) => {
    setPreviewContent(content);
    setPreviewTokenCount(tokenCount);
    setClipboardPreviewModalOpen(true);
  }, []);

  // Function to close the clipboard preview modal
  const closeClipboardPreviewModal = useCallback(() => {
    setClipboardPreviewModalOpen(false);
  }, []);

  // Function to open system prompts modal with a specific prompt for editing
  const openSystemPromptsModalForEdit = useCallback((prompt: SystemPrompt) => {
    setSystemPromptToEdit(prompt);
    setSystemPromptsModalOpen(true);
  }, []);

  // Function to open role prompts modal with a specific prompt for editing
  const openRolePromptsModalForEdit = useCallback((prompt: RolePrompt) => {
    setRolePromptToEdit(prompt);
    setRolePromptsModalOpen(true);
  }, []);

  // Function to open instructions modal with a specific instruction for editing
  const openInstructionsModalForEdit = useCallback((instruction: Instruction) => {
    setInstructionToEdit(instruction);
    setInstructionsModalOpen(true);
  }, []);

  // Clear edit state when closing modals
  const closeSystemPromptsModal = useCallback(() => {
    setSystemPromptsModalOpen(false);
    setSystemPromptToEdit(null);
  }, []);

  const closeRolePromptsModal = useCallback(() => {
    setRolePromptsModalOpen(false);
    setRolePromptToEdit(null);
  }, []);

  const closeInstructionsModal = useCallback(() => {
    setInstructionsModalOpen(false);
    setInstructionToEdit(null);
  }, []);

  return {
    // Modal visibility states
    showApplyChangesModal,
    filterModalOpen,
    fileViewModalOpen,
    systemPromptsModalOpen,
    rolePromptsModalOpen,
    instructionsModalOpen,
    clipboardPreviewModalOpen,
    currentViewedFilePath,
    previewContent,
    previewTokenCount,
    systemPromptToEdit,
    rolePromptToEdit,
    instructionToEdit,
    
    // Toggle functions
    toggleApplyChangesModal,
    toggleFilterModal,
    toggleSystemPromptsModal,
    toggleRolePromptsModal,
    toggleInstructionsModal,
    toggleClipboardPreviewModal,
    openFileViewModal,
    closeFileViewModal,
    openClipboardPreviewModal,
    closeClipboardPreviewModal,
    openSystemPromptsModalForEdit,
    openRolePromptsModalForEdit,
    openInstructionsModalForEdit,
    closeSystemPromptsModal,
    closeRolePromptsModal,
    closeInstructionsModal,
    
    // Direct setters
    setShowApplyChangesModal,
    setFilterModalOpen,
    setFileViewModalOpen,
    setSystemPromptsModalOpen,
    setRolePromptsModalOpen,
    setInstructionsModalOpen,
    setClipboardPreviewModalOpen,
    setCurrentViewedFilePath,
    setPreviewContent,
    setPreviewTokenCount
  };
};

export default useModalState;