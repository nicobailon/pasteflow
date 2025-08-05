import { useState, useRef, useCallback, type DragEvent } from 'react';

import { WorkspaceSortMode, moveWorkspace, setWorkspaceManualOrder, setWorkspaceSortMode } from '../utils/workspace-sorting';
import { WORKSPACE_DRAG_SCROLL, WORKSPACE_TRANSFORMS } from '../constants/workspace-drag-constants';

interface UseWorkspaceDragOptions {
  sortMode: WorkspaceSortMode;
  getSortedWorkspaces: () => string[];
  onReorder: (newOrder: string[]) => void;
}

interface UseWorkspaceDragReturn {
  draggedIndex: number | null;
  dragOverIndex: number | null;
  workspaceListRef: React.RefObject<HTMLDivElement>;
  handleDragStart: (e: DragEvent, index: number) => void;
  handleDragOver: (e: DragEvent) => void;
  handleDragOverItem: (e: DragEvent, index: number) => void;
  handleDragEnter: (e: DragEvent, index: number) => void;
  handleDrop: (e: DragEvent, dropIndex: number) => void;
  handleDragEnd: (e: DragEvent) => void;
  handleDragLeave: (e: DragEvent) => void;
  getItemTransform: (index: number) => string;
}

export const useWorkspaceDrag = ({
  sortMode,
  getSortedWorkspaces,
  onReorder
}: UseWorkspaceDragOptions): UseWorkspaceDragReturn => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const workspaceListRef = useRef<HTMLDivElement | null>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleDragStart = useCallback((e: DragEvent, index: number) => {
    // If not in manual mode, switch to it and preserve current order
    if (sortMode !== 'manual') {
      const currentOrder = getSortedWorkspaces();
      setWorkspaceManualOrder(currentOrder);
      setWorkspaceSortMode('manual');
      onReorder(currentOrder);
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  }, [sortMode, getSortedWorkspaces, onReorder]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Auto-scroll functionality
    if (!workspaceListRef.current) return;
    
    const container = workspaceListRef.current;
    const containerRect = container.getBoundingClientRect();
    const mouseY = e.clientY;
    
    // Define scroll zones
    const scrollZoneSize = WORKSPACE_DRAG_SCROLL.ZONE_SIZE;
    const scrollSpeed = WORKSPACE_DRAG_SCROLL.BASE_SPEED;
    
    // Clear any existing scroll interval
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    
    // Check if we're in the top scroll zone
    if (mouseY < containerRect.top + scrollZoneSize) {
      const intensity = 1 - (mouseY - containerRect.top) / scrollZoneSize;
      scrollIntervalRef.current = setInterval(() => {
        container.scrollTop -= scrollSpeed * (1 + intensity * WORKSPACE_DRAG_SCROLL.SPEED_MULTIPLIER);
      }, WORKSPACE_DRAG_SCROLL.INTERVAL_MS);
    }
    // Check if we're in the bottom scroll zone
    else if (mouseY > containerRect.bottom - scrollZoneSize) {
      const intensity = 1 - (containerRect.bottom - mouseY) / scrollZoneSize;
      scrollIntervalRef.current = setInterval(() => {
        container.scrollTop += scrollSpeed * (1 + intensity * WORKSPACE_DRAG_SCROLL.SPEED_MULTIPLIER);
      }, WORKSPACE_DRAG_SCROLL.INTERVAL_MS);
    }
  }, []);
  
  const handleDragOverItem = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  }, [draggedIndex]);
  
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    
    // Clear any active scroll interval
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    
    // Use dragOverIndex if we have it, otherwise use dropIndex
    const targetIndex = dragOverIndex === null ? dropIndex : dragOverIndex;
    
    if (draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    
    const sortedNames = getSortedWorkspaces();
    
    const newOrder = moveWorkspace(sortedNames, draggedIndex, targetIndex);
    
    // Update both state and database (fire and forget)
    setWorkspaceManualOrder(newOrder).catch(console.error);
    onReorder(newOrder);
    
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, dragOverIndex, getSortedWorkspaces, onReorder]);

  const handleDragEnd = useCallback(() => {
    
    // If we have a dragOverIndex, use it to reorder (fallback for when drop doesn't fire)
    if (draggedIndex === null || dragOverIndex === null || draggedIndex === dragOverIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      
      // Clear any active scroll interval
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      return;
    }
    
    const sortedNames = getSortedWorkspaces();
    
    const newOrder = moveWorkspace(sortedNames, draggedIndex, dragOverIndex);
    
    // Update database (fire and forget)
    setWorkspaceManualOrder(newOrder).catch(console.error);
    onReorder(newOrder);
    
    setDraggedIndex(null);
    setDragOverIndex(null);
    
    // Clear any active scroll interval
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, [draggedIndex, dragOverIndex, getSortedWorkspaces, onReorder]);
  
  const handleDragLeave = useCallback((e: DragEvent) => {
    // Only stop scrolling if we're leaving the container itself
    if (e.currentTarget === e.target && scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
  }, []);

  const getItemTransform = useCallback((index: number): string => {
    if (draggedIndex === null) return 'translateY(0)';
    if (dragOverIndex === null) return 'translateY(0)';
    
    // Create space for the dragged item
    if (draggedIndex < dragOverIndex) {
      // Dragging down
      if (index > draggedIndex && index <= dragOverIndex) {
        return WORKSPACE_TRANSFORMS.MOVE_UP;
      }
    } else {
      // Dragging up
      if (index < draggedIndex && index >= dragOverIndex) {
        return WORKSPACE_TRANSFORMS.MOVE_DOWN;
      }
    }
    return 'translateY(0)';
  }, [draggedIndex, dragOverIndex]);


  return {
    draggedIndex,
    dragOverIndex,
    workspaceListRef,
    handleDragStart,
    handleDragOver,
    handleDragOverItem,
    handleDragEnter,
    handleDrop,
    handleDragEnd,
    handleDragLeave,
    getItemTransform
  };
};