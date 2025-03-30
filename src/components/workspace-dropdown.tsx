import { ChevronDown } from 'lucide-react';
import React, { useCallback } from 'react';

import { useWorkspaceState } from '../hooks/use-workspace-state';
import Dropdown, { DropdownOption } from './dropdown';

interface WorkspaceDropdownProps {
  currentWorkspace: string | null | undefined;
  toggleWorkspaceModal: () => void;
  // Optional class names for customization
  containerClassName?: string;
  buttonClassName?: string;
}

const WorkspaceDropdown = ({
  currentWorkspace,
  toggleWorkspaceModal,
  containerClassName = "workspace-dropdown", // Default class
  buttonClassName = "dropdown-header" // Default class
}: WorkspaceDropdownProps): JSX.Element | null => {
  const { getWorkspaceNames, loadWorkspace: loadPersistedWorkspace } = useWorkspaceState();

  const handleSelectAndLoadWorkspace = (name: string) => {
    console.log(`[WorkspaceDropdown] Attempting to load workspace: ${name}`);
    try {
      const workspaceData = loadPersistedWorkspace(name);
      if (workspaceData) {
        console.log(`[WorkspaceDropdown] Workspace "${name}" loaded successfully. Dispatching 'workspaceLoaded' event.`);
        window.dispatchEvent(new CustomEvent('workspaceLoaded', { detail: { name, workspace: workspaceData } }));
      } else {
        console.error(`[WorkspaceDropdown] loadPersistedWorkspace returned null for "${name}". Load failed.`);
      }
    } catch (error) {
      console.error(`[WorkspaceDropdown] Error loading workspace "${name}":`, error);
    }
  };

  const getWorkspaceOptions = useCallback((): DropdownOption[] => {
    const currentNames = getWorkspaceNames();
    console.log("[WorkspaceDropdown.getWorkspaceOptions] Fetched workspace names:", currentNames);
    console.log("[WorkspaceDropdown.getWorkspaceOptions] Current workspace:", currentWorkspace);

    // Ensure currentWorkspace is in the list if it exists but isn't saved yet
    const displayNames = new Set(currentNames);
    if (currentWorkspace) {
        displayNames.add(currentWorkspace);
    }
    const sortedNames = Array.from(displayNames).sort();


    const options: DropdownOption[] = [
      ...sortedNames.map((name: string) => ({ value: name, label: name })),
    ];

    if (sortedNames.length > 0) {
      options.push({ value: '__divider1__', label: '──────────' }); // Use unique value if multiple dividers
    }
    
    options.push({ value: '__new__', label: 'New Workspace' }); // Added New Workspace option
    options.push({ value: '__manage__', label: 'Manage Workspaces' });
    console.log("[WorkspaceDropdown.getWorkspaceOptions] Final options:", options);
    return options;
  }, [getWorkspaceNames, currentWorkspace]);

  const handleWorkspaceDropdownChange = (value: string) => {
    console.log(`[WorkspaceDropdown] Selection changed: ${value}`);
    if (value === '__manage__') {
      toggleWorkspaceModal();
    } else if (value === '__new__') {
      console.log("[WorkspaceDropdown] 'New Workspace' selected. Dispatching 'createNewWorkspace' event.");
      window.dispatchEvent(new CustomEvent('createNewWorkspace'));
      // The App component should listen for this and reset state.
    } else if (value !== '__divider1__' && value !== currentWorkspace) { // Avoid reloading the current workspace
      handleSelectAndLoadWorkspace(value);
    }
  };

  // Only render the dropdown if there are workspaces or a current one is selected
  const workspaceNames = getWorkspaceNames();
  if (!currentWorkspace && workspaceNames.length === 0) {
      // Maybe render nothing, or a placeholder? For now, render nothing.
      // This prevents showing "Select Workspace" when there are none.
      // Consider if a different behavior is desired on the Welcome Screen.
      return null;
  }


  return (
    <Dropdown
      options={getWorkspaceOptions()}
      value={currentWorkspace || ''} // Ensure value is always a string
      onChange={handleWorkspaceDropdownChange}
      buttonLabel={currentWorkspace || 'Select Workspace'}
      buttonIcon={<ChevronDown size={16} />}
      containerClassName={containerClassName}
      buttonClassName={buttonClassName}
      // renderCustomOption={renderCustomOption} // Removed custom rendering
      closeOnChange={true} // Close dropdown after selection
    />
  );
};

export default WorkspaceDropdown;
