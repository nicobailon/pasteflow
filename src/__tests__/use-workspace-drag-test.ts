import { renderHook, act } from '@testing-library/react';
import { DragEvent } from 'react';
import { useWorkspaceDrag } from '../hooks/use-workspace-drag';
import { setWorkspaceManualOrder, setWorkspaceSortMode } from '../utils/workspace-sorting';
import { WORKSPACE_DRAG_SCROLL, WORKSPACE_TRANSFORMS } from '@constants';
import { setupMockLocalStorage } from './test-helpers';

// Mock the workspace sorting utils
jest.mock('../utils/workspace-sorting', () => ({
  ...jest.requireActual('../utils/workspace-sorting'),
  setWorkspaceManualOrder: jest.fn(),
  setWorkspaceSortMode: jest.fn(),
}));

describe('useWorkspaceDrag - Behavior-Driven Tests', () => {
  let mockGetSortedWorkspaces: jest.Mock;
  let mockOnReorder: jest.Mock;
  let mockDataTransfer: Partial<DataTransfer>;

  beforeEach(() => {
    setupMockLocalStorage();
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    mockGetSortedWorkspaces = jest.fn();
    mockOnReorder = jest.fn();
    
    // Mock DataTransfer for drag events
    mockDataTransfer = {
      effectAllowed: 'move' as DataTransfer['effectAllowed'],
      dropEffect: 'none',
      setData: jest.fn(),
      getData: jest.fn(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createDragEvent = (type: string, overrides: Partial<DragEvent> = {}): DragEvent => {
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    
    const event = {
      type,
      bubbles: true,
      dataTransfer: mockDataTransfer as DataTransfer,
      preventDefault,
      stopPropagation,
      clientY: 100,
      currentTarget: null,
      target: null,
      ...overrides,
    } as DragEvent;
    
    return event;
  };

  describe('Drag Start Behavior', () => {
    it('should switch to manual sort mode when starting drag in a different mode', () => {
      // Given: Workspaces in alphabetical mode with a specific order
      const workspaceOrder = ['workspace-a', 'workspace-b', 'workspace-c'];
      mockGetSortedWorkspaces.mockReturnValue(workspaceOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'alphabetical',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // When: User starts dragging the first workspace
      const dragEvent = createDragEvent('dragstart');
      act(() => {
        result.current.handleDragStart(dragEvent, 0);
      });

      // Then: System should switch to manual mode and preserve current order
      expect(setWorkspaceSortMode).toHaveBeenCalledWith('manual');
      expect(setWorkspaceManualOrder).toHaveBeenCalledWith(workspaceOrder);
      expect(mockOnReorder).toHaveBeenCalledWith(workspaceOrder);
      expect(result.current.draggedIndex).toBe(0);
      expect(mockDataTransfer.effectAllowed).toBe('move');
    });

    it('should maintain manual mode when already in manual mode', () => {
      // Given: Already in manual sort mode
      const workspaceOrder = ['workspace-1', 'workspace-2', 'workspace-3'];
      mockGetSortedWorkspaces.mockReturnValue(workspaceOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // When: User starts dragging
      const dragEvent = createDragEvent('dragstart');
      act(() => {
        result.current.handleDragStart(dragEvent, 1);
      });

      // Then: Should not update sort mode or order
      expect(setWorkspaceSortMode).not.toHaveBeenCalled();
      expect(setWorkspaceManualOrder).not.toHaveBeenCalled();
      expect(mockOnReorder).not.toHaveBeenCalled();
      expect(result.current.draggedIndex).toBe(1);
    });
  });

  describe('Auto-Scroll Behavior', () => {
    it('should auto-scroll upward when dragging near top edge', () => {
      // Given: A workspace list with a scrollable container
      const mockContainer = {
        getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
        scrollTop: 200,
      };
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Set the container ref
      Object.defineProperty(result.current.workspaceListRef, 'current', {
        value: mockContainer,
        writable: true,
        configurable: true
      });

      // When: User drags near the top edge (within scroll zone)
      const dragEvent = createDragEvent('dragover', {
        clientY: 120, // Within 50px zone from top (100)
      });
      
      act(() => {
        result.current.handleDragOver(dragEvent);
      });

      // Then: Should start scrolling upward
      const initialScrollTop = mockContainer.scrollTop;
      act(() => {
        jest.advanceTimersByTime(WORKSPACE_DRAG_SCROLL.INTERVAL_MS * 5);
      });
      
      expect(mockContainer.scrollTop).toBeLessThan(initialScrollTop);
      expect(dragEvent.preventDefault).toHaveBeenCalled();
      expect(mockDataTransfer.dropEffect).toBe('move');
    });

    it('should auto-scroll downward when dragging near bottom edge', () => {
      // Given: A workspace list with a scrollable container
      const mockContainer = {
        getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
        scrollTop: 200,
      };
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      Object.defineProperty(result.current.workspaceListRef, 'current', {
        value: mockContainer,
        writable: true,
        configurable: true
      });

      // When: User drags near the bottom edge
      const dragEvent = createDragEvent('dragover', {
        clientY: 580, // Within 50px zone from bottom (600)
      });
      
      act(() => {
        result.current.handleDragOver(dragEvent);
      });

      // Then: Should start scrolling downward
      const initialScrollTop = mockContainer.scrollTop;
      act(() => {
        jest.advanceTimersByTime(WORKSPACE_DRAG_SCROLL.INTERVAL_MS * 5);
      });
      
      expect(mockContainer.scrollTop).toBeGreaterThan(initialScrollTop);
    });

    it('should stop scrolling when drag leaves container', () => {
      // Given: Auto-scrolling is active
      const mockContainer = {
        getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
        scrollTop: 200,
      };
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      Object.defineProperty(result.current.workspaceListRef, 'current', {
        value: mockContainer,
        writable: true,
        configurable: true
      });

      // Start scrolling
      act(() => {
        result.current.handleDragOver(createDragEvent('dragover', { clientY: 120 }));
      });

      const scrollTopBeforeLeave = mockContainer.scrollTop;

      // When: Drag leaves the container
      const leaveEvent = createDragEvent('dragleave');
      leaveEvent.currentTarget = mockContainer as unknown as EventTarget & Element;
      leaveEvent.target = mockContainer as unknown as EventTarget;
      
      act(() => {
        result.current.handleDragLeave(leaveEvent);
      });

      // Then: Scrolling should stop
      act(() => {
        jest.advanceTimersByTime(WORKSPACE_DRAG_SCROLL.INTERVAL_MS * 10);
      });
      
      expect(mockContainer.scrollTop).toBe(scrollTopBeforeLeave);
    });
  });

  describe('Workspace Reordering Behavior', () => {
    it('should reorder workspaces when dropping on a different position', () => {
      // Given: Three workspaces in order
      const initialOrder = ['workspace-1', 'workspace-2', 'workspace-3'];
      mockGetSortedWorkspaces.mockReturnValue(initialOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Start dragging workspace-1
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });

      // Drag over workspace-3
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 2);
      });

      // When: Drop on workspace-3 position
      act(() => {
        result.current.handleDrop(createDragEvent('drop'), 2);
      });

      // Then: Workspaces should be reordered
      const expectedOrder = ['workspace-2', 'workspace-3', 'workspace-1'];
      expect(setWorkspaceManualOrder).toHaveBeenCalledWith(expectedOrder);
      expect(mockOnReorder).toHaveBeenCalledWith(expectedOrder);
      expect(result.current.draggedIndex).toBeNull();
      expect(result.current.dragOverIndex).toBeNull();
    });

    it('should handle upward dragging correctly', () => {
      // Given: Workspaces in order
      const initialOrder = ['workspace-a', 'workspace-b', 'workspace-c', 'workspace-d'];
      mockGetSortedWorkspaces.mockReturnValue(initialOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Start dragging workspace-d (index 3)
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 3);
      });

      // Drag over workspace-b (index 1)
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 1);
      });

      // When: Drop
      act(() => {
        result.current.handleDrop(createDragEvent('drop'), 1);
      });

      // Then: workspace-d should move to position 1
      const expectedOrder = ['workspace-a', 'workspace-d', 'workspace-b', 'workspace-c'];
      expect(setWorkspaceManualOrder).toHaveBeenCalledWith(expectedOrder);
      expect(mockOnReorder).toHaveBeenCalledWith(expectedOrder);
    });

    it('should not reorder when dropping on the same position', () => {
      // Given: Workspace being dragged
      const initialOrder = ['workspace-1', 'workspace-2', 'workspace-3'];
      mockGetSortedWorkspaces.mockReturnValue(initialOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Start dragging workspace-2
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 1);
      });

      // When: Drop on the same position
      act(() => {
        result.current.handleDrop(createDragEvent('drop'), 1);
      });

      // Then: No reordering should occur
      expect(setWorkspaceManualOrder).not.toHaveBeenCalled();
      expect(mockOnReorder).not.toHaveBeenCalled();
      expect(result.current.draggedIndex).toBeNull();
    });
  });

  describe('Visual Transform Behavior', () => {
    it('should apply upward transform to items when dragging down', () => {
      // Given: Dragging from top to bottom
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Start dragging first item
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });

      // Drag over third item
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 2);
      });

      // Then: Items between should transform upward
      expect(result.current.getItemTransform(0)).toBe('translateY(0)'); // Dragged item
      expect(result.current.getItemTransform(1)).toBe(WORKSPACE_TRANSFORMS.MOVE_UP);
      expect(result.current.getItemTransform(2)).toBe(WORKSPACE_TRANSFORMS.MOVE_UP);
      expect(result.current.getItemTransform(3)).toBe('translateY(0)'); // Unaffected
    });

    it('should apply downward transform to items when dragging up', () => {
      // Given: Dragging from bottom to top
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Start dragging third item
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 3);
      });

      // Drag over first item
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 0);
      });

      // Then: Items between should transform downward
      expect(result.current.getItemTransform(0)).toBe(WORKSPACE_TRANSFORMS.MOVE_DOWN);
      expect(result.current.getItemTransform(1)).toBe(WORKSPACE_TRANSFORMS.MOVE_DOWN);
      expect(result.current.getItemTransform(2)).toBe(WORKSPACE_TRANSFORMS.MOVE_DOWN);
      expect(result.current.getItemTransform(3)).toBe('translateY(0)'); // Dragged item
      expect(result.current.getItemTransform(4)).toBe('translateY(0)'); // Unaffected
    });

    it('should apply correct transforms during drag operations', () => {
      // Given: Three workspaces
      const workspaces = ['ws-1', 'ws-2', 'ws-3', 'ws-4'];
      mockGetSortedWorkspaces.mockReturnValue(workspaces);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // When no drag is active
      expect(result.current.getItemTransform(0)).toBe('translateY(0)');
      expect(result.current.getItemTransform(1)).toBe('translateY(0)');

      // Start dragging first item
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });

      // Still no transforms until dragOver
      expect(result.current.getItemTransform(1)).toBe('translateY(0)');

      // Drag over third item
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 2);
      });

      // Verify transforms are applied for items between drag source and target
      expect(result.current.getItemTransform(0)).toBe('translateY(0)'); // Dragged item
      expect(result.current.getItemTransform(1)).toBe(WORKSPACE_TRANSFORMS.MOVE_UP);
      expect(result.current.getItemTransform(2)).toBe(WORKSPACE_TRANSFORMS.MOVE_UP);
      expect(result.current.getItemTransform(3)).toBe('translateY(0)'); // Unaffected

      // Complete the drag
      act(() => {
        result.current.handleDrop(createDragEvent('drop'), 2);
      });

      // Then: All transforms should reset after drop
      expect(result.current.getItemTransform(0)).toBe('translateY(0)');
      expect(result.current.getItemTransform(1)).toBe('translateY(0)');
      expect(result.current.getItemTransform(2)).toBe('translateY(0)');
      expect(result.current.getItemTransform(3)).toBe('translateY(0)');
    });
  });

  describe('Edge Case Handling', () => {
    it('should handle drag end without drag over gracefully', () => {
      // Given: Drag started but no drag over occurred
      const initialOrder = ['workspace-1', 'workspace-2'];
      mockGetSortedWorkspaces.mockReturnValue(initialOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });

      // When: Drag ends without hovering over any item
      act(() => {
        result.current.handleDragEnd(createDragEvent('dragend'));
      });

      // Then: State should reset without errors
      expect(result.current.draggedIndex).toBeNull();
      expect(result.current.dragOverIndex).toBeNull();
      expect(setWorkspaceManualOrder).not.toHaveBeenCalled();
      expect(mockOnReorder).not.toHaveBeenCalled();
    });

    it('should handle consecutive drags with proper state reset', () => {
      // Given: Multiple workspaces
      const initialOrder = ['ws-1', 'ws-2', 'ws-3', 'ws-4'];
      const afterFirstDrag = ['ws-2', 'ws-1', 'ws-3', 'ws-4'];
      const afterSecondDrag = ['ws-1', 'ws-3', 'ws-4', 'ws-2'];
      
      mockGetSortedWorkspaces
        .mockReturnValueOnce(initialOrder)
        .mockReturnValueOnce(afterFirstDrag);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // First drag operation
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });
      
      expect(result.current.draggedIndex).toBe(0);
      
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 1);
      });
      
      expect(result.current.dragOverIndex).toBe(1);
      
      act(() => {
        result.current.handleDrop(createDragEvent('drop'), 1);
      });

      // Verify first operation completed
      expect(setWorkspaceManualOrder).toHaveBeenCalledTimes(1);
      expect(setWorkspaceManualOrder).toHaveBeenCalledWith(afterFirstDrag);
      expect(mockOnReorder).toHaveBeenCalledTimes(1);
      expect(mockOnReorder).toHaveBeenCalledWith(afterFirstDrag);
      expect(result.current.draggedIndex).toBeNull();
      expect(result.current.dragOverIndex).toBeNull();

      // Second drag operation
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
        result.current.handleDragOverItem(createDragEvent('dragover'), 3);
        result.current.handleDrop(createDragEvent('drop'), 3);
      });

      // Verify second operation completed
      expect(setWorkspaceManualOrder).toHaveBeenCalledTimes(2);
      expect(setWorkspaceManualOrder).toHaveBeenNthCalledWith(2, afterSecondDrag);
      expect(mockOnReorder).toHaveBeenCalledTimes(2);
      expect(mockOnReorder).toHaveBeenNthCalledWith(2, afterSecondDrag);
      expect(result.current.draggedIndex).toBeNull();
      expect(result.current.dragOverIndex).toBeNull();
    });

    it('should clean up scroll intervals when drag ends', () => {
      // Given: Active scrolling during drag
      const mockContainer = {
        getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
        scrollTop: 200,
      };
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      Object.defineProperty(result.current.workspaceListRef, 'current', {
        value: mockContainer,
        writable: true,
        configurable: true
      });

      // Start dragging
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });

      // Start scrolling by dragging near edge
      act(() => {
        result.current.handleDragOver(createDragEvent('dragover', { clientY: 120 }));
      });

      // Verify scrolling has started
      const initialScrollTop = mockContainer.scrollTop;
      act(() => {
        jest.advanceTimersByTime(WORKSPACE_DRAG_SCROLL.INTERVAL_MS * 2);
      });
      expect(mockContainer.scrollTop).toBeLessThan(initialScrollTop);

      const scrollTopBeforeDragEnd = mockContainer.scrollTop;

      // When: Drag ends
      act(() => {
        result.current.handleDragEnd(createDragEvent('dragend'));
      });

      // Then: Scrolling should stop
      act(() => {
        jest.advanceTimersByTime(WORKSPACE_DRAG_SCROLL.INTERVAL_MS * 10);
      });
      
      expect(mockContainer.scrollTop).toBe(scrollTopBeforeDragEnd);
      expect(result.current.draggedIndex).toBeNull();
      expect(result.current.dragOverIndex).toBeNull();
    });
  });

  describe('Fallback Behavior', () => {
    it('should use dragEnd as fallback when drop event does not fire', () => {
      // Given: Some browsers don't fire drop event reliably
      const initialOrder = ['workspace-1', 'workspace-2', 'workspace-3'];
      mockGetSortedWorkspaces.mockReturnValue(initialOrder);
      
      const { result } = renderHook(() => 
        useWorkspaceDrag({
          sortMode: 'manual',
          getSortedWorkspaces: mockGetSortedWorkspaces,
          onReorder: mockOnReorder,
        })
      );

      // Start drag and hover over target
      act(() => {
        result.current.handleDragStart(createDragEvent('dragstart'), 0);
      });
      
      // Verify drag started
      expect(result.current.draggedIndex).toBe(0);
      
      act(() => {
        result.current.handleDragOverItem(createDragEvent('dragover'), 2);
      });

      // Verify drag over state is set
      expect(result.current.dragOverIndex).toBe(2);

      // When: dragEnd fires without drop
      act(() => {
        result.current.handleDragEnd(createDragEvent('dragend'));
      });

      // Then: Should still reorder based on dragOverIndex
      const expectedOrder = ['workspace-2', 'workspace-3', 'workspace-1'];
      expect(setWorkspaceManualOrder).toHaveBeenCalledWith(expectedOrder);
      expect(mockOnReorder).toHaveBeenCalledWith(expectedOrder);
      expect(result.current.draggedIndex).toBeNull();
      expect(result.current.dragOverIndex).toBeNull();
    });
  });
});