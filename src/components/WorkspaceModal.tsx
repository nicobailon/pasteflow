import React, { useState, useEffect } from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WorkspaceModal = ({ isOpen, onClose }: WorkspaceModalProps): JSX.Element => {
  const { saveWorkspace, loadWorkspace, deleteWorkspace, getWorkspaceNames } = useWorkspaceState();
  const [name, setName] = useState('');
  const [workspaceNames, setWorkspaceNames] = useState([]);
  
  useEffect(() => {
    if (isOpen) {
      // Refresh workspace list when modal opens
      setWorkspaceNames(getWorkspaceNames());
    }
  }, [isOpen, getWorkspaceNames]);

  const handleSave = () => {
    if (workspaceNames.includes(name)) {
      if (window.confirm(`Workspace "${name}" exists. Overwrite?`)) {
        saveWorkspace(name);
        setName('');
        // Refresh workspace list after saving
        setWorkspaceNames(getWorkspaceNames());
        // Close the modal after saving
        onClose();
      }
    } else {
      saveWorkspace(name);
      setName('');
      // Refresh workspace list after saving
      setWorkspaceNames(getWorkspaceNames());
      // Close the modal after saving
      onClose();
    }
  };
  
  const handleDelete = (wsName: string) => {
    if (window.confirm(`Are you sure you want to delete workspace "${wsName}"?`)) {
      deleteWorkspace(wsName);
      // Refresh workspace list after deleting
      setWorkspaceNames(getWorkspaceNames());
    }
  };

  const handleLoad = (wsName: string) => {
    loadWorkspace(wsName);
    // Close the modal after loading
    onClose();
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
              />
              <button 
                className="apply-button"
                onClick={handleSave} 
                disabled={!name}
              >
                Save Workspace
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
                          className="prompt-action-button delete-button"
                          onClick={() => handleDelete(wsName)}
                          title="Delete workspace"
                        >
                          Delete
                        </button>
                      </div>
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