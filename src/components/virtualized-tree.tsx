import { VariableSizeList as List } from 'react-window';
import { useCallback, useRef, forwardRef, useImperativeHandle, useEffect, useMemo, memo, useState } from 'react';
 
import { TreeNode, SelectedFileReference } from '../types/file-types';
 
import TreeItem from './tree-item';

interface VirtualizedTreeProps {
  visibleTree: TreeNode[];
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  toggleFileSelection: (path: string) => void;
  toggleFolderSelection: (path: string, isSelected: boolean, opts?: { optimistic?: boolean }) => void;
  toggleExpanded: (path: string) => void;
  onViewFile?: (path: string) => void;
  loadFileContent?: (path: string) => Promise<void>;
  height: number;
  folderSelectionCache?: import('../utils/selection-cache').DirectorySelectionCache;
}

interface ItemData {
  nodes: TreeNode[];
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  selectedFilesLookup?: Map<string, SelectedFileReference>;
  toggleFileSelection: (path: string) => void;
  toggleFolderSelection: (path: string, isSelected: boolean, opts?: { optimistic?: boolean }) => void;
  toggleExpanded: (path: string) => void;
  onViewFile?: (path: string) => void;
  loadFileContent?: (path: string) => Promise<void>;
  folderSelectionCache?: import('../utils/selection-cache').DirectorySelectionCache;
}

const ITEM_HEIGHT = 32;

const Row = memo(({ index, style, data }: { index: number; style: React.CSSProperties; data: ItemData }) => {
  const node = data.nodes[index];
  
  // Guard against invalid index
  if (!node) {
    console.error('Invalid node at index:', index, 'Total nodes:', data.nodes.length);
    return null;
  }
  
  
  return (
    <div style={style}>
      <TreeItem
        key={node.path}  // Add key to ensure proper component identity
        node={node}
        selectedFiles={data.selectedFiles}
        selectedFilesLookup={data.selectedFilesLookup}
        toggleFileSelection={data.toggleFileSelection}
        toggleFolderSelection={data.toggleFolderSelection}
        toggleExpanded={data.toggleExpanded}
        onViewFile={data.onViewFile}
        loadFileContent={data.loadFileContent}
        folderSelectionCache={data.folderSelectionCache}
      />
    </div>
  );
});

Row.displayName = 'Row';

export interface VirtualizedTreeHandle {
  scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => void;
  scrollTo: (scrollTop: number) => void;
}

const VirtualizedTree = forwardRef<VirtualizedTreeHandle, VirtualizedTreeProps>((props, ref) => {
  const {
    visibleTree,
    selectedFiles,
    toggleFileSelection,
    toggleFolderSelection,
    toggleExpanded,
    onViewFile,
    loadFileContent,
    height,
    folderSelectionCache
  } = props;
  const listRef = useRef<List<ItemData>>(null);
  const scrollOffsetRef = useRef(0);
  const lastScrollInfoRef = useRef<{ t: number; y: number } | null>(null);
  const [overscan, setOverscan] = useState(5);
  
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => {
      listRef.current?.scrollToItem(index, align);
    },
    scrollTo: (scrollTop: number) => {
      listRef.current?.scrollTo(scrollTop);
    }
  }), []);
  
  // Reset item cache only when tree length changes (not on every render)
  const previousTreeLength = useRef(visibleTree.length);
  
  useEffect(() => {
    // Only reset if the tree size actually changed
    if (previousTreeLength.current !== visibleTree.length && listRef.current) {
      listRef.current.resetAfterIndex(0);
      previousTreeLength.current = visibleTree.length;
      
      // Restore scroll position after reset
      const currentScrollOffset = scrollOffsetRef.current;
      if (currentScrollOffset > 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollTo(currentScrollOffset);
        });
      }
    }
  }, [visibleTree.length]);
  
  const getItemSize = useCallback(() => ITEM_HEIGHT, []);
  
  // Build O(1) lookup map for selection state to avoid per-node linear scans
  const selectedFilesLookup = useMemo(
    () => new Map<string, SelectedFileReference>(selectedFiles.map(f => [f.path, f])),
    [selectedFiles]
  );
  
  const itemData: ItemData = useMemo(() => ({
    nodes: visibleTree,
    selectedFiles,
    selectedFilesLookup,
    toggleFileSelection,
    toggleFolderSelection,
    toggleExpanded,
    onViewFile,
    loadFileContent,
    folderSelectionCache
  }), [visibleTree, selectedFiles, selectedFilesLookup, toggleFileSelection, toggleFolderSelection, toggleExpanded, onViewFile, loadFileContent, folderSelectionCache]);
  
  const handleScroll = useCallback(({ scrollOffset }: { scrollOffset: number }) => {
    const now = performance.now();
    const last = lastScrollInfoRef.current;
    if (last) {
      const dy = Math.abs(scrollOffset - last.y);
      const dt = Math.max(1, now - last.t);
      const velocity = dy / dt; // px per ms
      // Simple heuristic: bump overscan when velocity is high
      let next = 5;
      if (velocity > 2.0) next = 20;       // very fast scroll
      else if (velocity > 0.75) next = 12; // moderate scroll
      if (next !== overscan) setOverscan(next);
    }
    lastScrollInfoRef.current = { t: now, y: scrollOffset };
    scrollOffsetRef.current = scrollOffset;
  }, [overscan]);
  
  // Hint selection overlay to prioritize currently visible directories
  useEffect(() => {
    if (!folderSelectionCache?.startProgressiveRecompute) return;
    
    // Use a timeout to debounce rapid updates
    const timeoutId = setTimeout(() => {
      // Gather directory paths in the visible window (prioritize directories)
      const priorityPaths = visibleTree
        .filter(n => n.type === 'directory')
        .map(n => n.path);
      // Build selected path set for accurate recomputation
      const selectedPathSet = new Set<string>(selectedFiles.map(f => f.path));
      // Kick progressive recompute with visibility-first priority
      folderSelectionCache.startProgressiveRecompute?.({
        selectedPaths: selectedPathSet,
        priorityPaths,
      });
    }, 100);
    
    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTree, selectedFiles]);
  
  return (
    <List
      ref={listRef}
      height={height}
      itemCount={visibleTree.length}
      itemSize={getItemSize}
      itemData={itemData}
      width="100%"
      overscanCount={overscan}
      onScroll={handleScroll}
    >
      {Row}
    </List>
  );
});

VirtualizedTree.displayName = 'VirtualizedTree';

export default VirtualizedTree;