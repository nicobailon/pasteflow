import React, { useState } from 'react';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WorkspaceModal = ({ isOpen, onClose }: WorkspaceModalProps) => {
  const { saveWorkspace, loadWorkspace, deleteWorkspace, getWorkspaceNames } = useWorkspaceState();
  const [name, setName] = useState('');
  const workspaceNames = getWorkspaceNames();

  const handleSave = () => {
    if (!name.trim()) return;
    
    if (workspaceNames.includes(name)) {
      if (window.confirm(`Workspace "${name}" exists. Overwrite?`)) {
        saveWorkspace(name);
        setName('');
      }
    } else {
      saveWorkspace(name);
      setName('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Manage Workspaces</h2>
        <div className="workspace-form">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter workspace name"
            className="workspace-input"
          />
          <button 
            onClick={handleSave} 
            disabled={!name.trim()}
            className="workspace-save-btn"
          >
            Save Workspace
          </button>
        </div>
        
        <h3>Saved Workspaces</h3>
        {workspaceNames.length > 0 ? (
          <ul className="workspace-list">
            {workspaceNames.map((wsName) => (
              <li key={wsName} className="workspace-item">
                <span className="workspace-name">{wsName}</span>
                <div className="workspace-actions">
                  <button 
                    onClick={() => loadWorkspace(wsName)}
                    className="workspace-action-btn load-btn"
                  >
                    Load
                  </button>
                  <button 
                    onClick={() => {
                      if (window.confirm(`Delete workspace "${wsName}"?`)) {
                        deleteWorkspace(wsName);
                      }
                    }}
                    className="workspace-action-btn delete-btn"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="no-workspaces">No saved workspaces</p>
        )}
        
        <button onClick={onClose} className="modal-close-btn">Close</button>
      </div>
    </div>
  );
};

export default WorkspaceModal;
