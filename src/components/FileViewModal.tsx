import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FileViewModalProps, LineRange, FileData } from '../types/FileTypes';
import { useTheme } from '../context/ThemeContext';
import { Check, Trash, CheckSquare, Square, X } from 'lucide-react';

// Map file extensions to language identifiers for syntax highlighting
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

// Helper function to format line ranges as readable text
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
}: FileViewModalProps): JSX.Element => {
  const { currentTheme } = useTheme();
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [file, setFile] = useState<FileData | null>(null);
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [selectedLines, setSelectedLines] = useState<LineRange[]>([]);
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [initialSelection, setInitialSelection] = useState<LineRange[]>([]);
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [selectionMode, setSelectionMode] = useState<'entire'|'specific'>('entire');
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [shiftKeyPressed, setShiftKeyPressed] = useState(false);
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [lastSelectedLine, setLastSelectedLine] = useState<number | null>(null);
  // @ts-ignore - Typed useRef hook is flagged in strict mode
  const containerRef = useRef<HTMLDivElement>(null);
  // Track total token count
  const [totalTokenCount, setTotalTokenCount] = useState(0);
  
  // Track mouse state for drag selection
  const [isDragging, setIsDragging] = useState(false);
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [dragStartLine, setDragStartLine] = useState<number | null>(null);
  // @ts-ignore - Typed useState hooks are flagged in strict mode
  const [dragCurrentLine, setDragCurrentLine] = useState<number | null>(null);
  
  // Find the file in allFiles when filePath changes
  useEffect(() => {
    if (filePath) {
      const foundFile = allFiles.find((file: FileData) => file.path === filePath);
      setFile(foundFile || null);
      
      // Calculate total token count when file changes
      if (foundFile && foundFile.content) {
        setTotalTokenCount(calculateTokenCount(foundFile.content));
      } else {
        setTotalTokenCount(0);
      }
    } else {
      setFile(null);
      setTotalTokenCount(0);
    }
  }, [filePath, allFiles]);
  
  // Initialize selected lines based on the selectedFile prop
  useEffect(() => {
    if (selectedFile) {
      if (selectedFile.lines && selectedFile.lines.length > 0) {
        // If file has specific line selection already, use it
        setSelectedLines([...selectedFile.lines]);
        setInitialSelection([...selectedFile.lines]);
        setSelectionMode('specific');
        setIsSelectionActive(true);
      } else if (selectedFile.isFullFile) {
        // If file was explicitly selected as entire file before, keep that mode
        setSelectedLines([]);
        setInitialSelection([]);
        setSelectionMode('entire');
        setIsSelectionActive(false);
      } else {
        // Otherwise, default to specific lines mode
        setSelectedLines([]);
        setInitialSelection([]);
        setSelectionMode('specific');
        setIsSelectionActive(true);
      }
    } else {
      // No file previously selected, default to specific lines mode
      setSelectedLines([]);
      setInitialSelection([]);
      setSelectionMode('specific');
      setIsSelectionActive(true);
    }
  }, [selectedFile]);
  
  // Handle shift key press/release
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
  
  // Check if a line is selected - performance optimized with binary search
  const isLineSelected = useCallback((lineNumber: number): boolean => {
    // Fast path for empty selection
    if (selectedLines.length === 0) return false;
    
    // For small arrays, linear scan is faster than binary search
    if (selectedLines.length <= 3) {
      return selectedLines.some((range: LineRange) => 
        lineNumber >= range.start && lineNumber <= range.end
      );
    }
    
    // For larger arrays, use binary search for better performance
    // Assumes selectedLines are sorted and non-overlapping (which is maintained by mergeLineRanges)
    
    // Binary search to find the potential range
    let low = 0;
    let high = selectedLines.length - 1;
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const range = selectedLines[mid];
      
      // Check if this range contains our line
      if (lineNumber >= range.start && lineNumber <= range.end) {
        return true;
      }
      
      // Determine which half to search next
      if (lineNumber < range.start) {
        high = mid - 1; // Search in the lower half
      } else {
        low = mid + 1; // Search in the upper half
      }
    }
    
    return false;
  }, [selectedLines]);
  
  // Helper function to merge line ranges - optimized with early exits and reduced operations
  const mergeLineRanges = useCallback((ranges: LineRange[]): LineRange[] => {
    // Fast path for common cases
    if (ranges.length === 0) return [];
    if (ranges.length === 1) return [{ ...ranges[0] }]; // Clone to avoid mutations
    
    // Sort by start line 
    // Create a new array to avoid mutating the input array
    const sortedRanges = ranges.slice().sort((a, b) => a.start - b.start);
    
    // Pre-allocate result array with reasonable capacity
    const mergedRanges: LineRange[] = [];
    // Clone the first range to avoid mutating the original
    let currentRange: LineRange = { ...sortedRanges[0] };
    
    // Single-pass merge algorithm
    for (let i = 1; i < sortedRanges.length; i++) {
      const nextRange = sortedRanges[i];
      
      // If ranges overlap or are adjacent (current end + 1 >= next start)
      if (nextRange.start <= currentRange.end + 1) {
        // Update the end of current range if needed
        if (nextRange.end > currentRange.end) {
          currentRange.end = nextRange.end;
        }
        // No need to create a new object, just update the current one
      } else {
        // Ranges don't overlap, add current to result
        mergedRanges.push(currentRange);
        // Clone the next range to avoid mutation
        currentRange = { ...nextRange };
      }
    }
    
    // Add the last processed range
    mergedRanges.push(currentRange);
    return mergedRanges;
  }, []);

  // Start drag selection on mouse down
  const handleMouseDown = useCallback((lineNumber: number, e: any) => {
    if (selectionMode === 'entire') return;
    
    // Only handle left mouse button
    if (e.button !== 0) return;
    
    // Start tracking drag
    setIsDragging(true);
    setDragStartLine(lineNumber);
    setDragCurrentLine(lineNumber);
    
    // Prevent text selection during line number drag
    e.preventDefault();
    
    // Set as the last selected line for shift+click functionality
    setLastSelectedLine(lineNumber);
  }, [selectionMode]);
  
  // Update drag selection on mouse move
  const handleMouseMove = useCallback((lineNumber: number) => {
    if (!isDragging || dragStartLine === null) return;
    
    setDragCurrentLine(lineNumber);
  }, [isDragging, dragStartLine]);
  
  // End drag selection on mouse up
  const handleMouseUp = useCallback(() => {
    if (isDragging && dragStartLine !== null && dragCurrentLine !== null) {
      // Add the dragged range to the selection
      setSelectedLines((prev: LineRange[]) => {
        const newSelectedLines = [...prev];
        
        // Add the new range
        newSelectedLines.push({
          start: Math.min(dragStartLine, dragCurrentLine),
          end: Math.max(dragStartLine, dragCurrentLine)
        });
        
        // Merge adjacent or overlapping ranges
        return mergeLineRanges(newSelectedLines);
      });
    }
    
    // Reset drag state
    setIsDragging(false);
    setDragStartLine(null);
    setDragCurrentLine(null);
  }, [isDragging, dragStartLine, dragCurrentLine, mergeLineRanges]);
  
  // Set up mouse move and up listeners for drag selection - optimized
  useEffect(() => {
    if (!isDragging) return;

    // Pre-calculate container bounds and line heights once
    let containerBounds: DOMRect | null = null;
    let avgLineHeight: number = 0;
    let lineCount: number = 0;
    let lineElements: NodeListOf<Element> | null = null;
    
    if (containerRef.current) {
      containerBounds = containerRef.current.getBoundingClientRect();
      lineElements = containerRef.current.querySelectorAll('[data-line-number]');
      
      if (lineElements && lineElements.length > 0) {
        avgLineHeight = containerRef.current.scrollHeight / lineElements.length;
      }
      
      if (file && file.content) {
        lineCount = file.content.split('\n').length;
      }
    }
    
    // Define the event handlers
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !containerBounds) return;
      
      // Check if mouse is within the container bounds
      if (e.clientY < containerBounds.top || e.clientY > containerBounds.top + containerBounds.height || 
          e.clientX < containerBounds.left || e.clientX > containerBounds.left + containerBounds.width) {
        return;
      }
      
      // Use a memoization cache for elements-under-cursor to reduce DOM calls
      // Try to get the element under the cursor using elementFromPoint (most efficient approach)
      const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
      if (elementUnderCursor) {
        // Fast check for line number attribute
        const lineAttr = elementUnderCursor.getAttribute('data-line-number');
        if (lineAttr) {
          const lineNumber = parseInt(lineAttr, 10);
          if (!isNaN(lineNumber)) {
            handleMouseMove(lineNumber);
            return;
          }
        }
        
        // Quick parent traversal - limited to 3 levels for performance
        let current = elementUnderCursor;
        let traversalDepth = 0;
        const MAX_DEPTH = 3;
        
        while (current && current !== containerRef.current && traversalDepth < MAX_DEPTH) {
          traversalDepth++;
          
          const lineAttr = current instanceof Element ? current.getAttribute('data-line-number') : null;
          if (lineAttr) {
            const lineNumber = parseInt(lineAttr, 10);
            if (!isNaN(lineNumber)) {
              handleMouseMove(lineNumber);
              return;
            }
          }
          
          const nextNode = current.parentElement || (current.parentNode instanceof Element ? current.parentNode : null);
          if (!nextNode) break;
          current = nextNode;
        }
      }
      
      // Fast position-based estimation as fallback
      if (avgLineHeight > 0 && lineCount > 0) {
        const relativeY = e.clientY - containerBounds.top;
        const lineIndex = Math.floor(relativeY / avgLineHeight);
        const lineNumber = Math.max(1, Math.min(lineCount, lineIndex + 1));
        handleMouseMove(lineNumber);
      }
    };
    
    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };
    
    // Use passive event listeners for better scrolling performance
    window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, file]);
  
  // Helper function to get line numbers from DOM nodes - optimized
  const getLineNumberFromNode = useCallback((node: Node): number | null => {
    // Try to find the nearest element with a data-line-number attribute
    // This is a faster approach than the previous implementation
    if (!node || !containerRef.current) return null;
    
    // If we have direct access to the line number attribute, use it
    if (node instanceof Element) {
      const lineAttr = node.getAttribute('data-line-number');
      if (lineAttr) {
        return parseInt(lineAttr, 10);
      }
    }
    
    // Find closest ancestor with line number
    let element = (node instanceof Element) ? node : node.parentElement;
    while (element && element !== containerRef.current) {
      const lineAttr = element.getAttribute('data-line-number');
      if (lineAttr) {
        return parseInt(lineAttr, 10);
      }
      
      if (element.parentElement) {
        element = element.parentElement;
      } else {
        break;
      }
    }
    
    // If we still don't have a result, use a more aggressive approach
    // Find the nearest line by its style or class
    element = (node instanceof Element) ? node : node.parentElement;
    
    // Shortcut for react-syntax-highlighter's block elements
    if (element && 
        element instanceof HTMLElement && 
        element.style && 
        element.style.display === 'block' && 
        element.parentElement && 
        element.parentElement.querySelector('[data-line-number]')) {
      
      // Find the index of this line element
      const linesContainer = element.parentElement;
      const lineElements = Array.from(linesContainer.children).filter(
        el => el instanceof HTMLElement && el.style && el.style.display === 'block'
      );
      
      const index = lineElements.indexOf(element);
      if (index !== -1) {
        return index + 1; // Convert to 1-based line numbers
      }
    }
    
    return null;
  }, [containerRef]);

  // Optimized text selection handler
  const handleSelectionChange = useCallback(() => {
    if (selectionMode === 'entire' || !containerRef.current) return;
    
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    
    try {
      // Get the range from the selection
      const range = selection.getRangeAt(0);
      
      // Try to get line numbers from DOM with optimized approach
      let startLine = getLineNumberFromNode(range.startContainer);
      let endLine = getLineNumberFromNode(range.endContainer);
      
      // Quick fallback if we couldn't get the lines via DOM
      if (!startLine || !endLine) {
        // Instead of the expensive newline counting approach, 
        // let's use a more direct approach to identify line elements
        const codeWrapper = containerRef.current.querySelector('.react-syntax-highlighter-line-numbers-rows');
        
        if (codeWrapper) {
          // Get all line elements
          const lineElements = Array.from(codeWrapper.children);
          const totalLines = lineElements.length;
          
          // Get the bounding rectangles for the selection and each line element
          const rangeRect = range.getBoundingClientRect();
          
          // Find the closest line to the start and end of the selection
          if (!startLine) {
            for (let i = 0; i < totalLines; i++) {
              const lineElement = lineElements[i] as Element;
              const lineRect = lineElement.getBoundingClientRect();
              if (rangeRect.top <= (lineRect.bottom + 5)) { // Some tolerance
                startLine = i + 1; // 1-based line numbering
                break;
              }
            }
          }
          
          if (!endLine) {
            for (let i = totalLines - 1; i >= 0; i--) {
              const lineElement = lineElements[i] as Element;
              const lineRect = lineElement.getBoundingClientRect();
              if (rangeRect.bottom >= (lineRect.top - 5)) { // Some tolerance
                endLine = i + 1; // 1-based line numbering
                break;
              }
            }
          }
        }
        
        // If we still don't have both line numbers, count the selected text's newlines
        if (!startLine || !endLine) {
          const selectedText = range.toString();
          const lineCount = (selectedText.match(/\n/g) || []).length + 1;
          
          // If we have at least one line number, estimate the other
          if (startLine && !endLine) {
            endLine = startLine + lineCount - 1;
          } else if (endLine && !startLine) {
            startLine = Math.max(1, endLine - lineCount + 1);
          } else {
            // Last resort: estimate both based on the container's scroll position
            if (containerRef.current) {
              const lineElements = containerRef.current.querySelectorAll('[data-line-number]');
              const avgLineHeight = lineElements.length > 0 
                ? (containerRef.current.scrollHeight / lineElements.length) 
                : 20; // Default approximation
              
              const scrollTop = containerRef.current.scrollTop;
              startLine = Math.max(1, Math.floor(scrollTop / avgLineHeight) + 1);
              endLine = startLine + lineCount - 1;
            } else {
              // Truly last resort
              startLine = 1;
              endLine = lineCount;
            }
          }
        }
      }
      
      // Make sure we have valid line numbers before updating state
      if (startLine && endLine) {
        // Don't log to console in production for performance
        if (process.env.NODE_ENV !== 'production') {
          console.log('Selection range:', { startLine, endLine });
        }
        
        setSelectedLines((prev: LineRange[]) => {
          // Create a new range from the selection
          const newRange = {
            start: Math.min(startLine!, endLine!), // Non-null assertion since we checked above
            end: Math.max(startLine!, endLine!)
          };
          
          // Merge with existing ranges efficiently
          return mergeLineRanges([...prev, newRange]);
        });
      }
    } catch (e) {
      console.error('Error handling text selection:', e);
    }
  }, [selectionMode, getLineNumberFromNode, mergeLineRanges]);

  // Handle line click for selection - simplified for better performance
  const handleLineClick = useCallback((lineNumber: number) => {
    if (selectionMode === 'entire') return;
    
    // If we're dragging, this will be handled by the drag handlers
    if (isDragging) return;
    
    setSelectedLines((prev: LineRange[]) => {
      // If shift key is pressed and we have a last selected line, select a range
      if (shiftKeyPressed && lastSelectedLine !== null) {
        const start = Math.min(lastSelectedLine, lineNumber);
        const end = Math.max(lastSelectedLine, lineNumber);
        
        // Add new range and merge with existing selections
        return mergeLineRanges([...prev, { start, end }]);
      } else {
        // Check if the line is already selected
        const isLineSelected = prev.some(range => 
          lineNumber >= range.start && lineNumber <= range.end
        );
        
        if (isLineSelected) {
          // For a simple single-click toggle, we'll just remove this exact line from selection
          // This is the simplest approach for single-click toggle
          
          // First, filter out any ranges that are exactly this single line
          let newRanges = prev.filter(range => 
            !(range.start === lineNumber && range.end === lineNumber)
          );
          
          // Then, split any ranges that contain this line
          newRanges = newRanges.flatMap(range => {
            // If the range doesn't contain this line, keep it unchanged
            if (lineNumber < range.start || lineNumber > range.end) {
              return [range];
            }
            
            // Create fragments that exclude the clicked line
            const fragments: LineRange[] = [];
            
            // Add range before the clicked line if it exists
            if (lineNumber > range.start) {
              fragments.push({ start: range.start, end: lineNumber - 1 });
            }
            
            // Add range after the clicked line if it exists
            if (lineNumber < range.end) {
              fragments.push({ start: lineNumber + 1, end: range.end });
            }
            
            return fragments;
          });
          
          return newRanges;
        } else {
          // Add the single line to selection
          return mergeLineRanges([...prev, { start: lineNumber, end: lineNumber }]);
        }
      }
    });
    
    // Update last selected line for shift+click functionality
    setLastSelectedLine(lineNumber);
  }, [selectionMode, shiftKeyPressed, lastSelectedLine, isDragging, mergeLineRanges]);
  
  // Calculate selected content from line ranges - performance optimized
  const getSelectedContent = useCallback((): string => {
    if (!file || !file.content) return '';
    
    // Fast paths for common cases
    if (selectionMode === 'entire' || selectedLines.length === 0) {
      return file.content;
    }
    
    // Memoize the split lines for better performance
    const lines = file.content.split('\n');
    const lineCount = lines.length;
    
    // For large selections, optimize the array operations
    if (selectedLines.length === 1) {
      // Fast path for the common case of a single range
      const range = selectedLines[0];
      // Ensure indices are within bounds
      const start = Math.max(0, range.start - 1);
      const end = Math.min(lineCount - 1, range.end - 1);
      
      if (start === 0 && end === lineCount - 1) {
        // Entire file is selected
        return file.content;
      }
      
      // Use slice for better performance on a single range
      return lines.slice(start, end + 1).join('\n');
    }
    
    // For multiple ranges, build the selected content efficiently
    // Pre-allocate array with approximate capacity
    const totalSelectedLines = selectedLines.reduce(
      (sum: number, range: LineRange) => sum + (range.end - range.start + 1), 0
    );
    const selectedContent: string[] = new Array(totalSelectedLines);
    
    let contentIndex = 0;
    for (const range of selectedLines) {
      // Ensure indices are within bounds
      const start = Math.max(0, range.start - 1);
      const end = Math.min(lineCount - 1, range.end - 1);
      
      for (let i = start; i <= end; i++) {
        selectedContent[contentIndex++] = lines[i];
      }
    }
    
    // Truncate any unused array elements and join
    return selectedContent.slice(0, contentIndex).join('\n');
  }, [file, selectedLines, selectionMode]);
  
  // Calculate token count from selected content - with memoization
  const calculateTokenCount = useCallback((content: string): number => {
    if (!content) return 0;
    
    // Fast path for short content
    if (content.length < 100) {
      return Math.ceil(content.length / 4);
    }
    
    // More accurate token estimation for longer content
    // Counting spaces gives a better approximation than fixed divisor
    const wordCount = content.split(/\s+/).length;
    const charCount = content.length;
    
    // Combine word and character metrics for a better estimation
    // GPT models typically use ~1.3 tokens per word
    // Adjust estimation based on special chars density
    const specialChars = content.replace(/[a-zA-Z0-9\s]/g, '').length;
    const specialCharRatio = specialChars / charCount;
    
    // Apply correction factor based on code characteristics
    return Math.ceil(wordCount * 1.3 * (1 + specialCharRatio));
  }, []);
  
  // Handle apply selection button
  const handleApplySelection = () => {
    if (!file) return;
    
    const selectedContent = getSelectedContent();
    const tokenCount = calculateTokenCount(selectedContent);
    
    // Update selected file with line ranges
    onUpdateSelectedFile({
      path: file.path,
      lines: selectionMode === 'specific' && selectedLines.length > 0 ? [...selectedLines] : undefined,
      content: selectedContent,
      tokenCount: tokenCount,
      isFullFile: selectionMode === 'entire'
    });
    
    onClose();
  };
  
  // Toggle selection mode
  const toggleSelectionMode = (mode: 'entire' | 'specific') => {
    setSelectionMode(mode);
    
    if (mode === 'entire') {
      // When switching to entire file mode, clear line selections and deactivate selection
      setSelectedLines([]);
      setIsSelectionActive(false);
    } else if (mode === 'specific') {
      // When entering specific line mode, automatically activate selection mode
      setIsSelectionActive(true);
      
      if (selectedFile && selectedFile.lines) {
        setSelectedLines([...selectedFile.lines]);
      }
    }
  };
  
  // Select all lines
  const selectAllLines = () => {
    if (!file || !file.content) return;
    
    const lineCount = file.content.split('\n').length;
    setSelectedLines([{ start: 1, end: lineCount }]);
  };
  
  // Clear selection
  const clearSelection = () => {
    setSelectedLines([]);
  };
  
  // Reset to initial selection
  const resetSelection = () => {
    setSelectedLines([...initialSelection]);
  };
  
  // Calculate if all lines are selected
  const isEntireFileSelected = (): boolean => {
    if (!file || !file.content) return false;
    if (selectionMode === 'entire') return true;
    if (selectedLines.length === 0) return false;
    
    const lineCount = file.content.split('\n').length;
    
    // Check if we have a single range that spans all lines
    return selectedLines.length === 1 && 
           selectedLines[0].start === 1 && 
           selectedLines[0].end === lineCount;
  };
  
  // We no longer need the renderLineNumber function as we're
  // using the built-in line numbering from SyntaxHighlighter
  
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content file-view-modal">
          <div className="file-view-modal-header">
            <Dialog.Title asChild>
              <h2>{file?.name || 'File Viewer'}</h2>
            </Dialog.Title>
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
                  checked={selectionMode === 'entire'}
                  onChange={() => toggleSelectionMode('entire')}
                />
                <span>Entire file</span>
              </label>
              <label>
                <input
                  type="radio"
                  checked={selectionMode === 'specific'}
                  onChange={() => toggleSelectionMode('specific')}
                />
                <span>Specific lines</span>
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
                {/* Only show Reset button if there was a previous selection */}
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
              {selectionMode === 'entire' ? (
                <span>Selecting entire file</span>
              ) : (
                <>
                  <span>Selection: {formatLineRanges(selectedLines)}</span>
                  {isEntireFileSelected() && (
                    <span className="file-view-modal-entire-file">(Entire File)</span>
                  )}
                </>
              )}
            </div>
            
            {selectionMode === 'specific' && selectedLines.length > 0 ? (
              <div className="token-estimate">
                ~{calculateTokenCount(getSelectedContent()).toLocaleString()} tokens selected / {totalTokenCount.toLocaleString()} total tokens
              </div>
            ) : (
              <div className="token-estimate">
                ~{totalTokenCount.toLocaleString()} total tokens
              </div>
            )}
          </div>
          
          <div 
            className={`file-view-modal-content ${selectionMode === 'specific' ? 'selection-active' : ''}`}
            ref={containerRef}
            onMouseUp={() => {
              // Handle text selection when mouse is released - no setTimeout for better responsiveness
              if (selectionMode === 'specific' && !isDragging) {
                handleSelectionChange();
              }
            }}
          >
            {file ? (
              <div 
                className="syntax-highlighter-wrapper"
              >
                {/* @ts-ignore - SyntaxHighlighter props typing issue */}
                <SyntaxHighlighter
                  language={getLanguageFromPath(file.path)}
                  style={currentTheme === 'dark' ? oneDark : oneLight}
                  showLineNumbers={true}
                  wrapLines={true}
                  lineProps={(lineNumber: number) => {
                    // Check if this line is part of a drag selection
                    const isDragSelected = isDragging && 
                      dragStartLine !== null && 
                      dragCurrentLine !== null && 
                      lineNumber >= Math.min(dragStartLine, dragCurrentLine) && 
                      lineNumber <= Math.max(dragStartLine, dragCurrentLine);
                    
                    // Check if line is selected (use memoized function)
                    const isSelected = isLineSelected(lineNumber);
                    
                    // Background color based on selection state
                    const bgColor = isSelected || isDragSelected
                      ? (currentTheme === 'dark' ? 'rgba(62, 68, 82, 0.5)' : 'rgba(230, 242, 255, 0.5)')
                      : undefined;
                    
                    return {
                      style: { 
                        display: 'block',
                        cursor: selectionMode === 'specific' ? 'pointer' : 'default',
                        backgroundColor: bgColor,
                      },
                      onClick: () => handleLineClick(lineNumber),
                      onMouseDown: (e: any) => {
                        if (selectionMode === 'specific') {
                          handleMouseDown(lineNumber, e);
                        }
                      },
                      onMouseMove: () => {
                        if (isDragging) {
                          handleMouseMove(lineNumber);
                        }
                      },
                      // Add data attribute to help identify line numbers
                      'data-line-number': lineNumber
                    };
                  }}
                  lineNumberStyle={(lineNumber: number) => {
                    // Check for selection and drag states (same as above)
                    const isDragSelected = isDragging && 
                      dragStartLine !== null && 
                      dragCurrentLine !== null && 
                      lineNumber >= Math.min(dragStartLine, dragCurrentLine) && 
                      lineNumber <= Math.max(dragStartLine, dragCurrentLine);
                      
                    const isSelected = isLineSelected(lineNumber);
                    
                    // Color based on selection
                    const textColor = isSelected || isDragSelected
                      ? (currentTheme === 'dark' ? '#61afef' : '#0366d6') 
                      : (currentTheme === 'dark' ? '#636d83' : '#999');
                    
                    // Background color based on selection
                    const bgColor = isSelected || isDragSelected
                      ? (currentTheme === 'dark' ? 'rgba(62, 68, 82, 0.8)' : 'rgba(230, 242, 255, 0.8)')
                      : undefined;
                    
                    return {
                      minWidth: '3em',
                      paddingRight: '1em',
                      textAlign: 'right',
                      userSelect: 'none',
                      cursor: selectionMode === 'specific' ? 'pointer' : 'default',
                      color: textColor,
                      backgroundColor: bgColor,
                      // Add handlers for line number selection with improved event handling
                      onClick: (e: any) => {
                        // Handle line number clicks directly for better responsiveness
                        e.preventDefault();
                        e.stopPropagation();
                        if (selectionMode === 'specific') {
                          handleLineClick(lineNumber);
                        }
                      },
                      onMouseDown: (e: any) => {
                        // Only handle mouse down for drag operations
                        e.preventDefault(); // Prevent default to avoid text selection
                        e.stopPropagation(); // Stop propagation to prevent unintended interactions
                        if (selectionMode === 'specific') {
                          handleMouseDown(lineNumber, e);
                        }
                      },
                      onMouseMove: () => {
                        if (isDragging) {
                          handleMouseMove(lineNumber);
                        }
                      },
                    };
                  }}
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
            ) : (
              <div className="file-view-modal-loading">Loading file...</div>
            )}
          </div>
          
          <div className="file-view-modal-footer">
            <div className="selection-help">
              {selectionMode === 'specific' && (
                <span>
                  Click to select a line. Shift+click to select ranges. Click line numbers and drag to select multiple lines.
                  Text selection is also supported - just select text with your mouse. Click selected lines to deselect.
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
                onClick={handleApplySelection}
                title="Apply Selection"
              >
                Apply
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default FileViewModal;