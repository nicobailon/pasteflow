import * as Dialog from "@radix-ui/react-dialog";
import { Check, CirclePlus, Plus, Trash, X } from "lucide-react";
import { useState, useEffect } from "react";

import { useRolePromptsState } from "../hooks/use-role-prompts-state";
import { useUIStore, usePromptStore } from "../stores";
import type { RolePrompt } from "../types/file-types";

const RolePromptsModal = (): JSX.Element => {
  const isOpen = useUIStore((s) => s.rolePromptsModalOpen);
  const initialEditPrompt = useUIStore((s) => s.rolePromptToEdit);
  const closeModal = useUIStore((s) => s.closeRolePromptsModal);

  const { rolePrompts, createRolePrompt, updateRolePrompt: updatePrompt, deleteRolePrompt: deletePrompt } = useRolePromptsState();
  const selectedRolePrompts = usePromptStore((s) => s.selectedRolePrompts);
  const toggleRolePromptSelection = usePromptStore((s) => s.toggleRolePromptSelection);

  const [editingPrompt, setEditingPrompt] = useState<RolePrompt | null>(null);
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptContent, setNewPromptContent] = useState("");

  useEffect(() => {
    if (isOpen) {
      if (initialEditPrompt) {
        setEditingPrompt({ ...initialEditPrompt });
      }
    } else {
      setEditingPrompt(null);
      setNewPromptName("");
      setNewPromptContent("");
    }
  }, [isOpen, initialEditPrompt]);

  const handleAddPrompt = async () => {
    if (!newPromptName || !newPromptContent) return;

    const newPrompt: RolePrompt = {
      id: Date.now().toString(),
      name: newPromptName,
      content: newPromptContent,
    };

    try {
      await createRolePrompt(newPrompt);
      setNewPromptName("");
      setNewPromptContent("");
      setEditingPrompt(null);
    } catch {
      // error handled in hook
    }
  };

  const handleUpdatePrompt = async () => {
    if (!editingPrompt || !editingPrompt.name || !editingPrompt.content) return;
    try {
      await updatePrompt(editingPrompt);
      setEditingPrompt(null);
    } catch {
      // error handled in hook
    }
  };

  const handleDeletePrompt = async (id: string) => {
    try {
      await deletePrompt(id);
    } catch {
      // error handled in hook
    }
  };

  const startEdit = (prompt: RolePrompt) => {
    setEditingPrompt({ ...prompt });
  };

  const cancelEdit = () => {
    setEditingPrompt(null);
  };

  const isPromptSelected = (prompt: RolePrompt) => {
    return selectedRolePrompts.some((p) => p.id === prompt.id);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content role-prompts-modal notes-app-layout" aria-describedby={undefined}>
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
              {(!Array.isArray(rolePrompts) || rolePrompts.length === 0) ? (
                <div className="no-prompts-message">
                  No role prompts yet. Add one to get started.
                </div>
              ) : (
                rolePrompts.map((prompt) => (
                  <div
                    key={prompt.id}
                    className={`role-prompt-item ${isPromptSelected(prompt) ? "selected" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(prompt);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
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
                        {(prompt.content ?? "").length > 60
                          ? (prompt.content ?? "").slice(0, 60) + "..."
                          : (prompt.content ?? "")}
                      </div>
                    </div>
                    <div className="prompt-actions">
                      <button
                        className={`prompt-action-button toggle-selection-button ${isPromptSelected(prompt) ? "selected" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRolePromptSelection(prompt);
                        }}
                        title={isPromptSelected(prompt) ? "Remove from selection" : "Add to selection"}
                      >
                        {isPromptSelected(prompt) ? <Check size={14} /> : <CirclePlus size={14} />}
                      </button>
                      <button
                        className="prompt-action-button delete-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeletePrompt(prompt.id);
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
                    value={editingPrompt.name}
                    onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
                    placeholder="Enter prompt name"
                  />
                  <textarea
                    className="prompt-content-input"
                    value={editingPrompt.content}
                    onChange={(e) => setEditingPrompt({ ...editingPrompt, content: e.target.value })}
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
                    <h3>Add New Role Prompt</h3>
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

export default RolePromptsModal;
