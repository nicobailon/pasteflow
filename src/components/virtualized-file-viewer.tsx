import React, { useCallback, useEffect, useMemo, useRef, useState, CSSProperties, memo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { useTheme } from '../context/theme-context';
import { UI } from '@constants';

interface VirtualizedFileViewerProps {
  content: string;
  language: string;
  selectedLinesSet: Set<number>;
  dragSelectedLines: Set<number>;
  selectionMode: 'none' | 'entire' | 'specific';
  containerRef: React.RefObject<HTMLDivElement>;
  onLineClick?: (lineNumber: number) => void;
  onLineMouseDown?: (lineNumber: number, e: React.MouseEvent) => void;
  onLineMouseMove?: (lineNumber: number) => void;
}

interface LineData {
  content: string;
  lineNumber: number;
  isSelected: boolean;
  isDragSelected: boolean;
}

interface RowRendererProps {
  index: number;
  style: CSSProperties;
  data: {
    lines: LineData[];
    language: string;
    theme: 'light' | 'dark';
    selectionMode: 'none' | 'entire' | 'specific';
    onLineClick?: (lineNumber: number) => void;
    onLineMouseDown?: (lineNumber: number, e: React.MouseEvent) => void;
    onLineMouseMove?: (lineNumber: number) => void;
  };
}

const VirtualizedLineRenderer = memo<RowRendererProps>(({ index, style, data }) => {
  const { lines, language, theme, selectionMode, onLineClick, onLineMouseDown, onLineMouseMove } = data;
  const line = lines[index];
  
  const handleClick = useCallback((e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (selectionMode === 'specific' && onLineClick && line) {
      onLineClick(line.lineNumber);
    }
  }, [selectionMode, onLineClick, line]);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (selectionMode === 'specific' && onLineMouseDown && line) {
      onLineMouseDown(line.lineNumber, e);
    }
  }, [selectionMode, onLineMouseDown, line]);
  
  const handleMouseMove = useCallback(() => {
    if (onLineMouseMove && line) {
      onLineMouseMove(line.lineNumber);
    }
  }, [onLineMouseMove, line]);
  
  if (!line) return null;
  
  const { content, lineNumber, isSelected, isDragSelected } = line;
  const isHighlighted = isSelected || isDragSelected;
  
  const backgroundColor = isHighlighted
    ? (theme === 'dark' 
      ? 'rgba(62, 68, 82, 0.5)' 
      : 'rgba(230, 242, 255, 0.5)')
    : undefined;
  
  const lineNumberColor = isHighlighted
    ? (theme === 'dark' ? '#61afef' : '#0366d6')
    : (theme === 'dark' ? '#636d83' : '#999');
  
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        backgroundColor,
        cursor: selectionMode === 'specific' ? 'pointer' : 'default',
        fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
        fontSize: '14px',
        lineHeight: '1.5',
      }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={selectionMode === 'specific' ? 0 : -1}
      data-line-number={lineNumber}
    >
      <span
        style={{
          minWidth: '3em',
          paddingRight: '1em',
          textAlign: 'right',
          userSelect: 'none',
          color: lineNumberColor,
          backgroundColor,
        }}
      >
        {lineNumber}
      </span>
      <div style={{ flex: 1, paddingLeft: '0.5em', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <SyntaxHighlighter
          language={language}
          style={theme === 'dark' ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            overflow: 'visible',
          }}
          codeTagProps={{
            style: {
              fontSize: 'inherit',
              fontFamily: 'inherit',
            }
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

VirtualizedLineRenderer.displayName = 'VirtualizedLineRenderer';

const VirtualizedFileViewer: React.FC<VirtualizedFileViewerProps> = ({
  content,
  language,
  selectedLinesSet,
  dragSelectedLines,
  selectionMode,
  containerRef,
  onLineClick,
  onLineMouseDown,
  onLineMouseMove,
}) => {
  const { currentTheme } = useTheme();
  const listRef = useRef<List>(null);
  
  const lines = useMemo(() => {
    const splitLines = content.split('\n');
    return splitLines.map((line, index): LineData => ({
      content: line,
      lineNumber: index + 1,
      isSelected: selectedLinesSet.has(index + 1),
      isDragSelected: dragSelectedLines.has(index + 1),
    }));
  }, [content, selectedLinesSet, dragSelectedLines]);
  
  const itemData = useMemo(() => ({
    lines,
    language,
    theme: currentTheme,
    selectionMode,
    onLineClick,
    onLineMouseDown,
    onLineMouseMove,
  }), [lines, language, currentTheme, selectionMode, onLineClick, onLineMouseDown, onLineMouseMove]);
  
  const [containerHeight, setContainerHeight] = useState(600);
  const itemHeight = UI.TREE.DEFAULT_LINE_HEIGHT || 20;
  const overscanCount = 20;
  
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerHeight(rect.height || 600);
      }
    };
    
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [containerRef]);
  
  return (
    <div 
      ref={containerRef}
      style={{ 
        height: '100%', 
        width: '100%',
        backgroundColor: currentTheme === 'dark' ? '#282c34' : '#fafafa',
      }}
    >
      <List
        ref={listRef}
        height={containerHeight}
        itemCount={lines.length}
        itemSize={itemHeight}
        width="100%"
        itemData={itemData}
        overscanCount={overscanCount}
        style={{
          overflow: 'auto',
        }}
      >
        {VirtualizedLineRenderer}
      </List>
    </div>
  );
};

export default VirtualizedFileViewer;