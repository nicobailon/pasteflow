import * as Dialog from "@radix-ui/react-dialog";
import { Check, CirclePlus, Plus, Trash, X } from "lucide-react"; // Removed unused Pencil, Clipboard
import { useState, useEffect } from "react";

import { SystemPrompt, SystemPromptsModalProps } from "../types/file-types";

/**
 * SystemPromptsModal component - Provides a modal dialog for managing system prompts
 * with the ability to add, edit, delete, and select prompts
 */
const SystemPromptsModal = ({
  isOpen,
  onClose,
  systemPrompts = [],
  onAddPrompt,
  onDeletePrompt,
  onUpdatePrompt,
  // onSelectPrompt, // This prop seems unused in the component
  selectedSystemPrompts = [],
  toggleSystemPromptSelection = () => {},
  initialEditPrompt,
}: SystemPromptsModalProps): JSX.Element => {
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptContent, setNewPromptContent] = useState("");

  // Set initial edit prompt when modal opens
  useEffect(() => {
    if (isOpen && initialEditPrompt) {
      setEditingPrompt({ ...initialEditPrompt });
    }
  }, [isOpen, initialEditPrompt]);

  const handleAddPrompt = () => {
    if (!newPromptName || !newPromptContent) return;
    
    const newPrompt: SystemPrompt = {
      id: Date.now().toString(),
      name: newPromptName,
      content: newPromptContent
    };
    
    onAddPrompt(newPrompt);
    setNewPromptName("");
    setNewPromptContent("");
    setEditingPrompt(null);
  };

  const handleUpdatePrompt = () => {
    if (!editingPrompt || !editingPrompt.name || !editingPrompt.content) return;
    
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

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content system-prompts-modal notes-app-layout" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>System Prompts</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button"><X size={16} /></button>
            </Dialog.Close>
          </div>
          
          <div className="modal-body">
            <div className="sidebar system-prompts-list">
              {(!Array.isArray(systemPrompts) || systemPrompts.length === 0) ? (
                <div className="no-prompts-message">
                  No system prompts yet. Add one to get started.
                </div>
              ) : (
                (systemPrompts || []).map((prompt) => (
                  <div
                    key={prompt.id}
                    className={`system-prompt-item ${isPromptSelected(prompt) ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(prompt);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        startEdit(prompt);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="prompt-details">
                      <div className="prompt-title">{prompt.name}</div>
                      <div className="prompt-preview">
                        {(prompt.content ?? '').length > 60
                          ? (prompt.content ?? '').slice(0, 60) + "..."
                          : (prompt.content ?? '')}
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
                    value={editingPrompt.name}
                    onChange={(e) => setEditingPrompt({
                      ...editingPrompt,
                      name: e.target.value
                    })}
                    placeholder="Enter prompt name"
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
                      disabled={!editingPrompt.name || !editingPrompt.content}
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
                      disabled={!newPromptName || !newPromptContent}
                    >
                      <Plus size={14} />
                      <span>Add Prompt</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    className="prompt-title-input"
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                    placeholder="Enter prompt name"
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

export default SystemPromptsModal; 