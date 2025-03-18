import React, { useState } from "react";
import Modal from "react-modal";
import { SystemPrompt, SystemPromptsModalProps } from "../types/FileTypes";
import { Plus, Trash, Pencil, CirclePlus, Clipboard, Check, X } from "lucide-react";

// Set app element for accessibility
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
  Modal.setAppElement('#root');
}

/**
 * SystemPromptsModal component - Provides a modal dialog for managing system prompts
 * with the ability to add, edit, delete, and select prompts
 */
const SystemPromptsModal = ({
  isOpen,
  onClose,
  systemPrompts,
  onAddPrompt,
  onDeletePrompt,
  onUpdatePrompt,
  onSelectPrompt,
  selectedSystemPrompts = [],
  toggleSystemPromptSelection,
}: SystemPromptsModalProps): JSX.Element => {
  const [editingPrompt, setEditingPrompt] = useState(null as SystemPrompt | null);
  const [newPromptTitle, setNewPromptTitle] = useState("");
  const [newPromptContent, setNewPromptContent] = useState("");

  const handleAddPrompt = () => {
    if (!newPromptTitle || !newPromptContent) return;
    
    const newPrompt: SystemPrompt = {
      id: Date.now().toString(),
      title: newPromptTitle,
      content: newPromptContent
    };
    
    onAddPrompt(newPrompt);
    setNewPromptTitle("");
    setNewPromptContent("");
    setEditingPrompt(null);
  };

  const handleUpdatePrompt = () => {
    if (!editingPrompt || !editingPrompt.title || !editingPrompt.content) return;
    
    onUpdatePrompt(editingPrompt);
    setEditingPrompt(null);
  };

  const startEdit = (prompt: SystemPrompt) => {
    setEditingPrompt({ ...prompt });
  };

  const cancelEdit = () => {
    setEditingPrompt(null);
  };

  // Check if a prompt is currently selected
  const isPromptSelected = (prompt: SystemPrompt) => {
    return selectedSystemPrompts.some(p => p.id === prompt.id);
  };

  const customStyles = {
    overlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    },
    content: {
      position: 'relative',
      top: 'auto',
      left: 'auto',
      right: 'auto',
      bottom: 'auto',
      width: '90%',
      maxWidth: '1000px',
      height: '90vh',
      borderRadius: '8px',
      padding: '0',
      border: '1px solid #ccc',
      background: '#f5f5f5',
      overflow: 'hidden'
    }
  };

  return (
    // @ts-ignore - Modal component has incompatible typing
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={customStyles}
      contentLabel="System Prompts Manager"
    >
      <div className="modal-content system-prompts-modal notes-app-layout">
        <div className="modal-header">
          <h2>System Prompts</h2>
          <button className="close-button" onClick={onClose}><X size={16} /></button>
        </div>
        
        <div className="modal-body">
          <div className="sidebar system-prompts-list">
            {systemPrompts.length === 0 ? (
              <div className="no-prompts-message">
                No system prompts yet. Add one to get started.
              </div>
            ) : (
              systemPrompts.map((prompt) => (
                <div 
                  key={prompt.id} 
                  className={`system-prompt-item ${isPromptSelected(prompt) ? 'selected' : ''}`}
                  onClick={() => toggleSystemPromptSelection(prompt)}
                >
                  <div className="prompt-details">
                    <div className="prompt-title">{prompt.title}</div>
                    <div className="prompt-preview">
                      {prompt.content.length > 60 
                        ? prompt.content.substring(0, 60) + "..." 
                        : prompt.content}
                    </div>
                  </div>
                  <div className="prompt-actions">
                    <button 
                      className={`prompt-action-button toggle-selection-button ${isPromptSelected(prompt) ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSystemPromptSelection(prompt);
                      }}
                      title={isPromptSelected(prompt) ? "Remove from selection" : "Add to selection"}
                    >
                      {isPromptSelected(prompt) ? (
                        <Check size={14} />
                      ) : (
                        <CirclePlus size={14} />
                      )}
                    </button>
                    <button 
                      className="prompt-action-button delete-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePrompt(prompt.id);
                      }}
                      title="Delete this prompt"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="content-area system-prompt-editor">
            {editingPrompt ? (
              <div className="edit-prompt-form">
                <h3>Edit System Prompt</h3>
                <input
                  type="text"
                  className="prompt-title-input"
                  value={editingPrompt.title}
                  onChange={(e) => setEditingPrompt({
                    ...editingPrompt,
                    title: e.target.value
                  })}
                  placeholder="Enter prompt title"
                />
                <textarea
                  className="prompt-content-input"
                  value={editingPrompt.content}
                  onChange={(e) => setEditingPrompt({
                    ...editingPrompt,
                    content: e.target.value
                  })}
                  placeholder="Enter prompt content"
                  rows={12}
                />
                <div className="prompt-edit-actions">
                  <button className="cancel-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                  <button 
                    className="apply-button"
                    onClick={handleUpdatePrompt}
                    disabled={!editingPrompt.title || !editingPrompt.content}
                  >
                    Update Prompt
                  </button>
                </div>
              </div>
            ) : (
              <div className="add-prompt-form">
                <div className="prompt-add-action">
                  <h3>Add New System Prompt</h3>
                  <button 
                    className="apply-button add-prompt-button"
                    onClick={handleAddPrompt}
                    disabled={!newPromptTitle || !newPromptContent}
                  >
                    <Plus size={14} />
                    <span>Add Prompt</span>
                  </button>
                </div>
                <input
                  type="text"
                  className="prompt-title-input"
                  value={newPromptTitle}
                  onChange={(e) => setNewPromptTitle(e.target.value)}
                  placeholder="Enter prompt title"
                />
                <textarea
                  className="prompt-content-input"
                  value={newPromptContent}
                  onChange={(e) => setNewPromptContent(e.target.value)}
                  placeholder="Enter prompt content"
                  rows={12}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default SystemPromptsModal; 