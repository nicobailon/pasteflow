import { ChevronDown } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useWorkspaceState } from '../hooks/use-workspace-state';
import { useCancellableOperation } from '../hooks/use-cancellable-operation';
import { useWorkspaceStore } from '../stores/workspace-store';
import { 
  getWorkspaceSortMode, 
  getWorkspaceManualOrder, 
  sortWorkspaces,
  WorkspaceInfo,
  WorkspaceSortMode
} from '../utils/workspace-sorting';

import Dropdown, { DropdownRef, DropdownOption } from './dropdown';

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

const WorkspaceDropdown = forwardRef<WorkspaceDropdownRef, WorkspaceDropdownProps>(
  ({ currentWorkspace, toggleWorkspaceModal, containerClassName = "workspace-dropdown", buttonClassName = "dropdown-header" }, ref) => {
  const { getWorkspaceNames, loadWorkspace: loadPersistedWorkspace } = useWorkspaceState();
  const { runCancellableOperation } = useCancellableOperation();
  const isLoadingWorkspace = useWorkspaceStore((s) => s.isLoadingWorkspace);
  const setIsLoadingWorkspace = useWorkspaceStore((s) => s.setIsLoadingWorkspace);
  const dropdownRef = useRef<DropdownRef>(null);
  const [sortMode, setSortMode] = useState<WorkspaceSortMode>('recent');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [options, setOptions] = useState<DropdownOption[]>([]);
  const [workspaceNames, setWorkspaceNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load sort preferences from database
  useEffect(() => {
    const loadSortPreferences = async () => {
      const [mode, order] = await Promise.all([
        getWorkspaceSortMode(),
        getWorkspaceManualOrder()
      ]);
      setSortMode(mode);
      setManualOrder(order);
    };
    loadSortPreferences();
  }, []);

  // Load workspace names
  useEffect(() => {
    const loadWorkspaces = async () => {
      setIsLoading(true);
      try {
        const names = await getWorkspaceNames();
        setWorkspaceNames(names);
      } catch (error) {
        console.error('Failed to load workspace names:', error);
        setWorkspaceNames([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadWorkspaces();
    
    // Listen for workspace changes
    const handleWorkspacesChanged = () => {
      loadWorkspaces();
    };
    
    window.addEventListener('workspacesChanged', handleWorkspacesChanged);
    return () => {
      window.removeEventListener('workspacesChanged', handleWorkspacesChanged);
    };
  }, [getWorkspaceNames]);

  useImperativeHandle(ref, () => ({
    close: () => dropdownRef.current?.close()
  }), []);

  const handleSelectAndLoadWorkspace = useCallback(async (name: string) => {
    // Prevent concurrent workspace loads
    if (isLoadingWorkspace) {
      return;
    }
    
    setIsLoadingWorkspace(true);
    
    try {
      await runCancellableOperation(async (token) => {
        try {
          const workspaceData = await loadPersistedWorkspace(name);
          
          // Check if cancelled before dispatching event
          if (token.cancelled) {
            return;
          }
          
          if (workspaceData) {
            window.dispatchEvent(new CustomEvent('workspaceLoaded', { detail: { name, workspace: workspaceData } }));
          } else {
            console.error(`[WorkspaceDropdown] loadPersistedWorkspace returned null for "${name}". Load failed.`);
          }
        } catch (error) {
          console.error(`[WorkspaceDropdown] Error loading workspace "${name}":`, error);
        }
      });
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [runCancellableOperation, loadPersistedWorkspace, isLoadingWorkspace]);

  const buildWorkspaceInfos = useCallback((names: Set<string>): WorkspaceInfo[] => {
    const infos: WorkspaceInfo[] = [];
    for (const name of names) {
      // For now, use the array index as a proxy for recency
      // The database returns workspaces sorted by last accessed
      const index = workspaceNames.indexOf(name);
      const savedAt = index >= 0 ? Date.now() - index * 1000 : 0;
      infos.push({ name, savedAt });
    }
    return infos;
  }, [workspaceNames]);

  const buildDropdownOptions = useCallback((sortedNames: string[]): DropdownOption[] => {
    const options = sortedNames.map((name) => ({ value: name, label: name }));
    
    if (sortedNames.length > 0) {
      options.push({ value: '__divider1__', label: '──────────' });
    }
    
    options.push(
      { value: '__new__', label: 'New Workspace' }, 
      { value: '__manage__', label: 'Manage Workspaces' }
    );
    
    return options;
  }, []);

  const getWorkspaceOptions = useCallback(async () => {
    const displayNames = new Set(workspaceNames);
    if (currentWorkspace) {
      displayNames.add(currentWorkspace);
    }
    
    const workspaceInfos = buildWorkspaceInfos(displayNames);
    const sortedNames = sortWorkspaces(workspaceInfos, sortMode, manualOrder);
    return buildDropdownOptions(sortedNames);
  }, [workspaceNames, currentWorkspace, sortMode, manualOrder, buildWorkspaceInfos, buildDropdownOptions]);

  // Update options when dependencies change
  useEffect(() => {
    const updateOptions = async () => {
      const newOptions = await getWorkspaceOptions();
      setOptions(newOptions);
    };
    
    updateOptions();
  }, [getWorkspaceOptions]);

  const handleWorkspaceDropdownChange = useCallback((value: string) => {
    switch (value) {
      case '__manage__': {
        toggleWorkspaceModal();
        break;
      }
      case '__new__': {
        window.dispatchEvent(new CustomEvent('createNewWorkspace'));
        break;
      }
      case '__divider1__':
      case currentWorkspace: {
        // No action needed
        break;
      }
      default: {
        handleSelectAndLoadWorkspace(value);
        break;
      }
    }
  }, [toggleWorkspaceModal, currentWorkspace, handleSelectAndLoadWorkspace]);

  // Only render the dropdown if there are workspaces or a current one is selected
  if (!currentWorkspace && workspaceNames.length === 0 && !isLoading) {
      return null;
  }

  return (
    <Dropdown
      ref={dropdownRef}
      options={options}
      value={currentWorkspace || ''} // Ensure value is always a string
      onChange={handleWorkspaceDropdownChange}
      buttonLabel={currentWorkspace || 'Select or create workspace'}
      buttonIcon={<ChevronDown size={16} />}
      containerClassName={containerClassName}
      buttonClassName={buttonClassName}
      closeOnChange={true} // Close dropdown after selection
    />
  );
});

WorkspaceDropdown.displayName = 'WorkspaceDropdown';

export default WorkspaceDropdown;