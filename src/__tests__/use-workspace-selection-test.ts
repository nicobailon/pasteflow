import { renderHook, act } from '@testing-library/react';
import { useWorkspaceSelection } from '../hooks/use-workspace-selection';
import { setupMockLocalStorage } from './test-helpers';

describe('useWorkspaceSelection - Behavior-Driven Tests', () => {
  let mockOnDelete: jest.Mock;
  let mockOnRefresh: jest.Mock;
  let mockWindowConfirm: jest.SpyInstance;

  beforeEach(() => {
    setupMockLocalStorage();
    jest.clearAllMocks();
    
    mockOnDelete = jest.fn();
    mockOnRefresh = jest.fn();
    
    // Mock window.confirm
    mockWindowConfirm = jest.spyOn(window, 'confirm');
    mockWindowConfirm.mockReturnValue(true);
  });

  afterEach(() => {
    mockWindowConfirm.mockRestore();
  });

  describe('Individual Workspace Selection', () => {
    it('should toggle individual workspace selection on and off', () => {
      // Given: Three workspaces available
      const workspaceNames = ['project-alpha', 'project-beta', 'project-gamma'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // Initially no workspaces should be selected
      expect(result.current.selectedWorkspaces.size).toBe(0);
      expect(result.current.selectAllChecked).toBe(false);

      // When: User selects project-alpha
      act(() => {
        result.current.handleToggleWorkspace('project-alpha');
      });

      // Then: Only project-alpha should be selected
      expect(result.current.selectedWorkspaces.has('project-alpha')).toBe(true);
      expect(result.current.selectedWorkspaces.size).toBe(1);
      expect(result.current.selectAllChecked).toBe(false);

      // When: User deselects project-alpha
      act(() => {
        result.current.handleToggleWorkspace('project-alpha');
      });

      // Then: No workspaces should be selected
      expect(result.current.selectedWorkspaces.has('project-alpha')).toBe(false);
      expect(result.current.selectedWorkspaces.size).toBe(0);
    });

    it('should handle multiple workspace selections independently', () => {
      // Given: Four workspaces
      const workspaceNames = ['ws-1', 'ws-2', 'ws-3', 'ws-4'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: User selects multiple workspaces
      act(() => {
        result.current.handleToggleWorkspace('ws-1');
        result.current.handleToggleWorkspace('ws-3');
        result.current.handleToggleWorkspace('ws-4');
      });

      // Then: All selected workspaces should be tracked
      expect(result.current.selectedWorkspaces.size).toBe(3);
      expect(result.current.selectedWorkspaces.has('ws-1')).toBe(true);
      expect(result.current.selectedWorkspaces.has('ws-2')).toBe(false);
      expect(result.current.selectedWorkspaces.has('ws-3')).toBe(true);
      expect(result.current.selectedWorkspaces.has('ws-4')).toBe(true);
      expect(result.current.selectAllChecked).toBe(false);
    });
  });

  describe('Select All Functionality', () => {
    it('should select all workspaces when select all is checked', () => {
      // Given: Multiple workspaces available
      const workspaceNames = ['workspace-a', 'workspace-b', 'workspace-c', 'workspace-d'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: User clicks select all
      act(() => {
        result.current.handleSelectAll();
      });

      // Then: All workspaces should be selected
      expect(result.current.selectedWorkspaces.size).toBe(4);
      expect(result.current.selectAllChecked).toBe(true);
      workspaceNames.forEach(name => {
        expect(result.current.selectedWorkspaces.has(name)).toBe(true);
      });
    });

    it('should deselect all workspaces when select all is unchecked', () => {
      // Given: All workspaces are selected
      const workspaceNames = ['workspace-a', 'workspace-b', 'workspace-c'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // Select all first
      act(() => {
        result.current.handleSelectAll();
      });

      // When: User unchecks select all
      act(() => {
        result.current.handleSelectAll();
      });

      // Then: All workspaces should be deselected
      expect(result.current.selectedWorkspaces.size).toBe(0);
      expect(result.current.selectAllChecked).toBe(false);
    });

    it('should automatically check select all when all workspaces are manually selected', () => {
      // Given: Three workspaces
      const workspaceNames = ['workspace-1', 'workspace-2', 'workspace-3'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: User manually selects all workspaces one by one
      act(() => {
        result.current.handleToggleWorkspace('workspace-1');
        result.current.handleToggleWorkspace('workspace-2');
      });
      
      expect(result.current.selectAllChecked).toBe(false);
      
      act(() => {
        result.current.handleToggleWorkspace('workspace-3');
      });

      // Then: Select all should be automatically checked
      expect(result.current.selectAllChecked).toBe(true);
      expect(result.current.selectedWorkspaces.size).toBe(3);
    });

    it('should uncheck select all when one workspace is deselected', () => {
      // Given: All workspaces are selected
      const workspaceNames = ['workspace-1', 'workspace-2', 'workspace-3'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.handleSelectAll();
      });

      // When: User deselects one workspace
      act(() => {
        result.current.handleToggleWorkspace('workspace-2');
      });

      // Then: Select all should be unchecked but others remain selected
      expect(result.current.selectAllChecked).toBe(false);
      expect(result.current.selectedWorkspaces.size).toBe(2);
      expect(result.current.selectedWorkspaces.has('workspace-1')).toBe(true);
      expect(result.current.selectedWorkspaces.has('workspace-2')).toBe(false);
      expect(result.current.selectedWorkspaces.has('workspace-3')).toBe(true);
    });
  });

  describe('Bulk Delete Functionality', () => {
    it('should delete single selected workspace with appropriate confirmation message', () => {
      // Given: One workspace selected
      const workspaceNames = ['workspace-to-delete', 'workspace-to-keep'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.handleToggleWorkspace('workspace-to-delete');
      });

      // When: User initiates bulk delete
      act(() => {
        result.current.handleBulkDelete();
      });

      // Then: Should show singular confirmation message and delete
      expect(mockWindowConfirm).toHaveBeenCalledWith(
        'Are you sure you want to delete 1 workspace? This cannot be undone.'
      );
      expect(mockOnDelete).toHaveBeenCalledWith('workspace-to-delete');
      expect(mockOnDelete).toHaveBeenCalledTimes(1);
      expect(mockOnRefresh).toHaveBeenCalledTimes(1);
      expect(result.current.selectedWorkspaces.size).toBe(0);
      expect(result.current.selectAllChecked).toBe(false);
    });

    it('should delete multiple selected workspaces with appropriate confirmation message', () => {
      // Given: Three workspaces selected
      const workspaceNames = ['ws-1', 'ws-2', 'ws-3', 'ws-4'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.handleToggleWorkspace('ws-1');
        result.current.handleToggleWorkspace('ws-2');
        result.current.handleToggleWorkspace('ws-3');
      });

      // When: User initiates bulk delete
      act(() => {
        result.current.handleBulkDelete();
      });

      // Then: Should show plural confirmation message and delete all
      expect(mockWindowConfirm).toHaveBeenCalledWith(
        'Are you sure you want to delete 3 workspaces? This cannot be undone.'
      );
      expect(mockOnDelete).toHaveBeenCalledTimes(3);
      expect(mockOnDelete).toHaveBeenCalledWith('ws-1');
      expect(mockOnDelete).toHaveBeenCalledWith('ws-2');
      expect(mockOnDelete).toHaveBeenCalledWith('ws-3');
      expect(mockOnRefresh).toHaveBeenCalledTimes(1);
      expect(result.current.selectedWorkspaces.size).toBe(0);
    });

    it('should not delete workspaces when user cancels confirmation', () => {
      // Given: Workspaces selected and user will cancel
      mockWindowConfirm.mockReturnValue(false);
      
      const workspaceNames = ['ws-1', 'ws-2'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.handleSelectAll();
      });

      // When: User initiates bulk delete but cancels
      act(() => {
        result.current.handleBulkDelete();
      });

      // Then: Nothing should be deleted
      expect(mockWindowConfirm).toHaveBeenCalled();
      expect(mockOnDelete).not.toHaveBeenCalled();
      expect(mockOnRefresh).not.toHaveBeenCalled();
      expect(result.current.selectedWorkspaces.size).toBe(2);
      expect(result.current.selectAllChecked).toBe(true);
    });

    it('should do nothing when bulk delete is called with no selection', () => {
      // Given: No workspaces selected
      const workspaceNames = ['ws-1', 'ws-2'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: User attempts bulk delete with nothing selected
      act(() => {
        result.current.handleBulkDelete();
      });

      // Then: Should not show confirmation or delete anything
      expect(mockWindowConfirm).not.toHaveBeenCalled();
      expect(mockOnDelete).not.toHaveBeenCalled();
      expect(mockOnRefresh).not.toHaveBeenCalled();
    });
  });

  describe('Clear Selection Functionality', () => {
    it('should clear all selections and reset state', () => {
      // Given: Multiple workspaces selected with select all checked
      const workspaceNames = ['ws-a', 'ws-b', 'ws-c'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.handleSelectAll();
      });

      expect(result.current.selectedWorkspaces.size).toBe(3);
      expect(result.current.selectAllChecked).toBe(true);

      // When: Clear selection is called
      act(() => {
        result.current.clearSelection();
      });

      // Then: All selections should be cleared
      expect(result.current.selectedWorkspaces.size).toBe(0);
      expect(result.current.selectAllChecked).toBe(false);
    });
  });

  describe('Dynamic Workspace List Handling', () => {
    it('should handle empty workspace list gracefully', () => {
      // Given: No workspaces available
      const workspaceNames: string[] = [];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: User tries to select all
      act(() => {
        result.current.handleSelectAll();
      });

      // Then: Should handle gracefully - selectAllChecked becomes true but no items selected
      expect(result.current.selectedWorkspaces.size).toBe(0);
      expect(result.current.selectAllChecked).toBe(true);
      
      // When: User unchecks select all
      act(() => {
        result.current.handleSelectAll();
      });
      
      // Then: Should toggle back to false
      expect(result.current.selectedWorkspaces.size).toBe(0);
      expect(result.current.selectAllChecked).toBe(false);
    });

    it('should update select all state when workspace list changes', () => {
      // Given: Initially two workspaces, all selected
      const { result, rerender } = renderHook(
        ({ workspaceNames }) => useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        }),
        {
          initialProps: { workspaceNames: ['ws-1', 'ws-2'] }
        }
      );

      act(() => {
        result.current.handleSelectAll();
      });
      expect(result.current.selectAllChecked).toBe(true);

      // When: Workspace list expands
      rerender({ workspaceNames: ['ws-1', 'ws-2', 'ws-3'] });

      // Then: Select all should be unchecked (not all are selected)
      act(() => {
        result.current.handleToggleWorkspace('ws-1');
        result.current.handleToggleWorkspace('ws-1');
      });
      
      expect(result.current.selectedWorkspaces.size).toBe(2);
      expect(result.current.selectAllChecked).toBe(false);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle selecting non-existent workspaces', () => {
      // Given: Limited workspace list
      const workspaceNames = ['existing-workspace'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: Attempting to select a non-existent workspace
      act(() => {
        result.current.handleToggleWorkspace('non-existent-workspace');
      });

      // Then: Should add to selection (hook doesn't validate against list)
      expect(result.current.selectedWorkspaces.has('non-existent-workspace')).toBe(true);
      expect(result.current.selectedWorkspaces.size).toBe(1);
    });

    it('should maintain selection state across re-renders', () => {
      // Given: Workspaces with some selected
      const workspaceNames = ['persistent-1', 'persistent-2', 'persistent-3'];
      
      const { result, rerender } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      act(() => {
        result.current.handleToggleWorkspace('persistent-1');
        result.current.handleToggleWorkspace('persistent-3');
      });

      const initialSelection = new Set(result.current.selectedWorkspaces);

      // When: Component re-renders
      rerender();

      // Then: Selection should be maintained
      expect(result.current.selectedWorkspaces).toEqual(initialSelection);
      expect(result.current.selectedWorkspaces.has('persistent-1')).toBe(true);
      expect(result.current.selectedWorkspaces.has('persistent-3')).toBe(true);
      expect(result.current.selectedWorkspaces.size).toBe(2);
    });

    it('should handle rapid selection changes correctly', () => {
      // Given: Multiple workspaces
      const workspaceNames = ['rapid-1', 'rapid-2', 'rapid-3'];
      
      const { result } = renderHook(() => 
        useWorkspaceSelection({
          workspaceNames,
          onDelete: mockOnDelete,
          onRefresh: mockOnRefresh,
        })
      );

      // When: Rapid toggling of same workspace
      act(() => {
        result.current.handleToggleWorkspace('rapid-1');
        result.current.handleToggleWorkspace('rapid-1');
        result.current.handleToggleWorkspace('rapid-1');
        result.current.handleToggleWorkspace('rapid-1');
      });

      // Then: Final state should be consistent (not selected)
      expect(result.current.selectedWorkspaces.has('rapid-1')).toBe(false);
      
      // When: Rapid selection of multiple
      act(() => {
        result.current.handleToggleWorkspace('rapid-1');
        result.current.handleToggleWorkspace('rapid-2');
        result.current.handleToggleWorkspace('rapid-3');
        result.current.handleToggleWorkspace('rapid-2');
      });

      // Then: Final state should reflect all operations
      expect(result.current.selectedWorkspaces.has('rapid-1')).toBe(true);
      expect(result.current.selectedWorkspaces.has('rapid-2')).toBe(false);
      expect(result.current.selectedWorkspaces.has('rapid-3')).toBe(true);
      expect(result.current.selectedWorkspaces.size).toBe(2);
    });
  });
});