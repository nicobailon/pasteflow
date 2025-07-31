import { type DragEvent, useRef, useEffect } from 'react';
import { Check, GripVertical, Pencil, X } from 'lucide-react';

interface WorkspaceListItemProps {
  name: string;
  index: number;
  isSelected: boolean;
  isRenaming: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  shouldShowGap: boolean;
  newName?: string;
  onToggleSelect: () => void;
  onRenameStart: () => void;
  onRenameConfirm: (newName: string) => void;
  onRenameCancel: () => void;
  onRenameChange: (newName: string) => void;
  onLoad: () => void;
  onDelete: () => void;
  dragHandlers: {
    onDragStart: (e: DragEvent) => void;
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: (e: DragEvent) => void;
  };
  transform: string;
}

export const WorkspaceListItem = ({
  name,
  index: _index,
  isSelected,
  isRenaming,
  isDragging,
  isDragOver: _isDragOver,
  shouldShowGap,
  newName = '',
  onToggleSelect,
  onRenameStart,
  onRenameConfirm,
  onRenameCancel,
  onRenameChange,
  onLoad,
  onDelete,
  dragHandlers,
  transform
}: WorkspaceListItemProps): JSX.Element => {
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus the rename input when renaming starts
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [isRenaming]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onRenameConfirm(newName);
    }
  };

  return (
    <div 
      className={`workspace-item draggable ${isDragging ? 'dragging' : ''} ${shouldShowGap ? 'drag-over' : ''}`}
      draggable={!isRenaming}
      onDragStart={dragHandlers.onDragStart}
      onDragEnter={dragHandlers.onDragEnter}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      onDragEnd={dragHandlers.onDragEnd}
      style={{
        transform,
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      <div className="drag-handle">
        <GripVertical size={16} />
      </div>
      <div className="workspace-checkbox-container">
        <input
          type="checkbox"
          id={`workspace-checkbox-${name}`}
          className="tree-item-checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
        />
        <label 
          htmlFor={`workspace-checkbox-${name}`} 
          className="custom-checkbox"
          aria-label={`Select ${name}`}
        />
      </div>
      {isRenaming ? (
        // Renaming UI
        <>
          <div className="prompt-details flex-grow"> 
            <input
              type="text"
              className="prompt-title-input flex-grow"
              value={newName}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              ref={renameInputRef}
            />
          </div>
          <div className="workspace-actions">
            <button 
              className="prompt-action-button confirm-button"
              onClick={() => onRenameConfirm(newName)}
              title="Confirm rename"
              disabled={!newName.trim() || (newName.trim() === name)}
            >
              <Check size={16} />
            </button>
            <button 
              className="prompt-action-button cancel-button"
              onClick={onRenameCancel}
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
            <div className="prompt-title">{name}</div>
          </div>
          <div className="workspace-actions">
            <button 
              className="prompt-action-button"
              onClick={onLoad}
              title="Load workspace"
            >
              Load
            </button>
            <button 
              className="prompt-action-button rename-button"
              onClick={onRenameStart}
              title="Rename workspace"
            >
              <Pencil size={16} /> 
            </button>
            <button 
              className="prompt-action-button delete-button"
              onClick={onDelete}
              title="Delete workspace"
            >
              <X size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};