import { ArrowUpDown, Clock, SortAsc, GripVertical } from 'lucide-react';

import { WorkspaceSortMode } from '../utils/workspace-sorting';

import Dropdown, { DropdownOption } from './dropdown';
import './workspace-header.css';

interface WorkspaceHeaderProps {
  workspaceCount: number;
  sortMode: WorkspaceSortMode;
  selectAllChecked: boolean;
  onSortModeChange: (mode: WorkspaceSortMode) => void;
  onSelectAll: () => void;
}

const sortOptions: DropdownOption[] = [
  { value: 'recent', label: 'Most Recent', icon: <Clock size={14} /> },
  { value: 'alphabetical', label: 'Alphabetical', icon: <SortAsc size={14} /> },
  { value: 'manual', label: 'Manual Order', icon: <GripVertical size={14} /> }
];

export const WorkspaceHeader = ({
  workspaceCount,
  sortMode,
  selectAllChecked,
  onSortModeChange,
  onSelectAll
}: WorkspaceHeaderProps): JSX.Element => {
  const currentOption = sortOptions.find(opt => opt.value === sortMode);
  const buttonLabel = currentOption?.label || 'Sort';
  
  return (
    <div className="workspace-header">
      <div className="workspace-header-left">
        <h3 className="workspace-subtitle">Saved Workspaces</h3>
        {workspaceCount > 0 && (
          <div className="workspace-sort-selector">
            <Dropdown
              options={sortOptions}
              value={sortMode}
              onChange={(value) => onSortModeChange(value as WorkspaceSortMode)}
              buttonLabel={buttonLabel}
              buttonIcon={<ArrowUpDown size={14} />}
              buttonClassName="workspace-sort-dropdown-button"
              menuClassName="workspace-sort-dropdown-menu"
              containerClassName="workspace-sort-dropdown-container"
              showCheckmark={true}
              glassEffect={true}
              animationType="scale"
            />
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