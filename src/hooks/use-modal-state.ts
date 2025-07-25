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
  
  // Track currently viewed file path for file view modal
  const [currentViewedFilePath, setCurrentViewedFilePath] = useState("");

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

  // Function to open the file view modal
  const openFileViewModal = useCallback((filePath: string) => {
    setCurrentViewedFilePath(filePath);
    setFileViewModalOpen(true);
  }, []);

  // Function to close the file view modal
  const closeFileViewModal = useCallback(() => {
    setFileViewModalOpen(false);
  }, []);

  return {
    // Modal visibility states
    showApplyChangesModal,
    filterModalOpen,
    fileViewModalOpen,
    systemPromptsModalOpen,
    rolePromptsModalOpen,
    instructionsModalOpen,
    currentViewedFilePath,
    
    // Toggle functions
    toggleApplyChangesModal,
    toggleFilterModal,
    toggleSystemPromptsModal,
    toggleRolePromptsModal,
    toggleInstructionsModal,
    openFileViewModal,
    closeFileViewModal,
    
    // Direct setters
    setShowApplyChangesModal,
    setFilterModalOpen,
    setFileViewModalOpen,
    setSystemPromptsModalOpen,
    setRolePromptsModalOpen,
    setInstructionsModalOpen,
    setCurrentViewedFilePath
  };
};

export default useModalState;