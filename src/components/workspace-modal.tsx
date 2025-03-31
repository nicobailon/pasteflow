import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, Pencil, X } from "lucide-react"; // Added Loader2
import { useCallback, useEffect, useRef, useState } from 'react'; // Added useRef

import useAppState from '../hooks/use-app-state';
import { useWorkspaceState } from '../hooks/use-workspace-state';
import { WorkspaceState } from '../types/file-types';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialRenameTarget?: string | null; // Optional prop to trigger rename on open
  onClearInitialRenameTarget?: () => void; // Optional prop to clear the target in parent
}

const WorkspaceModal = ({ 
  isOpen, 
  onClose, 
  initialRenameTarget, 
  onClearInitialRenameTarget 
}: WorkspaceModalProps): JSX.Element => {
  const { 
    saveWorkspace: persistWorkspace, 
    loadWorkspace: loadPersistedWorkspace, 
    deleteWorkspace: deletePersistedWorkspace, 
    renameWorkspace: renamePersistedWorkspace, // Added rename function
    getWorkspaceNames 
  } = useWorkspaceState();
  const appState = useAppState();
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [workspaceNames, setWorkspaceNames] = useState<string[]>([]);
  const [renamingWsName, setRenamingWsName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refreshWorkspaceList = useCallback(() => {
    const names = getWorkspaceNames();
    console.log("[WorkspaceModal] Refreshing internal workspace list:", names);
    setWorkspaceNames(names);
  }, [getWorkspaceNames]);
  
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
  
  useEffect(() => {
    if (isOpen) {
      console.log("[WorkspaceModal] Modal opened. Refreshing workspace list and resetting state.");
      refreshWorkspaceList();
      setName(''); // Reset save input
      setRenamingWsName(null); // Reset renaming state
      setNewName(''); // Reset rename input

      // Check if we need to start in rename mode
      if (initialRenameTarget && onClearInitialRenameTarget) {
        console.log(`[WorkspaceModal] Modal opened with initial rename target: ${initialRenameTarget}`);
        // Need a slight delay or ensure the list is rendered before starting rename
        // Using setTimeout to ensure the component has rendered and state updates are processed
        setTimeout(() => {
            handleRenameStart(initialRenameTarget);
            onClearInitialRenameTarget(); // Clear the target in the parent state
        }, 0); 
      }
    }
  }, [isOpen, refreshWorkspaceList, initialRenameTarget, onClearInitialRenameTarget]); // Added dependencies

  useEffect(() => {
    // Focus the rename input when renaming starts
    if (renamingWsName && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingWsName]);

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
      selectedFolder: appState.selectedFolder, // Added missing property
      fileTreeState: appState.expandedNodes,
      selectedFiles: appState.selectedFiles,
      userInstructions: appState.userInstructions,
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
        fileTreeStateKeys: Object.keys(workspaceToSave.fileTreeState || {}).length,
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
        <Dialog.Content className="modal-content notes-app-layout">
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
                {/* {saveState === 'success' && ( */}
                {/*  <Check size={16} className="button-icon success-check" /> */}
                {/* )} */} {/* Temporarily commented out for testing */}
              </button>
              
              <h3 className="workspace-subtitle">Saved Workspaces</h3>
              
              {workspaceNames.length === 0 ? (
                <div className="no-prompts-message">
                  No workspaces saved yet.
                </div>
              ) : (
                <div className="workspace-list">
                  {workspaceNames.map((wsName: string) => (
                    <div key={wsName} className="workspace-item">
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
                              disabled={!newName.trim() || newName.trim() === wsName}
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
                  ))}
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
