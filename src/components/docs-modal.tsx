import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Doc, DocsModalProps } from "../types/file-types";
import { Plus, Trash, CirclePlus, Check, X } from "lucide-react";

/**
 * DocsModal component - Provides a modal dialog for managing documentation
 * with the ability to add, edit, delete, and select docs
 */
const DocsModal = ({
  isOpen,
  onClose,
  docs,
  onAddDoc,
  onDeleteDoc,
  onUpdateDoc,
  onSelectDoc,
  selectedDocs = [],
  toggleDocSelection,
}: DocsModalProps): JSX.Element => {
  const [editingDoc, setEditingDoc] = useState(null as Doc | null);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocContent, setNewDocContent] = useState("");

  const handleAddDoc = () => {
    if (!newDocTitle || !newDocContent) return;
    
    const newDoc: Doc = {
      id: Date.now().toString(),
      title: newDocTitle,
      content: newDocContent
    };
    
    onAddDoc(newDoc);
    setNewDocTitle("");
    setNewDocContent("");
    setEditingDoc(null);
  };

  const handleUpdateDoc = () => {
    if (!editingDoc || !editingDoc.title || !editingDoc.content) return;
    
    onUpdateDoc(editingDoc);
    setEditingDoc(null);
  };

  const startEdit = (doc: Doc) => {
    setEditingDoc({ ...doc });
  };

  const cancelEdit = () => {
    setEditingDoc(null);
  };

  // Check if a doc is currently selected
  const isDocSelected = (doc: Doc) => {
    return selectedDocs.some(d => d.id === doc.id);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content docs-modal notes-app-layout">
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Documentation</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button"><X size={16} /></button>
            </Dialog.Close>
          </div>
          
          <div className="modal-body">
            <div className="sidebar docs-list">
              {docs.length === 0 ? (
                <div className="no-prompts-message">
                  No documentation yet. Add one to get started.
                </div>
              ) : (
                docs.map((doc) => (
                  <div 
                    key={doc.id} 
                    className={`doc-item ${isDocSelected(doc) ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(doc);
                    }}
                  >
                    <div className="prompt-details">
                      <div className="prompt-title">{doc.title}</div>
                      <div className="prompt-preview">
                        {doc.content.length > 60 
                          ? doc.content.substring(0, 60) + "..." 
                          : doc.content}
                      </div>
                    </div>
                    <div className="prompt-actions">
                      <button 
                        className={`prompt-action-button toggle-selection-button ${isDocSelected(doc) ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDocSelection(doc);
                        }}
                        title={isDocSelected(doc) ? "Remove from selection" : "Add to selection"}
                      >
                        {isDocSelected(doc) ? (
                          <Check size={14} />
                        ) : (
                          <CirclePlus size={14} />
                        )}
                      </button>
                      <button 
                        className="prompt-action-button delete-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteDoc(doc.id);
                        }}
                        title="Delete this document"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="content-area doc-editor">
              {editingDoc ? (
                <div className="edit-prompt-form">
                  <h3>Edit Documentation</h3>
                  <input
                    type="text"
                    className="prompt-title-input"
                    value={editingDoc.title}
                    onChange={(e) => setEditingDoc({
                      ...editingDoc,
                      title: e.target.value
                    })}
                    placeholder="Enter document title"
                  />
                  <textarea
                    className="prompt-content-input"
                    value={editingDoc.content}
                    onChange={(e) => setEditingDoc({
                      ...editingDoc,
                      content: e.target.value
                    })}
                    placeholder="Enter document content"
                    rows={12}
                  />
                  <div className="prompt-edit-actions">
                    <button className="cancel-button" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button 
                      className="apply-button"
                      onClick={handleUpdateDoc}
                      disabled={!editingDoc.title || !editingDoc.content}
                    >
                      Update Document
                    </button>
                  </div>
                </div>
              ) : (
                <div className="add-prompt-form">
                  <div className="prompt-add-action">
                    <h3>Add New Documentation</h3>
                    <button 
                      className="apply-button add-prompt-button"
                      onClick={handleAddDoc}
                      disabled={!newDocTitle || !newDocContent}
                    >
                      <Plus size={14} />
                      <span>Add Document</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    className="prompt-title-input"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    placeholder="Enter document title"
                  />
                  <textarea
                    className="prompt-content-input"
                    value={newDocContent}
                    onChange={(e) => setNewDocContent(e.target.value)}
                    placeholder="Enter document content"
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

export default DocsModal; 