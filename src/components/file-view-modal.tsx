import * as Dialog from '@radix-ui/react-dialog';
import { CheckSquare, Square, Trash, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { UI } from '@constants';

import { useTheme } from '../context/theme-context';
import { FileData, FileViewModalProps, LineRange } from '../types/file-types';
import { useCancellableOperation } from '../hooks/use-cancellable-operation';
import { useOptimizedSelection } from '../hooks/use-optimized-selection';
import { fileViewerPerformance } from '../utils/file-viewer-performance';
import { throttle } from '../utils/throttle';
import { estimateTokenCount } from '../utils/token-utils';

import VirtualizedFileViewer from './virtualized-file-viewer';
import { FileViewerErrorBoundary } from './file-viewer-error-boundary';
import './file-view-modal.css';


const getLanguageFromPath = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'tsx': 'tsx',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'json': 'json',
    'md': 'markdown',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'cs': 'csharp',
    'go': 'go',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'rs': 'rust',
    'sh': 'bash',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'kt': 'kotlin',
    'dart': 'dart',
  };
  
  return languageMap[extension] || 'text';
};

const formatLineRanges = (lines?: LineRange[]): string => {
  if (!lines || lines.length === 0) return 'Entire file';
  
  return lines
    .map(range => range.start === range.end 
      ? `Line ${range.start}` 
      : `Lines ${range.start}-${range.end}`)
    .join(', ');
};


const FileViewModal = ({
  isOpen,
  onClose,
  filePath,
  allFiles,
  selectedFile,
  onUpdateSelectedFile,
  loadFileContent,
}: FileViewModalProps): JSX.Element => {
  const { currentTheme } = useTheme();
  const { runCancellableOperation } = useCancellableOperation();
  const [file, setFile] = useState<FileData | null>(null);
  const [initialSelection, setInitialSelection] = useState<LineRange[]>([]);
  const [selectionMode, setSelectionMode] = useState<'none'|'entire'|'specific'>('none');
  const [shiftKeyPressed, setShiftKeyPressed] = useState(false);
  const [lastSelectedLine, setLastSelectedLine] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartLine, setDragStartLine] = useState<number | null>(null);
  const [dragCurrentLine, setDragCurrentLine] = useState<number | null>(null);
  
  const {
    selectedLines,
    selectedLinesSet,
    selectRange,
    toggleLine,
    isLineSelected,
    clearSelection,
    setSelectedLines,
    mergeLineRanges,
  } = useOptimizedSelection(initialSelection);
  
  const dragSelectedLinesSet = useMemo(() => {
    const set = new Set<number>();
    if (isDragging && dragStartLine !== null && dragCurrentLine !== null) {
      const start = Math.min(dragStartLine, dragCurrentLine);
      const end = Math.max(dragStartLine, dragCurrentLine);
      for (let i = start; i <= end; i++) {
        set.add(i);
      }
    }
    return set;
  }, [isDragging, dragStartLine, dragCurrentLine]);
  
  const lineCount = useMemo(() => {
    return file?.content ? file.content.split('\n').length : 0;
  }, [file]);
  
  const shouldUseVirtualization = useMemo(() => {
    return fileViewerPerformance.shouldUseVirtualization(lineCount);
  }, [lineCount]);
  
  useEffect(() => {
    if (filePath && isOpen) {
      runCancellableOperation(async (token) => {
        const foundFile = allFiles.find((file: FileData) => file.path === filePath);
        
        if (token.cancelled) return;
        
        if (foundFile && !foundFile.isContentLoaded) {
          setFile(foundFile);
          await loadFileContent(filePath);
          if (token.cancelled) return;
        } else {
          setFile(foundFile ?? null);
        }
      });
    }
  }, [filePath, isOpen, allFiles, loadFileContent, runCancellableOperation]);

  useEffect(() => {
    if (filePath && isOpen && file) {
      const updatedFile = allFiles.find((f: FileData) => f.path === filePath);
      if (updatedFile && updatedFile.isContentLoaded && updatedFile.content && updatedFile.content !== file.content) {
        setFile(updatedFile);
      }
    }
  }, [allFiles, filePath, isOpen, file]);
  
  useEffect(() => {
    setSelectionMode('none');
    setIsDragging(false);
    
    if (selectedFile && selectedFile.lines && selectedFile.lines.length > 0) {
      setSelectedLines([...selectedFile.lines]);
      setInitialSelection([...selectedFile.lines]);
    } else {
      setSelectedLines([]);
      setInitialSelection([]);
    }
  }, [selectedFile, setSelectedLines]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftKeyPressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftKeyPressed(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  const getLineNumberFromElement = useCallback((element: Element | null): number | null => {
    if (!element) return null;
    
    let current = element;
    let depth = 0;
    const maxDepth = UI.MODAL.MAX_DOM_DEPTH;
    
    while (current && depth < maxDepth) {
      const lineAttr = (current as HTMLElement).dataset?.lineNumber;
      if (lineAttr) {
        const lineNumber = Number.parseInt(lineAttr, 10);
        if (!Number.isNaN(lineNumber)) return lineNumber;
      }
      
      if (!current.parentElement) break;
      current = current.parentElement;
      depth++;
    }
    
    return null;
  }, []);
  
  const handleLineClick = useCallback((lineNumber: number) => {
    if (selectionMode !== 'specific' || isDragging) return;
    
    if (shiftKeyPressed && lastSelectedLine !== null) {
      selectRange(lastSelectedLine, lineNumber);
    } else {
      toggleLine(lineNumber);
    }
    
    setLastSelectedLine(lineNumber);
  }, [selectionMode, isDragging, shiftKeyPressed, lastSelectedLine, toggleLine, selectRange]);
  
  const handleLineMouseDown = useCallback((lineNumber: number, e: React.MouseEvent) => {
    if (selectionMode !== 'specific' || e.button !== 0) return;
    
    e.preventDefault();
    setIsDragging(true);
    setDragStartLine(lineNumber);
    setDragCurrentLine(lineNumber);
    setLastSelectedLine(lineNumber);
  }, [selectionMode]);
  
  const handleLineMouseMove = useCallback((lineNumber: number) => {
    if (!isDragging || dragStartLine === null) return;
    setDragCurrentLine(lineNumber);
  }, [isDragging, dragStartLine]);
  
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (shouldUseVirtualization || selectionMode !== 'specific' || isDragging) return;
    
    const target = e.target as HTMLElement;
    const lineNumber = getLineNumberFromElement(target);
    
    if (lineNumber) {
      handleLineClick(lineNumber);
    }
  }, [shouldUseVirtualization, selectionMode, isDragging, handleLineClick, getLineNumberFromElement]);
  
  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (shouldUseVirtualization || selectionMode !== 'specific' || e.button !== 0) return;
    
    const target = e.target as HTMLElement;
    const lineNumber = getLineNumberFromElement(target);
    
    if (lineNumber) {
      handleLineMouseDown(lineNumber, e);
    }
  }, [shouldUseVirtualization, selectionMode, handleLineMouseDown, getLineNumberFromElement]);
  
  const handleContainerMouseMove = useMemo(() => 
    throttle((e: React.MouseEvent) => {
      if (shouldUseVirtualization || !isDragging || dragStartLine === null) return;
      
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const lineNumber = getLineNumberFromElement(target);
      
      if (lineNumber) {
        handleLineMouseMove(lineNumber);
      }
    }, UI.MODAL.DOM_QUERY_THROTTLE_MS),
  [shouldUseVirtualization, isDragging, dragStartLine, handleLineMouseMove, getLineNumberFromElement]);
  
  const handleContainerMouseUp = useCallback(() => {
    if (isDragging && dragStartLine !== null && dragCurrentLine !== null) {
      const newRange = {
        start: Math.min(dragStartLine, dragCurrentLine),
        end: Math.max(dragStartLine, dragCurrentLine)
      };
      
      setSelectedLines(mergeLineRanges([...selectedLines, newRange]));
    }
    
    setIsDragging(false);
    setDragStartLine(null);
    setDragCurrentLine(null);
  }, [isDragging, dragStartLine, dragCurrentLine, selectedLines, setSelectedLines, mergeLineRanges]);
  
  useEffect(() => {
    if (!isDragging) return;
    
    let isCleanedUp = false;
    
    // Throttle DOM queries to ~60fps
    const throttledMouseMove = throttle((e: MouseEvent) => {
      if (isCleanedUp) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const lineNumber = getLineNumberFromElement(target);
      
      if (lineNumber) {
        setDragCurrentLine(lineNumber);
      }
    }, UI.MODAL.DOM_QUERY_THROTTLE_MS);
    
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isCleanedUp) return;
      throttledMouseMove(e);
    };
    
    const handleGlobalMouseUp = () => {
      if (isCleanedUp) return;
      handleContainerMouseUp();
    };
    
    window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      isCleanedUp = true;
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleContainerMouseUp, getLineNumberFromElement]);
  
  // Ensure cleanup on unmount regardless of dragging state
  useEffect(() => {
    return () => {
      // Force cleanup dragging state on unmount
      setIsDragging(false);
      setDragStartLine(null);
      setDragCurrentLine(null);
    };
  }, []);
  
  const toggleSelectionMode = (mode: 'none' | 'entire' | 'specific') => {
    setSelectionMode(mode);
    
    switch (mode) {
      case 'none': {
        setSelectedLines([]);
        setIsDragging(false);
        break;
      }
      case 'entire': {
        setSelectedLines([]);
        break;
      }
      case 'specific': {
        setIsDragging(false);
        if (initialSelection.length > 0) {
          setSelectedLines([...initialSelection]);
        }
        break;
      }
    }
  };
  
  const selectAllLines = () => {
    if (!file || !file.content) return;
    
    const lineCount = file.content.split('\n').length;
    setSelectedLines([{ start: 1, end: lineCount }]);
  };
  
  const resetSelection = () => {
    setSelectedLines([...initialSelection]);
  };
  
  const isEntireFileSelected = (): boolean => {
    if (!file || !file.content) return false;
    if (selectionMode === 'entire') return true;
    if (selectedLines.length === 0) return false;
    
    const lineCount = file.content.split('\n').length;
    
    return selectedLines.length === 1 && 
           selectedLines[0].start === 1 && 
           selectedLines[0].end === lineCount;
  };
  
  const getSelectedContent = useCallback((): string => {
    if (!file || !file.content) return '';
    
    if (selectionMode === 'entire' || selectedLines.length === 0) {
      return file.content;
    }
    
    const lines = file.content.split('\n');
    const selectedLinesArray: string[] = [];
    
    const allSelectedLines = new Set([...selectedLinesSet, ...dragSelectedLinesSet]);
    
    for (const lineNumber of allSelectedLines) {
      if (lineNumber > 0 && lineNumber <= lines.length) {
        selectedLinesArray[lineNumber - 1] = lines[lineNumber - 1];
      }
    }
    
    return selectedLinesArray.filter(line => line !== undefined).join('\n');
  }, [file, selectedLines, selectedLinesSet, dragSelectedLinesSet, selectionMode]);
  
  const getLineProps = useCallback((lineNumber: number) => {
    const isSelected = isLineSelected(lineNumber) || dragSelectedLinesSet.has(lineNumber);
    const backgroundColor = isSelected
      ? (currentTheme === 'dark' 
        ? 'rgba(62, 68, 82, 0.5)' 
        : 'rgba(230, 242, 255, 0.5)')
      : undefined;
    
    return {
      style: { 
        display: 'block',
        cursor: selectionMode === 'specific' ? 'pointer' : 'default',
        backgroundColor,
      },
      'data-line-number': lineNumber
    };
  }, [isLineSelected, dragSelectedLinesSet, selectionMode, currentTheme]);
  
  const getLineNumberStyle = useCallback((lineNumber: number) => {
    const isSelected = isLineSelected(lineNumber) || dragSelectedLinesSet.has(lineNumber);
    const backgroundColor = isSelected
      ? (currentTheme === 'dark' 
        ? 'rgba(62, 68, 82, 0.5)' 
        : 'rgba(230, 242, 255, 0.5)')
      : undefined;
    
    const color = isSelected
      ? (currentTheme === 'dark' ? '#61afef' : '#0366d6')
      : (currentTheme === 'dark' ? '#636d83' : '#999');
    
    return {
      minWidth: '3em',
      paddingRight: '1em',
      textAlign: 'right' as const,
      userSelect: 'none' as const,
      cursor: selectionMode === 'specific' ? 'pointer' : 'default',
      color,
      backgroundColor,
    };
  }, [isLineSelected, dragSelectedLinesSet, selectionMode, currentTheme]);
  
  useEffect(() => {
    if (file?.content) {
      const lineCount = file.content.split('\n').length;
      fileViewerPerformance.measureRenderTime(lineCount, () => {});
    }
  }, [file]);
  
  const renderContent = useMemo(() => {
    if (!file || !file.content) {
      return <div className="file-view-modal-loading">Loading file...</div>;
    }
    
    if (shouldUseVirtualization) {
      return (
        <FileViewerErrorBoundary fallbackMessage="Failed to render large file. Please try refreshing or contact support if the issue persists.">
          <VirtualizedFileViewer
            content={file.content}
            language={getLanguageFromPath(file.path)}
            selectedLinesSet={selectedLinesSet}
            dragSelectedLines={dragSelectedLinesSet}
            selectionMode={selectionMode}
            containerRef={containerRef}
            onLineClick={handleLineClick}
            onLineMouseDown={handleLineMouseDown}
            onLineMouseMove={handleLineMouseMove}
          />
        </FileViewerErrorBoundary>
      );
    }
    
    return (
      <FileViewerErrorBoundary fallbackMessage="Failed to render file content. Please try refreshing or contact support if the issue persists.">
        <div className="syntax-highlighter-wrapper">
          <SyntaxHighlighter
            language={getLanguageFromPath(file.path)}
            style={currentTheme === 'dark' ? oneDark : oneLight}
            showLineNumbers={true}
            wrapLines={true}
            lineProps={getLineProps}
            lineNumberStyle={getLineNumberStyle}
            customStyle={{
              margin: 0,
              borderRadius: '4px',
              fontSize: '14px',
              overflow: 'auto'
            }}
          >
            {file.content}
          </SyntaxHighlighter>
        </div>
      </FileViewerErrorBoundary>
    );
  }, [
    file, 
    shouldUseVirtualization, 
    selectedLinesSet, 
    dragSelectedLinesSet, 
    selectionMode, 
    currentTheme,
    getLineProps,
    getLineNumberStyle,
    handleLineClick,
    handleLineMouseDown,
    handleLineMouseMove
  ]);
  
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content file-view-modal" aria-describedby={undefined}>
          <div className="file-view-modal-header">
            <Dialog.Title asChild>
              <h2>{file?.name || 'File Viewer'}</h2>
            </Dialog.Title>
            {shouldUseVirtualization && (
              <span style={{ fontSize: '12px', color: currentTheme === 'dark' ? '#888' : '#666', marginRight: 'auto', marginLeft: '10px' }}>
                (Virtualized - {lineCount} lines)
              </span>
            )}
            <Dialog.Close asChild>
              <button 
                className="file-view-modal-close-btn" 
                title="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="file-view-modal-controls">
            <div className="selection-mode-radio">
              <label>
                <input
                  type="radio"
                  checked={selectionMode === 'none'}
                  onChange={() => toggleSelectionMode('none')}
                />
                <span>View only</span>
              </label>
              <label>
                <input
                  type="radio"
                  checked={selectionMode === 'entire'}
                  onChange={() => toggleSelectionMode('entire')}
                />
                <span>Select entire file</span>
              </label>
              <label>
                <input
                  type="radio"
                  checked={selectionMode === 'specific'}
                  onChange={() => toggleSelectionMode('specific')}
                />
                <span>Select specific lines</span>
              </label>
            </div>
            
            {selectionMode === 'specific' && (
              <div className="file-view-modal-selection-actions">
                <button 
                  className="file-view-modal-action-btn" 
                  onClick={selectAllLines}
                  title="Select All Lines"
                >
                  <CheckSquare size={16} />
                  <span>Select All</span>
                </button>
                <button 
                  className="file-view-modal-action-btn" 
                  onClick={clearSelection}
                  title="Clear Selection"
                >
                  <Square size={16} />
                  <span>Clear</span>
                </button>
                {initialSelection.length > 0 && (
                  <button 
                    className="file-view-modal-action-btn" 
                    onClick={resetSelection}
                    title="Reset to Previous Selection"
                  >
                    <Trash size={16} />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            )}
          </div>
          
          <div className="file-view-modal-selection-info">
            <div className="selection-status">
              {selectionMode === 'none' ? (
                <span>Viewing file (no selection)</span>
              ) : (selectionMode === 'entire' ? (
                <span>Selecting entire file</span>
              ) : (
                <>
                  <span>Selection: {formatLineRanges(selectedLines)}</span>
                  {isEntireFileSelected() && (
                    <span className="file-view-modal-entire-file">(Entire File)</span>
                  )}
                </>
              ))}
            </div>
            
            {selectionMode === 'specific' && selectedLines.length > 0 ? (
              <div className="token-estimate">
                ~{estimateTokenCount(getSelectedContent()).toLocaleString()} tokens selected / {(file?.tokenCount || 0).toLocaleString()} total tokens
              </div>
            ) : (
              <div className="token-estimate">
                ~{(file?.tokenCount || 0).toLocaleString()} total tokens
              </div>
            )}
          </div>
          
          <div 
            className={`file-view-modal-content ${selectionMode === 'specific' ? 'selection-active' : ''}`}
            ref={containerRef}
            onClick={shouldUseVirtualization ? undefined : handleContainerClick}
            onMouseDown={shouldUseVirtualization ? undefined : handleContainerMouseDown}
            onMouseMove={shouldUseVirtualization ? undefined : handleContainerMouseMove}
            onMouseUp={shouldUseVirtualization ? undefined : handleContainerMouseUp}
            role="presentation"
            aria-label="File content viewer"
          >
            {renderContent}
          </div>
          
          <div className="file-view-modal-footer">
            <div className="selection-help">
              {selectionMode === 'specific' && (
                <span>
                  Click to select a line. Shift+click to select ranges. Click line numbers and drag to select multiple lines.
                  {shouldUseVirtualization ? '' : ' Text selection is also supported - just select text with your mouse.'}
                  Click selected lines to deselect.
                </span>
              )}
            </div>
            <div className="file-view-modal-buttons">
              <Dialog.Close asChild>
                <button 
                  className="file-view-modal-btn cancel" 
                  title="Cancel"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button 
                className="file-view-modal-btn apply" 
                onClick={() => {
                  if (!file) return;
                  
                  if (selectionMode === 'none') {
                    onClose();
                    return;
                  }
                  
                  const finalSelection = isDragging && dragStartLine !== null && dragCurrentLine !== null
                    ? mergeLineRanges([...selectedLines, {
                        start: Math.min(dragStartLine, dragCurrentLine),
                        end: Math.max(dragStartLine, dragCurrentLine)
                      }])
                    : selectedLines;
                  
                  onUpdateSelectedFile(
                    file.path,
                    selectionMode === 'specific' && finalSelection.length > 0 ? [...finalSelection] : undefined
                  );
                  
                  onClose();
                }}
                title={selectionMode === 'none' ? 'Close' : 'Apply Selection'}
              >
                {selectionMode === 'none' ? 'Close' : 'Apply'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default FileViewModal;