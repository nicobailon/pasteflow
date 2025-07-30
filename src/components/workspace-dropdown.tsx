import { ChevronDown } from 'lucide-react';
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { useWorkspaceState } from '../hooks/use-workspace-state';

import Dropdown, { DropdownRef } from './dropdown';

interface WorkspaceDropdownProps {
  currentWorkspace: string | null | undefined;
  toggleWorkspaceModal: () => void;
  // Optional class names for customization
  containerClassName?: string;
  buttonClassName?: string;
}

export interface WorkspaceDropdownRef {
  close: () => void;
}

const WorkspaceDropdown = forwardRef<WorkspaceDropdownRef, WorkspaceDropdownProps>(({
  currentWorkspace,
  toggleWorkspaceModal,
  containerClassName = "workspace-dropdown", // Default class
  buttonClassName = "dropdown-header" // Default class
}, ref) => {
  const { getWorkspaceNames, loadWorkspace: loadPersistedWorkspace } = useWorkspaceState();
  const dropdownRef = useRef<DropdownRef>(null);

  useImperativeHandle(ref, () => ({
    close: () => dropdownRef.current?.close()
  }), []);

  const handleSelectAndLoadWorkspace = (name: string) => {
    try {
      const workspaceData = loadPersistedWorkspace(name);
      if (workspaceData) {
        window.dispatchEvent(new CustomEvent('workspaceLoaded', { detail: { name, workspace: workspaceData } }));
      } else {
        console.error(`[WorkspaceDropdown] loadPersistedWorkspace returned null for "${name}". Load failed.`);
      }
    } catch (error) {
      console.error(`[WorkspaceDropdown] Error loading workspace "${name}":`, error);
    }
  };

  const getWorkspaceOptions = useCallback(() => {
    const currentNames = getWorkspaceNames();
    const displayNames = new Set(currentNames);
    if (currentWorkspace) {
      displayNames.add(currentWorkspace);
    }
    const sortedNames = [...displayNames].sort();

    const options = sortedNames.map((name) => ({ value: name, label: name }));

    if (sortedNames.length > 0) {
      options.push({ value: '__divider1__', label: '──────────' }); // Use unique value if multiple dividers
    }
    
    options.push(
      { value: '__new__', label: 'New Workspace' }, 
      { value: '__manage__', label: 'Manage Workspaces' }
    );
    return options;
  }, [getWorkspaceNames, currentWorkspace]);

  const handleWorkspaceDropdownChange = (value: string) => {
    if (value === '__manage__') {
      toggleWorkspaceModal();
    } else if (value === '__new__') {
      window.dispatchEvent(new CustomEvent('createNewWorkspace'));
    } else if (value !== '__divider1__' && value !== currentWorkspace) {
      handleSelectAndLoadWorkspace(value);
    }
  };

  // Only render the dropdown if there are workspaces or a current one is selected
  const workspaceNames = getWorkspaceNames();
  if (!currentWorkspace && workspaceNames.length === 0) {
      return null;
  }


  return (
    <Dropdown
      ref={dropdownRef}
      options={getWorkspaceOptions()}
      value={currentWorkspace || ''} // Ensure value is always a string
      onChange={handleWorkspaceDropdownChange}
      buttonLabel={currentWorkspace || 'Select or create workspace'}
      buttonIcon={<ChevronDown size={16} />}
      containerClassName={containerClassName}
      buttonClassName={buttonClassName}
      // renderCustomOption={renderCustomOption} // Removed custom rendering
      closeOnChange={true} // Close dropdown after selection
    />
  );
});

WorkspaceDropdown.displayName = 'WorkspaceDropdown';

export default WorkspaceDropdown;
