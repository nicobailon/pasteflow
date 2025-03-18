import React, { useState } from "react";
import Modal from "react-modal";
import { Doc, DocsModalProps } from "../types/FileTypes";
import { Plus, Trash, Pencil, CirclePlus, Clipboard, Check, X, FileText } from "lucide-react";

// Set app element for accessibility
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
  Modal.setAppElement('#root');
}

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
    return selectedDocs.some((d: Doc) => d.id === doc.id);
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
    // @ts-expect-error - Modal has type compatibility issues
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={customStyles}
      contentLabel="Documentation Manager"
    >
      <div className="modal-content docs-modal notes-app-layout">
        <div className="modal-header">
          <h2>Documentation</h2>
          <button className="close-button" onClick={onClose}><X size={16} /></button>
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
      </div>
    </Modal>
  );
};

export default DocsModal; 