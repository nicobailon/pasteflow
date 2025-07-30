import { VariableSizeList as List } from 'react-window';
import { useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import type { ForwardedRef } from 'react';

import { TreeNode } from '../types/file-types';

import TreeItem from './tree-item';

interface VirtualizedTreeProps {
  visibleTree: TreeNode[];
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  toggleFileSelection: (path: string) => void;
  toggleFolderSelection: (path: string) => void;
  toggleExpanded: (nodeId: string) => void;
  onViewFile?: (path: string) => void;
  loadFileContent?: (path: string) => Promise<string>;
  height: number;
}

interface ItemData {
  nodes: TreeNode[];
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  toggleFileSelection: (path: string) => void;
  toggleFolderSelection: (path: string) => void;
  toggleExpanded: (nodeId: string) => void;
  onViewFile?: (path: string) => void;
  loadFileContent?: (path: string) => Promise<string>;
}

const ITEM_HEIGHT = 32;

const Row = ({ index, style, data }: { index: number; style: React.CSSProperties; data: ItemData }) => {
  const node = data.nodes[index];
  
  return (
    <div style={style}>
      <TreeItem
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
};

export interface VirtualizedTreeHandle {
  scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => void;
  scrollTo: (scrollTop: number) => void;
}

const VirtualizedTree = forwardRef<VirtualizedTreeHandle, VirtualizedTreeProps>((props: VirtualizedTreeProps, ref: ForwardedRef<VirtualizedTreeHandle>) => {
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
  const listRef = useRef<List>(null);
  const scrollOffsetRef = useRef(0);
  
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align?: "start" | "center" | "end" | "auto") => {
      listRef.current?.scrollToItem(index, align);
    },
    scrollTo: (scrollTop: number) => {
      listRef.current?.scrollTo(scrollTop);
    }
  }), []);
  
  // Save scroll position when tree changes
  useEffect(() => {
    const currentScrollOffset = scrollOffsetRef.current;
    if (currentScrollOffset > 0 && listRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollTo(currentScrollOffset);
      });
    }
  }, [visibleTree]);
  
  const getItemSize = useCallback(() => ITEM_HEIGHT, []);
  
  const itemData: ItemData = {
    nodes: visibleTree,
    selectedFiles,
    toggleFileSelection,
    toggleFolderSelection,
    toggleExpanded,
    onViewFile,
    loadFileContent
  };
  
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