import * as Dialog from "@radix-ui/react-dialog";
import { Check, CirclePlus, Plus, Trash, X } from "lucide-react";
import { useState } from "react";

import { Instruction, InstructionsModalProps } from "../types/file-types";

/**
 * InstructionsModal component - Provides a modal dialog for managing instructions
 * with the ability to add, edit, delete, and select instructions
 */
const InstructionsModal = ({
  isOpen,
  onClose,
  instructions,
  onAddInstruction,
  onDeleteInstruction,
  onUpdateInstruction,
  selectedInstructions = [],
  toggleInstructionSelection,
}: InstructionsModalProps): JSX.Element => {
  const [editingInstruction, setEditingInstruction] = useState(null as Instruction | null);
  const [newInstructionName, setNewInstructionName] = useState("");
  const [newInstructionContent, setNewInstructionContent] = useState("");

  const handleAddInstruction = () => {
    if (!newInstructionName || !newInstructionContent) return;
    
    const newInstruction: Instruction = {
      id: Date.now().toString(),
      name: newInstructionName,
      content: newInstructionContent
    };
    
    onAddInstruction(newInstruction);
    setNewInstructionName("");
    setNewInstructionContent("");
    setEditingInstruction(null);
  };

  const handleUpdateInstruction = () => {
    if (!editingInstruction || !editingInstruction.name || !editingInstruction.content) return;
    
    onUpdateInstruction(editingInstruction);
    setEditingInstruction(null);
  };

  const startEdit = (instruction: Instruction) => {
    setEditingInstruction({ ...instruction });
  };

  const cancelEdit = () => {
    setEditingInstruction(null);
  };

  // Check if an instruction is currently selected
  const isInstructionSelected = (instruction: Instruction) => {
    return selectedInstructions.some(d => d.id === instruction.id);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content instructions-modal notes-app-layout">
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Instructions</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button"><X size={16} /></button>
            </Dialog.Close>
          </div>
          
          <div className="modal-body">
            <div className="sidebar instructions-list">
              {instructions.length === 0 ? (
                <div className="no-prompts-message">
                  No instructions yet. Add one to get started.
                </div>
              ) : (
                instructions.map((instruction) => (
                  <div 
                    key={instruction.id} 
                    className={`instruction-item ${isInstructionSelected(instruction) ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(instruction);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        startEdit(instruction);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="prompt-details">
                      <div className="prompt-title">{instruction.name}</div>
                      <div className="prompt-preview">
                        {instruction.content.length > 60 
                          ? instruction.content.slice(0, 60) + "..." 
                          : instruction.content}
                      </div>
                    </div>
                    <div className="prompt-actions">
                      <button 
                        className={`prompt-action-button toggle-selection-button ${isInstructionSelected(instruction) ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleInstructionSelection(instruction);
                        }}
                        title={isInstructionSelected(instruction) ? "Remove from selection" : "Add to selection"}
                      >
                        {isInstructionSelected(instruction) ? (
                          <Check size={14} />
                        ) : (
                          <CirclePlus size={14} />
                        )}
                      </button>
                      <button 
                        className="prompt-action-button delete-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteInstruction(instruction.id);
                        }}
                        title="Delete this instruction"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="content-area instruction-editor">
              {editingInstruction ? (
                <div className="edit-prompt-form">
                  <h3>Edit Instruction</h3>
                  <input
                    type="text"
                    className="prompt-title-input"
                    value={editingInstruction.name}
                    onChange={(e) => setEditingInstruction({
                      ...editingInstruction,
                      name: e.target.value
                    })}
                    placeholder="Enter instruction name"
                  />
                  <textarea
                    className="prompt-content-input"
                    value={editingInstruction.content}
                    onChange={(e) => setEditingInstruction({
                      ...editingInstruction,
                      content: e.target.value
                    })}
                    placeholder="Enter instruction content"
                    rows={12}
                  />
                  <div className="prompt-edit-actions">
                    <button className="cancel-button" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button 
                      className="apply-button"
                      onClick={handleUpdateInstruction}
                      disabled={!editingInstruction.name || !editingInstruction.content}
                    >
                      Update Instruction
                    </button>
                  </div>
                </div>
              ) : (
                <div className="add-prompt-form">
                  <div className="prompt-add-action">
                    <h3>Add New Instruction</h3>
                    <button 
                      className="apply-button add-prompt-button"
                      onClick={handleAddInstruction}
                      disabled={!newInstructionName || !newInstructionContent}
                    >
                      <Plus size={14} />
                      <span>Add Instruction</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    className="prompt-title-input"
                    value={newInstructionName}
                    onChange={(e) => setNewInstructionName(e.target.value)}
                    placeholder="Enter instruction name"
                  />
                  <textarea
                    className="prompt-content-input"
                    value={newInstructionContent}
                    onChange={(e) => setNewInstructionContent(e.target.value)}
                    placeholder="Enter instruction content"
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

export default InstructionsModal; 