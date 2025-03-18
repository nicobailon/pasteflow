import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RolePrompt, RolePromptsModalProps } from "../types/FileTypes";
import { Plus, Trash, Pencil, CirclePlus, Clipboard, Check, X, User } from "lucide-react";

/**
 * RolePromptsModal component - Provides a modal dialog for managing role prompts
 * with the ability to add, edit, delete, and select prompts
 */
const RolePromptsModal = ({
  isOpen,
  onClose,
  rolePrompts,
  onAddPrompt,
  onDeletePrompt,
  onUpdatePrompt,
  onSelectPrompt,
  selectedRolePrompts = [],
  toggleRolePromptSelection,
}: RolePromptsModalProps): JSX.Element => {
  const [editingPrompt, setEditingPrompt] = useState(null as RolePrompt | null);
  const [newPromptTitle, setNewPromptTitle] = useState("");
  const [newPromptContent, setNewPromptContent] = useState("");

  const handleAddPrompt = () => {
    if (!newPromptTitle || !newPromptContent) return;
    
    const newPrompt: RolePrompt = {
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

  const startEdit = (prompt: RolePrompt) => {
    setEditingPrompt({ ...prompt });
  };

  const cancelEdit = () => {
    setEditingPrompt(null);
  };

  // Check if a prompt is currently selected
  const isPromptSelected = (prompt: RolePrompt) => {
    return selectedRolePrompts.some(p => p.id === prompt.id);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content role-prompts-modal notes-app-layout">
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Role Prompts</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button"><X size={16} /></button>
            </Dialog.Close>
          </div>
          
          <div className="modal-body">
            <div className="sidebar role-prompts-list">
              {rolePrompts.length === 0 ? (
                <div className="no-prompts-message">
                  No role prompts yet. Add one to get started.
                </div>
              ) : (
                rolePrompts.map((prompt) => (
                  <div 
                    key={prompt.id} 
                    className={`role-prompt-item ${isPromptSelected(prompt) ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(prompt);
                    }}
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
                          toggleRolePromptSelection(prompt);
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
            
            <div className="content-area role-prompt-editor">
              {editingPrompt ? (
                <div className="edit-prompt-form">
                  <h3>Edit Role Prompt</h3>
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
                    <h3>Add New Role Prompt</h3>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default RolePromptsModal;