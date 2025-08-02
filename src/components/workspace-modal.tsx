import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from 'react';

import { useWorkspaceState } from '../hooks/use-workspace-state';
import { useWorkspaceDrag } from '../hooks/use-workspace-drag';
import { useWorkspaceSelection } from '../hooks/use-workspace-selection';
import { WorkspaceState } from '../types/file-types';
import type { AppState } from '../hooks/use-app-state';
import { 
  getWorkspaceSortMode, 
  setWorkspaceSortMode, 
  getWorkspaceManualOrder, 
  setWorkspaceManualOrder, 
  WorkspaceSortMode
} from '../utils/workspace-sorting';

import { WorkspaceListItem } from './workspace-list-item';
import { WorkspaceSaveButton } from './workspace-save-button';
import { WorkspaceHeader } from './workspace-header';
import { WorkspaceBulkActions } from './workspace-bulk-actions';

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
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [sortMode, setSortMode] = useState<WorkspaceSortMode>('recent');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [sortedWorkspaces, setSortedWorkspaces] = useState<string[]>([]);
  
  // Load sort preferences from database on mount
  useEffect(() => {
    const loadSortPreferences = async () => {
      const [mode, order] = await Promise.all([
        getWorkspaceSortMode(),
        getWorkspaceManualOrder()
      ]);
      setSortMode(mode);
      setManualOrder(order);
    };
    loadSortPreferences();
  }, []);

  const refreshWorkspaceList = useCallback(async () => {
    try {
      const names = await getWorkspaceNames();
      setWorkspaceNames(names);
    } catch (error) {
      console.error('[WorkspaceModal] Error refreshing workspace list:', error);
    }
  }, [getWorkspaceNames]);

  const getSortedWorkspaces = useCallback(async (): Promise<string[]> => {
    try {
      // Get workspace names from database (already sorted by last accessed)
      const names = await getWorkspaceNames();
      
      // If manual sorting is enabled, use manualOrder
      if (sortMode === 'manual' && manualOrder.length > 0) {
        // Sort according to manual order, with any new workspaces at the end
        const orderedNames = [...manualOrder];
        for (const name of names) {
          if (!orderedNames.includes(name)) {
            orderedNames.push(name);
          }
        }
        // Filter to only include workspaces that still exist
        return orderedNames.filter(name => names.includes(name));
      }
      
      // For other sort modes, names are already sorted by last accessed from database
      return names;
    } catch (error) {
      console.error('[WorkspaceModal] Error getting sorted workspaces:', error);
      return [];
    }
  }, [getWorkspaceNames, sortMode, manualOrder]);

  const handleSortModeChange = useCallback(async (newMode: WorkspaceSortMode) => {
    if (newMode === 'manual') {
      // When switching to manual, preserve the current order
      try {
        const currentOrder = await getSortedWorkspaces();
        setManualOrder(currentOrder);
        setWorkspaceManualOrder(currentOrder).catch(error => 
          console.error('Error saving workspace manual order:', error)
        );
      } catch (error) {
        console.error('[WorkspaceModal] Error getting sorted workspaces:', error);
      }
    }
    setSortMode(newMode);
    setWorkspaceSortMode(newMode).catch(error => 
      console.error('Error saving workspace sort mode:', error)
    );
  }, [getSortedWorkspaces]);

  // Use selection hook
  const { 
    selectedWorkspaces, 
    selectAllChecked, 
    handleToggleWorkspace, 
    handleSelectAll, 
    handleBulkDelete,
    clearSelection 
  } = useWorkspaceSelection({
    workspaceNames,
    onDelete: async (name: string) => {
      await deletePersistedWorkspace(name);
    },
    onRefresh: refreshWorkspaceList
  });
  
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
  
  // Use drag hook
  const {
    draggedIndex,
    dragOverIndex,
    workspaceListRef,
    handleDragStart,
    handleDragOver,
    handleDragOverItem,
    handleDragEnter,
    handleDrop,
    handleDragEnd,
    handleDragLeave,
    getItemTransform
  } = useWorkspaceDrag({
    sortMode,
    getSortedWorkspaces: () => sortedWorkspaces,
    onReorder: (newOrder) => {
      setManualOrder(newOrder);
      setSortMode('manual');
      setWorkspaceSortMode('manual').catch(error => 
        console.error('Error saving workspace sort mode:', error)
      );
    }
  });

  useEffect(() => {
    if (isOpen) {
      console.log("[WorkspaceModal] Modal opened. Refreshing workspace list and resetting state.");
      refreshWorkspaceList().catch(error => 
        console.error('[WorkspaceModal] Error refreshing workspace list:', error)
      );
      setName(''); // Reset save input
      setRenamingWsName(null); // Reset renaming state
      setNewName(''); // Reset rename input
      clearSelection(); // Reset selection
      
      // Load sorted workspaces
      getSortedWorkspaces().then(sorted => {
        setSortedWorkspaces(sorted);
      }).catch(error => {
        console.error('[WorkspaceModal] Error loading sorted workspaces:', error);
      });

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
  }, [isOpen, initialRenameTarget, onClearInitialRenameTarget]); // Added dependencies

  // Update sorted workspaces when relevant state changes
  useEffect(() => {
    if (isOpen) {
      getSortedWorkspaces().then(sorted => {
        setSortedWorkspaces(sorted);
      }).catch(error => {
        console.error('[WorkspaceModal] Error updating sorted workspaces:', error);
      });
    }
  }, [workspaceNames, sortMode, manualOrder, isOpen, getSortedWorkspaces]);

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
        const allFilesMap = new Map(appState.allFiles.map(f => [f.path, f]));
        for (const selectedFile of appState.selectedFiles) {
          const fileData = allFilesMap.get(selectedFile.path);
          acc[selectedFile.path] = fileData?.tokenCount || 0;
        }
        return acc;
      })(),
      customPrompts: {
        systemPrompts: appState.selectedSystemPrompts,
        rolePrompts: appState.selectedRolePrompts
      },
      instructions: appState.instructions,
      selectedInstructions: appState.selectedInstructions
    };

    console.log('[WorkspaceModal.handleSave] Constructed workspace state object from appState:', {
        name: trimmedName,
        expandedNodesKeys: Object.keys(workspaceToSave.expandedNodes || {}).length,
        selectedFilesCount: workspaceToSave.selectedFiles.length,
        userInstructionsLength: workspaceToSave.userInstructions?.length || 0,
        systemPromptsCount: workspaceToSave.customPrompts?.systemPrompts?.length || 0,
        rolePromptsCount: workspaceToSave.customPrompts?.rolePrompts?.length || 0,
        instructionsCount: workspaceToSave.instructions?.length || 0,
        selectedInstructionsCount: workspaceToSave.selectedInstructions?.length || 0,
    });

    try {
      persistWorkspace(trimmedName, workspaceToSave);
      console.log(`[WorkspaceModal.handleSave] persistWorkspace successful for "${trimmedName}".`);
      setSaveState('success'); // Set state to success
      refreshWorkspaceList().catch(error => 
        console.error('[WorkspaceModal] Error refreshing workspace list:', error)
      ); // Refresh list *after* successful save

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
  
  const handleDelete = async (wsName: string) => {
    console.log(`[WorkspaceModal.handleDelete] Attempting to delete workspace: ${wsName}`);
    if (window.confirm(`Are you sure you want to delete workspace "${wsName}"? This cannot be undone.`)) {
      console.log(`[WorkspaceModal.handleDelete] User confirmed deletion for "${wsName}".`);
      try {
        await deletePersistedWorkspace(wsName);
        refreshWorkspaceList().catch(error => 
          console.error('[WorkspaceModal] Error refreshing workspace list:', error)
        );
        console.log(`[WorkspaceModal.handleDelete] Deletion process complete for "${wsName}".`);
      } catch (error) {
        console.error(`[WorkspaceModal.handleDelete] Error deleting workspace "${wsName}":`, error);
        alert(`Failed to delete workspace "${wsName}". Please try again.`);
      }
    } else {
       console.log(`[WorkspaceModal.handleDelete] Deletion cancelled by user for "${wsName}".`);
    }
  };

  const handleLoad = async (wsName: string) => {
    console.log(`[WorkspaceModal.handleLoad] Attempting to load workspace: ${wsName}`);
    try {
      const workspaceData = await loadPersistedWorkspace(wsName);
      if (workspaceData) {
        console.log(`[WorkspaceModal.handleLoad] Workspace "${wsName}" loaded successfully via hook. Dispatching 'workspaceLoaded' event.`);
        window.dispatchEvent(new CustomEvent('workspaceLoaded', { detail: { name: wsName, workspace: workspaceData } }));
        onClose();
        console.log(`[WorkspaceModal.handleLoad] Load process complete for "${wsName}". Modal closed.`);
      } else {
        console.error(`[WorkspaceModal.handleLoad] loadPersistedWorkspace returned null for "${wsName}". Load failed.`);
        // No alert - workspace has been auto-deleted if corrupted
        refreshWorkspaceList().catch(error => 
        console.error('[WorkspaceModal] Error refreshing workspace list:', error)
      ); // Refresh the list to remove the corrupted workspace
      }
    } catch (error) {
      console.error(`[WorkspaceModal.handleLoad] Error during loadPersistedWorkspace call for "${wsName}":`, error);
      // No alert - just log the error
      refreshWorkspaceList().catch(error => 
        console.error('[WorkspaceModal] Error refreshing workspace list:', error)
      ); // Refresh the list to remove the corrupted workspace
    }
  };
 
  const handleRenameConfirm = async () => {
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

    try {
      const success = await renamePersistedWorkspace(renamingWsName, trimmedNewName);
      if (success) {
        console.log(`[WorkspaceModal.handleRenameConfirm] Rename successful via hook for "${renamingWsName}" -> "${trimmedNewName}".`);
        refreshWorkspaceList().catch(error => 
          console.error('[WorkspaceModal] Error refreshing workspace list:', error)
        );
        handleRenameCancel(); // Exit rename mode
      } else {
        // Error likely logged in the hook, maybe show an alert here too
        console.error(`[WorkspaceModal.handleRenameConfirm] Rename failed for "${renamingWsName}" -> "${trimmedNewName}". Hook returned false.`);
        alert(`Failed to rename workspace "${renamingWsName}". Check console for details.`);
        // Optionally keep rename mode active or cancel
        // handleRenameCancel(); 
      }
    } catch (error) {
      console.error(`[WorkspaceModal.handleRenameConfirm] Error renaming workspace:`, error);
      alert('Failed to rename workspace. Please try again.');
    }
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
              <WorkspaceSaveButton
                saveState={saveState}
                workspaceName={name}
                isRenamingActive={!!renamingWsName}
                workspaceNames={workspaceNames}
                disabled={!name.trim() || !!renamingWsName || saveState === 'saving' || saveState === 'success'}
                onSave={handleSave}
              />
              
              <WorkspaceHeader
                workspaceCount={workspaceNames.length}
                sortMode={sortMode}
                selectAllChecked={selectAllChecked}
                onSortModeChange={handleSortModeChange}
                onSelectAll={handleSelectAll}
              />
              
              {selectedWorkspaces.size > 0 && (
                <WorkspaceBulkActions
                  selectedCount={selectedWorkspaces.size}
                  onDelete={handleBulkDelete}
                  onClearSelection={clearSelection}
                />
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
                  {sortedWorkspaces.map((wsName: string, index: number) => {
                    const isDragging = draggedIndex === index;
                    const isDragOver = dragOverIndex === index;
                    const shouldShowGap = isDragOver && draggedIndex !== null && draggedIndex !== index;
                    
                    return (
                      <WorkspaceListItem
                        key={wsName}
                        name={wsName}
                        index={index}
                        isSelected={selectedWorkspaces.has(wsName)}
                        isRenaming={renamingWsName === wsName}
                        isDragging={isDragging}
                        isDragOver={isDragOver}
                        shouldShowGap={shouldShowGap}
                        newName={newName}
                        onToggleSelect={() => handleToggleWorkspace(wsName)}
                        onRenameStart={() => handleRenameStart(wsName)}
                        onRenameConfirm={handleRenameConfirm}
                        onRenameCancel={handleRenameCancel}
                        onRenameChange={setNewName}
                        onLoad={() => handleLoad(wsName)}
                        onDelete={() => handleDelete(wsName)}
                        dragHandlers={{
                          onDragStart: (e) => handleDragStart(e, index),
                          onDragEnter: (e) => handleDragEnter(e, index),
                          onDragOver: (e) => handleDragOverItem(e, index),
                          onDrop: (e) => handleDrop(e, index),
                          onDragEnd: handleDragEnd
                        }}
                        transform={getItemTransform(index)}
                      />
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
