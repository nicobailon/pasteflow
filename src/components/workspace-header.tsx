import { WorkspaceSortMode } from '../utils/workspace-sorting';

interface WorkspaceHeaderProps {
  workspaceCount: number;
  sortMode: WorkspaceSortMode;
  selectAllChecked: boolean;
  onSortModeChange: (mode: WorkspaceSortMode) => void;
  onSelectAll: () => void;
}

export const WorkspaceHeader = ({
  workspaceCount,
  sortMode,
  selectAllChecked,
  onSortModeChange,
  onSelectAll
}: WorkspaceHeaderProps): JSX.Element => {
  return (
    <div className="workspace-header">
      <div className="workspace-header-left">
        <h3 className="workspace-subtitle">Saved Workspaces</h3>
        {workspaceCount > 0 && (
          <div className="workspace-sort-selector">
            <select
              value={sortMode}
              onChange={(e) => onSortModeChange(e.target.value as WorkspaceSortMode)}
              className="workspace-sort-dropdown"
            >
              <option value="recent">Most Recent</option>
              <option value="alphabetical">Alphabetical</option>
              <option value="manual">Manual Order</option>
            </select>
          </div>
        )}
      </div>
      {workspaceCount > 0 && (
        <div className="workspace-select-all">
          <div className="workspace-checkbox-container">
            <input
              type="checkbox"
              id="workspace-select-all"
              className="tree-item-checkbox"
              checked={selectAllChecked}
              onChange={onSelectAll}
            />
            <label htmlFor="workspace-select-all" className="custom-checkbox" aria-label="Select all workspaces" />
          </div>
          <label htmlFor="workspace-select-all" className="select-all-label">Select All</label>
        </div>
      )}
    </div>
  );
};