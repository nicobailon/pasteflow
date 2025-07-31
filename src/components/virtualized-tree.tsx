import { VariableSizeList as List } from 'react-window';
import { useCallback, useRef, forwardRef, useImperativeHandle, useEffect, useMemo, memo } from 'react';

import { TreeNode } from '../types/file-types';

import TreeItem from './tree-item';

interface VirtualizedTreeProps {
  visibleTree: TreeNode[];
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  toggleFileSelection: (path: string) => void;
  toggleFolderSelection: (path: string) => void;
  toggleExpanded: (path: string) => void;
  onViewFile?: (path: string) => void;
  loadFileContent?: (path: string) => Promise<void>;
  height: number;
}

interface ItemData {
  nodes: TreeNode[];
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  toggleFileSelection: (path: string) => void;
  toggleFolderSelection: (path: string) => void;
  toggleExpanded: (path: string) => void;
  onViewFile?: (path: string) => void;
  loadFileContent?: (path: string) => Promise<void>;
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
        toggleFileSelection={data.toggleFileSelection}
        toggleFolderSelection={data.toggleFolderSelection}
        toggleExpanded={data.toggleExpanded}
        onViewFile={data.onViewFile}
        loadFileContent={data.loadFileContent}
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
    height
  } = props;
  const listRef = useRef<List<ItemData>>(null);
  const scrollOffsetRef = useRef(0);
  
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => {
      listRef.current?.scrollToItem(index, align);
    },
    scrollTo: (scrollTop: number) => {
      listRef.current?.scrollTo(scrollTop);
    }
  }), []);
  
  // Save scroll position when tree changes and reset item cache
  useEffect(() => {
    // Reset the item cache when tree structure changes
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
    
    const currentScrollOffset = scrollOffsetRef.current;
    if (currentScrollOffset > 0 && listRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollTo(currentScrollOffset);
      });
    }
  }, [visibleTree]);
  
  const getItemSize = useCallback(() => ITEM_HEIGHT, []);
  
  const itemData: ItemData = useMemo(() => ({
    nodes: visibleTree,
    selectedFiles,
    toggleFileSelection,
    toggleFolderSelection,
    toggleExpanded,
    onViewFile,
    loadFileContent
  }), [visibleTree, selectedFiles, toggleFileSelection, toggleFolderSelection, toggleExpanded, onViewFile, loadFileContent]);
  
  const handleScroll = useCallback(({ scrollOffset }: { scrollOffset: number }) => {
    scrollOffsetRef.current = scrollOffset;
  }, []);
  
  return (
    <List
      ref={listRef}
      height={height}
      itemCount={visibleTree.length}
      itemSize={getItemSize}
      itemData={itemData}
      width="100%"
      overscanCount={5}
      onScroll={handleScroll}
    >
      {Row}
    </List>
  );
});

VirtualizedTree.displayName = 'VirtualizedTree';

export default VirtualizedTree;