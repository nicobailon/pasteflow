import * as Dialog from "@radix-ui/react-dialog";
import { Check, GripVertical, Loader2, Pencil, X } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';

import { useWorkspaceState } from '../hooks/use-workspace-state';
import { WorkspaceState } from '../types/file-types';
import type { AppState } from '../hooks/use-app-state';
import { STORAGE_KEYS } from '../constants';
import { WORKSPACE_DRAG_SCROLL, WORKSPACE_TRANSFORMS } from '../constants/workspace-drag-constants';
import { safeJsonParse } from '../utils/local-storage-utils';
import { 
  getWorkspaceSortMode, 
  setWorkspaceSortMode, 
  getWorkspaceManualOrder, 
  setWorkspaceManualOrder, 
  sortWorkspaces, 
  moveWorkspace,
  WorkspaceSortMode,
  WorkspaceInfo
} from '../utils/workspace-sorting';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialRenameTarget?: string | null;
  onClearInitialRenameTarget?: () => void;
  appState: AppState;
}

const WorkspaceModal = ({ 
  isOpen, 
  onClose, 
  initialRenameTarget, 
  onClearInitialRenameTarget,
  appState
}: WorkspaceModalProps): JSX.Element => {
  const { 
    saveWorkspace: persistWorkspace, 
    loadWorkspace: loadPersistedWorkspace, 
    deleteWorkspace: deletePersistedWorkspace, 
    renameWorkspace: renamePersistedWorkspace,
    getWorkspaceNames 
  } = useWorkspaceState();
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [workspaceNames, setWorkspaceNames] = useState<string[]>([]);
  const [renamingWsName, setRenamingWsName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set());
  const [selectAllChecked, setSelectAllChecked] = useState(false);
  const [sortMode, setSortMode] = useState<WorkspaceSortMode>(() => getWorkspaceSortMode());
  const [manualOrder, setManualOrder] = useState<string[]>(() => {
    const order = getWorkspaceManualOrder();
    console.log('[WorkspaceModal] Initial manual order:', order);
    return order;
  });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const workspaceListRef = useRef<HTMLDivElement | null>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const refreshWorkspaceList = useCallback(() => {
    const names = getWorkspaceNames();
    console.log("[WorkspaceModal] Refreshing internal workspace list:", names);
    setWorkspaceNames(names);
  }, [getWorkspaceNames]);

  const getSortedWorkspaces = useCallback((): string[] => {
    const workspacesString = localStorage.getItem(STORAGE_KEYS.WORKSPACES);
    const workspaces = safeJsonParse(workspacesString, {});
    
    const workspaceInfos: WorkspaceInfo[] = Object.entries(workspaces).map(([name, data]: [string, any]) => {
      let savedAt = 0;
      if (typeof data === 'string') {
        try {
          const parsed = safeJsonParse(data, { savedAt: 0 });
          savedAt = parsed.savedAt || 0;
        } catch {
          // Ignore parse errors
        }
      } else if (data && typeof data === 'object') {
        savedAt = data.savedAt || 0;
      }
      return { name, savedAt };
    });
    
    const sorted = sortWorkspaces(workspaceInfos, sortMode, manualOrder);
    console.log('[WorkspaceModal] Sorted workspaces:', { sortMode, manualOrder, sorted });
    return sorted;
  }, [sortMode, manualOrder]);

  const handleSortModeChange = useCallback((newMode: WorkspaceSortMode) => {
    if (newMode === 'manual') {
      // When switching to manual, preserve the current order
      const currentOrder = getSortedWorkspaces();
      setManualOrder(currentOrder);
      setWorkspaceManualOrder(currentOrder);
    }
    setSortMode(newMode);
    setWorkspaceSortMode(newMode);
  }, [getSortedWorkspaces]);

  const handleToggleWorkspace = useCallback((workspaceName: string) => {
    setSelectedWorkspaces((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(workspaceName)) {
        newSet.delete(workspaceName);
      } else {
        newSet.add(workspaceName);
      }
      // Update select all state based on selection
      setSelectAllChecked(newSet.size === workspaceNames.length && workspaceNames.length > 0);
      return newSet;
    });
  }, [workspaceNames]);

  const handleSelectAll = useCallback(() => {
    if (selectAllChecked) {
      // Unselect all
      setSelectedWorkspaces(new Set());
      setSelectAllChecked(false);
    } else {
      // Select all
      setSelectedWorkspaces(new Set(workspaceNames));
      setSelectAllChecked(true);
    }
  }, [selectAllChecked, workspaceNames]);

  const handleBulkDelete = useCallback(() => {
    const count = selectedWorkspaces.size;
    if (count === 0) return;

    const message = count === 1 
      ? `Are you sure you want to delete 1 workspace? This cannot be undone.`
      : `Are you sure you want to delete ${count} workspaces? This cannot be undone.`;

    if (window.confirm(message)) {
      console.log(`[WorkspaceModal.handleBulkDelete] User confirmed deletion of ${count} workspaces.`);
      for (const wsName of selectedWorkspaces) {
        deletePersistedWorkspace(wsName);
      }
      setSelectedWorkspaces(new Set());
      setSelectAllChecked(false);
      refreshWorkspaceList();
      console.log(`[WorkspaceModal.handleBulkDelete] Bulk deletion complete.`);
    } else {
      console.log(`[WorkspaceModal.handleBulkDelete] Bulk deletion cancelled by user.`);
    }
  }, [selectedWorkspaces, deletePersistedWorkspace, refreshWorkspaceList]);
  
  const handleRenameStart = (wsName: string) => {
    console.log(`[WorkspaceModal.handleRenameStart] Initiating rename for: ${wsName}`);
    setRenamingWsName(wsName);
    setNewName(wsName); // Pre-fill input with current name
  };

  const handleRenameCancel = () => {
    console.log("[WorkspaceModal.handleRenameCancel] Cancelling rename operation.");
    setRenamingWsName(null);
    setNewName('');
  };
  
  const handleDragStart = useCallback((e: DragEvent, index: number) => {
    console.log('[WorkspaceModal] Drag start:', { index, sortMode });
    // If not in manual mode, switch to it and preserve current order
    if (sortMode !== 'manual') {
      const currentOrder = getSortedWorkspaces();
      console.log('[WorkspaceModal] Switching to manual mode with order:', currentOrder);
      setManualOrder(currentOrder);
      setWorkspaceManualOrder(currentOrder);
      setSortMode('manual');
      setWorkspaceSortMode('manual');
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  }, [sortMode, getSortedWorkspaces]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Auto-scroll functionality
    if (!workspaceListRef.current) return;
    
    const container = workspaceListRef.current;
    const containerRect = container.getBoundingClientRect();
    const mouseY = e.clientY;
    
    // Define scroll zones
    const scrollZoneSize = WORKSPACE_DRAG_SCROLL.ZONE_SIZE;
    const scrollSpeed = WORKSPACE_DRAG_SCROLL.BASE_SPEED;
    
    // Clear any existing scroll interval
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    
    // Check if we're in the top scroll zone
    if (mouseY < containerRect.top + scrollZoneSize) {
      const intensity = 1 - (mouseY - containerRect.top) / scrollZoneSize;
      scrollIntervalRef.current = setInterval(() => {
        container.scrollTop -= scrollSpeed * (1 + intensity * WORKSPACE_DRAG_SCROLL.SPEED_MULTIPLIER);
      }, WORKSPACE_DRAG_SCROLL.INTERVAL_MS);
    }
    // Check if we're in the bottom scroll zone
    else if (mouseY > containerRect.bottom - scrollZoneSize) {
      const intensity = 1 - (containerRect.bottom - mouseY) / scrollZoneSize;
      scrollIntervalRef.current = setInterval(() => {
        container.scrollTop += scrollSpeed * (1 + intensity * WORKSPACE_DRAG_SCROLL.SPEED_MULTIPLIER);
      }, WORKSPACE_DRAG_SCROLL.INTERVAL_MS);
    }
  }, []);
  
  const handleDragOverItem = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === index) return;
    console.log('[WorkspaceModal] Drag over item:', { index, draggedIndex });
    setDragOverIndex(index);
  }, [draggedIndex]);
  
  const handleDragEnter = useCallback((e: DragEvent, _index: number) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent, dropIndex: number) => {
    console.log('[WorkspaceModal] handleDrop called with index:', dropIndex);
    e.preventDefault();
    if (draggedIndex === null) return;
    
    // Clear any active scroll interval
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    
    // Use dragOverIndex if we have it, otherwise use dropIndex
    const targetIndex = dragOverIndex === null ? dropIndex : dragOverIndex;
    
    if (draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    
    const sortedNames = getSortedWorkspaces();
    console.log('[WorkspaceModal] Drop:', {
      draggedIndex,
      targetIndex,
      sortedNames,
      draggedItem: sortedNames[draggedIndex],
      targetItem: sortedNames[targetIndex]
    });
    
    const newOrder = moveWorkspace(sortedNames, draggedIndex, targetIndex);
    console.log('[WorkspaceModal] New order:', newOrder);
    
    // Update both state and localStorage
    console.log('[WorkspaceModal] Setting manual order state:', newOrder);
    setManualOrder(newOrder);
    setWorkspaceManualOrder(newOrder);
    console.log('[WorkspaceModal] Manual order saved to localStorage');
    
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, dragOverIndex, getSortedWorkspaces]);

  const handleDragEnd = useCallback((_e: DragEvent) => {
    console.log('[WorkspaceModal] Drag end called, dragOverIndex:', dragOverIndex);
    
    // If we have a dragOverIndex, use it to reorder (fallback for when drop doesn't fire)
    if (draggedIndex === null || dragOverIndex === null || draggedIndex === dragOverIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      
      // Clear any active scroll interval
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      return;
    }
    
    const sortedNames = getSortedWorkspaces();
    console.log('[WorkspaceModal] Reordering in dragEnd:', {
      draggedIndex,
      dragOverIndex,
      sortedNames
    });
    
    const newOrder = moveWorkspace(sortedNames, draggedIndex, dragOverIndex);
    console.log('[WorkspaceModal] New order in dragEnd:', newOrder);
    
    setManualOrder(newOrder);
    setWorkspaceManualOrder(newOrder);
    
    setDraggedIndex(null);
    setDragOverIndex(null);
    
    // Clear any active scroll interval
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, [draggedIndex, dragOverIndex, getSortedWorkspaces]);
  
  const handleDragLeave = useCallback((e: DragEvent) => {
    // Only stop scrolling if we're leaving the container itself
    if (e.currentTarget === e.target) {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      console.log("[WorkspaceModal] Modal opened. Refreshing workspace list and resetting state.");
      refreshWorkspaceList();
      setName(''); // Reset save input
      setRenamingWsName(null); // Reset renaming state
      setNewName(''); // Reset rename input
      setSelectedWorkspaces(new Set()); // Reset selection
      setSelectAllChecked(false); // Reset select all

      // Check if we need to start in rename mode
      if (!initialRenameTarget || !onClearInitialRenameTarget) return;
      
      console.log(`[WorkspaceModal] Modal opened with initial rename target: ${initialRenameTarget}`);
      // Need a slight delay or ensure the list is rendered before starting rename
      // Using setTimeout to ensure the component has rendered and state updates are processed
      setTimeout(() => {
          handleRenameStart(initialRenameTarget);
          onClearInitialRenameTarget(); // Clear the target in the parent state
      }, 0);
    }
  }, [isOpen, refreshWorkspaceList, initialRenameTarget, onClearInitialRenameTarget]); // Added dependencies

  useEffect(() => {
    // Focus the rename input when renaming starts
    if (renamingWsName && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingWsName]);

  // Debug manual order changes
  useEffect(() => {
    console.log('[WorkspaceModal] Manual order changed:', manualOrder);
  }, [manualOrder]);

  // Clear timeout on unmount or when modal closes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
        console.warn("[WorkspaceModal.handleSave] Save attempt with empty name cancelled.");
        alert("Please enter a workspace name.");
        return;
    }

    console.log(`[WorkspaceModal.handleSave] Attempting to save workspace: ${trimmedName}`);
    setSaveState('saving'); // Indicate saving process start

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (workspaceNames.includes(trimmedName)) {
        if (!window.confirm(`Workspace "${trimmedName}" already exists. Overwrite?`)) {
            console.log("[WorkspaceModal.handleSave] Overwrite cancelled by user.");
            return;
        }
        console.log(`[WorkspaceModal.handleSave] User confirmed overwrite for "${trimmedName}".`);
    }

    console.log('[WorkspaceModal.handleSave] Reading current application state from appState hook...');
    const workspaceToSave: WorkspaceState = {
      selectedFolder: appState.selectedFolder,
      expandedNodes: appState.expandedNodes,
      selectedFiles: appState.selectedFiles,
      userInstructions: appState.userInstructions,
      allFiles: appState.allFiles || [],
      sortOrder: appState.sortOrder || "name",
      searchTerm: appState.searchTerm || "",
      fileTreeMode: appState.fileTreeMode || "none",
      exclusionPatterns: appState.exclusionPatterns || [],
      tokenCounts: (() => {
        const acc: { [filePath: string]: number } = {};
        for (const file of appState.selectedFiles) {
          acc[file.path] = file.tokenCount || 0;
        }
        return acc;
      })(),
      customPrompts: {
        systemPrompts: appState.selectedSystemPrompts,
        rolePrompts: appState.selectedRolePrompts
      }
    };

    console.log('[WorkspaceModal.handleSave] Constructed workspace state object from appState:', {
        name: trimmedName,
        expandedNodesKeys: Object.keys(workspaceToSave.expandedNodes || {}).length,
        selectedFilesCount: workspaceToSave.selectedFiles.length,
        userInstructionsLength: workspaceToSave.userInstructions?.length || 0,
        systemPromptsCount: workspaceToSave.customPrompts?.systemPrompts?.length || 0,
        rolePromptsCount: workspaceToSave.customPrompts?.rolePrompts?.length || 0,
    });

    try {
      persistWorkspace(trimmedName, workspaceToSave);
      console.log(`[WorkspaceModal.handleSave] persistWorkspace successful for "${trimmedName}".`);
      setSaveState('success'); // Set state to success
      refreshWorkspaceList(); // Refresh list *after* successful save

      // Set timeout to revert state and clear the form, keeping the modal open
      saveTimeoutRef.current = setTimeout(() => {
        setSaveState('idle');
        setName(''); // Clear the input field
        console.log(`[WorkspaceModal.handleSave] Save success state finished for "${trimmedName}". Form cleared.`);
      }, 1500); // Duration for the checkmark visibility

    } catch (error) {
      console.error(`[WorkspaceModal.handleSave] Error during persistWorkspace for "${trimmedName}":`, error);
      setSaveState('idle'); // Revert to idle on error
      alert(`Failed to save workspace "${trimmedName}". Check console for details.`);
      // Optionally add an 'error' state if more specific feedback is needed
    }
  };
  
  const handleDelete = (wsName: string) => {
    console.log(`[WorkspaceModal.handleDelete] Attempting to delete workspace: ${wsName}`);
    if (window.confirm(`Are you sure you want to delete workspace "${wsName}"? This cannot be undone.`)) {
      console.log(`[WorkspaceModal.handleDelete] User confirmed deletion for "${wsName}".`);
      deletePersistedWorkspace(wsName);
      refreshWorkspaceList();
      console.log(`[WorkspaceModal.handleDelete] Deletion process complete for "${wsName}".`);
    } else {
       console.log(`[WorkspaceModal.handleDelete] Deletion cancelled by user for "${wsName}".`);
    }
  };

  const handleLoad = (wsName: string) => {
    console.log(`[WorkspaceModal.handleLoad] Attempting to load workspace: ${wsName}`);
    try {
      const workspaceData = loadPersistedWorkspace(wsName);
      if (workspaceData) {
        console.log(`[WorkspaceModal.handleLoad] Workspace "${wsName}" loaded successfully via hook. Dispatching 'workspaceLoaded' event.`);
        window.dispatchEvent(new CustomEvent('workspaceLoaded', { detail: { name: wsName, workspace: workspaceData } }));
        onClose();
        console.log(`[WorkspaceModal.handleLoad] Load process complete for "${wsName}". Modal closed.`);
      } else {
        console.error(`[WorkspaceModal.handleLoad] loadPersistedWorkspace returned null for "${wsName}". Load failed.`);
        // No alert - workspace has been auto-deleted if corrupted
        refreshWorkspaceList(); // Refresh the list to remove the corrupted workspace
      }
    } catch (error) {
      console.error(`[WorkspaceModal.handleLoad] Error during loadPersistedWorkspace call for "${wsName}":`, error);
      // No alert - just log the error
      refreshWorkspaceList(); // Refresh the list to remove the corrupted workspace
    }
  };
 
  const handleRenameConfirm = () => {
    if (!renamingWsName || !newName.trim() || renamingWsName === newName.trim()) {
      console.warn("[WorkspaceModal.handleRenameConfirm] Rename cancelled - invalid state or no change.");
      handleRenameCancel(); // Exit rename mode if names are same or new name is empty
      return;
    }
    const trimmedNewName = newName.trim();
    console.log(`[WorkspaceModal.handleRenameConfirm] Attempting rename: "${renamingWsName}" -> "${trimmedNewName}"`);
    
    // Check if new name already exists (excluding the one being renamed)
    if (workspaceNames.filter((name: string) => name !== renamingWsName).includes(trimmedNewName)) { // Added type annotation
        alert(`Workspace name "${trimmedNewName}" already exists. Please choose a different name.`);
        console.warn(`[WorkspaceModal.handleRenameConfirm] Rename failed: Name "${trimmedNewName}" already exists.`);
        return; // Keep rename mode active for user to correct
    }

    const success = renamePersistedWorkspace(renamingWsName, trimmedNewName);
    if (success) {
      console.log(`[WorkspaceModal.handleRenameConfirm] Rename successful via hook for "${renamingWsName}" -> "${trimmedNewName}".`);
      refreshWorkspaceList();
      handleRenameCancel(); // Exit rename mode
    } else {
      // Error likely logged in the hook, maybe show an alert here too
      console.error(`[WorkspaceModal.handleRenameConfirm] Rename failed for "${renamingWsName}" -> "${trimmedNewName}". Hook returned false.`);
      alert(`Failed to rename workspace "${renamingWsName}". Check console for details.`);
      // Optionally keep rename mode active or cancel
      // handleRenameCancel(); 
    }
  };

  // Function to generate class name for the apply button
  const getApplyButtonClassName = () => {
    let className = "apply-button save-button";
    if (saveState !== 'idle') {
      className += ` save-${saveState}`;
    }
    return className;
  };

  // Function to generate title for the apply button
  const getApplyButtonTitle = () => {
    if (renamingWsName) {
      return "Complete or cancel the current rename operation first";
    }
    if (saveState === 'saving') {
      return "Saving...";
    }
    if (saveState === 'success') {
      return "Saved!";
    }
    return workspaceNames.includes(name.trim()) ? 'Overwrite Workspace' : 'Save Workspace';
  };

  // Function to determine the button text content
  const getApplyButtonText = () => {
    return workspaceNames.includes(name.trim()) ? 'Overwrite Workspace' : 'Save Workspace';
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content workspace-modal" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Manage Workspaces</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button"><X size={16} /></button>
            </Dialog.Close>
          </div>
          
          <div className="modal-body">
            <div className="workspace-form">
              <input
                type="text"
                className="prompt-title-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter workspace name"
                disabled={!!renamingWsName} // Disable if renaming is active
                title={renamingWsName ? "Complete or cancel the current rename operation first" : "Enter workspace name"}
                ref={nameInputRef}
              />
              <button 
                className={getApplyButtonClassName()}
                onClick={handleSave}
                disabled={!name.trim() || !!renamingWsName || saveState === 'saving' || saveState === 'success'} // Disable during saving/success/renaming
                title={getApplyButtonTitle()}
                style={{ position: 'relative', overflow: 'hidden' }} // Needed for absolute positioning of icon
              >
                <span className={`button-text ${saveState === 'idle' ? '' : 'hide'}`}>
                  {getApplyButtonText()}
                </span>
                 {saveState === 'saving' && (
                  <Loader2 size={16} className="button-icon spin" />
                )}
                {saveState === 'success' && (
                  <Check size={16} className="button-icon success-check" />
                )}
              </button>
              
              <div className="workspace-header">
                <div className="workspace-header-left">
                  <h3 className="workspace-subtitle">Saved Workspaces</h3>
                  {workspaceNames.length > 0 && (
                    <div className="workspace-sort-selector">
                      <select
                        value={sortMode}
                        onChange={(e) => handleSortModeChange(e.target.value as WorkspaceSortMode)}
                        className="workspace-sort-dropdown"
                      >
                        <option value="recent">Most Recent</option>
                        <option value="alphabetical">Alphabetical</option>
                        <option value="manual">Manual Order</option>
                      </select>
                    </div>
                  )}
                </div>
                {workspaceNames.length > 0 && (
                  <div className="workspace-select-all">
                    <div className="workspace-checkbox-container">
                      <input
                        type="checkbox"
                        id="workspace-select-all"
                        className="tree-item-checkbox"
                        checked={selectAllChecked}
                        onChange={handleSelectAll}
                      />
                      <label htmlFor="workspace-select-all" className="custom-checkbox" aria-label="Select all workspaces" />
                    </div>
                    <label htmlFor="workspace-select-all" className="select-all-label">Select All</label>
                  </div>
                )}
              </div>
              
              {selectedWorkspaces.size > 0 && (
                <div className="bulk-actions-bar">
                  <span className="selected-count">
                    {selectedWorkspaces.size} workspace{selectedWorkspaces.size === 1 ? '' : 's'} selected
                  </span>
                  <div className="bulk-actions">
                    <button 
                      className="bulk-action-button delete"
                      onClick={handleBulkDelete}
                    >
                      Delete Selected
                    </button>
                    <button 
                      className="bulk-action-button clear"
                      onClick={() => {
                        setSelectedWorkspaces(new Set());
                        setSelectAllChecked(false);
                      }}
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              )}
              
              {workspaceNames.length === 0 ? (
                <div className="no-prompts-message">
                  No workspaces saved yet.
                </div>
              ) : (
                <div 
                  className="workspace-list" 
                  ref={workspaceListRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  {getSortedWorkspaces().map((wsName: string, index: number) => {
                    const isDragging = draggedIndex === index;
                    const isDragOver = dragOverIndex === index;
                    const shouldShowGap = isDragOver && draggedIndex !== null && draggedIndex !== index;
                    
                    return (
                      <div 
                        key={wsName} 
                        className={`workspace-item draggable ${isDragging ? 'dragging' : ''} ${shouldShowGap ? 'drag-over' : ''}`}
                        draggable={renamingWsName !== wsName}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnter={(e) => handleDragEnter(e, index)}
                        onDragOver={(e) => handleDragOverItem(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        style={{
                          transform: (() => {
                            if (draggedIndex === null) return 'translateY(0)';
                            if (dragOverIndex === null) return 'translateY(0)';
                            
                            // Create space for the dragged item
                            if (draggedIndex < dragOverIndex) {
                              // Dragging down
                              if (index > draggedIndex && index <= dragOverIndex) {
                                return WORKSPACE_TRANSFORMS.MOVE_UP;
                              }
                            } else {
                              // Dragging up
                              if (index < draggedIndex && index >= dragOverIndex) {
                                return WORKSPACE_TRANSFORMS.MOVE_DOWN;
                              }
                            }
                            return 'translateY(0)';
                          })(),
                          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                      <div className="drag-handle">
                        <GripVertical size={16} />
                      </div>
                      <div className="workspace-checkbox-container">
                        <input
                          type="checkbox"
                          id={`workspace-checkbox-${wsName}`}
                          className="tree-item-checkbox"
                          checked={selectedWorkspaces.has(wsName)}
                          onChange={() => handleToggleWorkspace(wsName)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <label 
                          htmlFor={`workspace-checkbox-${wsName}`} 
                          className="custom-checkbox"
                          aria-label={`Select ${wsName}`}
                        />
                      </div>
                      {renamingWsName === wsName ? (
                        // Renaming UI
                        <>
                          <div className="prompt-details flex-grow"> 
                            <input
                              type="text"
                              className="prompt-title-input flex-grow" // Use similar styling
                              value={newName}
                              onChange={(e) => setNewName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
                              ref={renameInputRef}
                            />
                          </div>
                          <div className="workspace-actions">
                            <button 
                              className="prompt-action-button confirm-button" // Style as needed
                              onClick={handleRenameConfirm}
                              title="Confirm rename"
                              disabled={!newName.trim() || (newName.trim() === wsName)}
                            >
                              <Check size={16} />
                            </button>
                            <button 
                              className="prompt-action-button cancel-button" // Style as needed
                              onClick={handleRenameCancel}
                              title="Cancel rename"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </>
                      ) : (
                        // Default display UI
                        <>
                          <div className="prompt-details">
                            <div className="prompt-title">{wsName}</div>
                          </div>
                          <div className="workspace-actions">
                            <button 
                              className="prompt-action-button"
                              onClick={() => handleLoad(wsName)}
                              title="Load workspace"
                            >
                              Load
                            </button>
                             <button 
                              className="prompt-action-button rename-button" // Style as needed
                              onClick={() => handleRenameStart(wsName)}
                              title="Rename workspace"
                            >
                              <Pencil size={16} /> 
                            </button>
                            <button 
                              className="prompt-action-button delete-button"
                              onClick={() => handleDelete(wsName)}
                              title="Delete workspace"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          </div>
          
          <div className="modal-footer">
            <Dialog.Close asChild>
              <button className="cancel-button">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default WorkspaceModal;
