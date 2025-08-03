import { useState, useCallback } from 'react';

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