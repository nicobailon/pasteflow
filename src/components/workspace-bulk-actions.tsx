import './workspace-bulk-actions.css';

interface WorkspaceBulkActionsProps {
  selectedCount: number;
  onDelete: () => void;
  onClearSelection: () => void;
}

export const WorkspaceBulkActions = ({
  selectedCount,
  onDelete,
  onClearSelection
}: WorkspaceBulkActionsProps): JSX.Element => {
  return (
    <div className="bulk-actions-bar">
      <span className="selected-count">
        {selectedCount} workspace{selectedCount === 1 ? '' : 's'} selected
      </span>
      <div className="bulk-actions">
        <button 
          className="bulk-action-button delete"
          onClick={onDelete}
        >
          Delete Selected
        </button>
        <button 
          className="bulk-action-button clear"
          onClick={onClearSelection}
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
};