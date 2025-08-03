import * as Dialog from '@radix-ui/react-dialog';
import { CheckSquare, Square, Trash, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { useTheme } from '../context/theme-context';
import { FileData, FileViewModalProps, LineRange } from '../types/file-types';
import { useCancellableOperation } from '../hooks/use-cancellable-operation';
import { TOKEN_COUNTING, UI } from '../constants/app-constants';
import './file-view-modal.css';

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
  loadFileContent,
}: FileViewModalProps): JSX.Element => {
  const { currentTheme } = useTheme();
  const { runCancellableOperation } = useCancellableOperation();
  const [file, setFile] = useState<FileData | null>(null);
  const [selectedLines, setSelectedLines] = useState<LineRange[]>([]);
  const [initialSelection, setInitialSelection] = useState<LineRange[]>([]);
  const [selectionMode, setSelectionMode] = useState<'none'|'entire'|'specific'>('none');
  const [shiftKeyPressed, setShiftKeyPressed] = useState(false);
  const [lastSelectedLine, setLastSelectedLine] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track total token count
  const [totalTokenCount, setTotalTokenCount] = useState(0);
  
  // Track mouse state for drag selection
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartLine, setDragStartLine] = useState<number | null>(null);
  const [dragCurrentLine, setDragCurrentLine] = useState<number | null>(null);
  
  // Calculate token count from selected content - with memoization
  const calculateTokenCount = useCallback((content: string): number => {
    if (!content) return 0;
    
    // Fast path for short content
    if (content.length < TOKEN_COUNTING.SMALL_CONTENT_THRESHOLD) {
      return Math.ceil(content.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
    }
    
    // More accurate token estimation for longer content
    // Counting spaces gives a better approximation than fixed divisor
    const wordCount = content.split(/\s+/).length;
    const charCount = content.length;
    
    // Combine word and character metrics for a better estimation
    // GPT models typically use centralized ratio tokens per word
    // Adjust estimation based on special chars density
    const specialChars = content.replace(/[\d\sA-Za-z]/g, '').length;
    const specialCharRatio = specialChars / charCount;
    
    // Apply correction factor based on code characteristics
    return Math.ceil(wordCount * TOKEN_COUNTING.WORD_TO_TOKEN_RATIO * (1 + specialCharRatio));
  }, []);
  
  // Find the file in allFiles when filePath changes and load content if needed
  useEffect(() => {
    if (filePath && isOpen) {
      runCancellableOperation(async (token) => {
        const foundFile = allFiles.find((file: FileData) => file.path === filePath);
        
        if (token.cancelled) return;
        
        if (foundFile && !foundFile.isContentLoaded) {
          // Set the file immediately so we show the loading state
          setFile(foundFile);
          
          // Load content asynchronously
          await loadFileContent(filePath);
          
          // Check if cancelled after async operation
          if (token.cancelled) return;
        } else {
          // No action needed for other cases
          setFile(foundFile ?? null);
          setTotalTokenCount(foundFile?.content ? calculateTokenCount(foundFile.content) : 0);
        }
      });
    }
  }, [filePath, isOpen, allFiles, calculateTokenCount, loadFileContent, runCancellableOperation]);

  // Separate effect to update file state when allFiles changes (after content is loaded)
  useEffect(() => {
    if (filePath && isOpen && file) {
      const updatedFile = allFiles.find((f: FileData) => f.path === filePath);
      if (updatedFile && updatedFile.isContentLoaded && updatedFile.content && updatedFile.content !== file.content) {
        setFile(updatedFile);
        setTotalTokenCount(calculateTokenCount(updatedFile.content));
      }
    }
  }, [allFiles, filePath, isOpen, file, calculateTokenCount]);
  
  // Initialize selected lines based on the selectedFile prop
  useEffect(() => {
    // Always default to view-only mode when opening the modal
    setSelectionMode('none');
    setIsDragging(false);
    
    // Store the current selection state for potential use
    if (selectedFile && selectedFile.lines && selectedFile.lines.length > 0) {
      // Store specific line selection for if user switches to specific mode
      setSelectedLines([...selectedFile.lines]);
      setInitialSelection([...selectedFile.lines]);
    } else {
      // No previous line selection
      setSelectedLines([]);
      setInitialSelection([]);
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
    if (selectedLines.length <= UI.MODAL.BINARY_SEARCH_THRESHOLD) {
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
    const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);
    
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
  
  // Get line number from element's data attribute
  const getLineNumberFromEventElement = useCallback((element: Element): number | null => {
    const lineAttr = element.dataset.lineNumber;
    if (!lineAttr) return null;
    
    const lineNumber = Number.parseInt(lineAttr, 10);
    return Number.isNaN(lineNumber) ? null : lineNumber;
  }, []);
  
  // Check if element has direct line number attribute
  const getLineNumberFromElement = useCallback((node: Node): number | null => {
    if (!(node instanceof Element)) return null;
    
    const lineAttr = node.dataset.lineNumber;
    if (!lineAttr) return null;
    
    return Number.parseInt(lineAttr, 10);
  }, []);
  
  // Find line number from ancestor elements
  const getLineNumberFromAncestor = useCallback((node: Node): number | null => {
    if (!containerRef.current) return null;
    
    let element = (node instanceof Element) ? node : node.parentElement;
    if (!element) return null;
    
    const MAX_DEPTH = UI.MODAL.MAX_DOM_DEPTH;
    let depth = 0;
    
    while (element && element !== containerRef.current && depth < MAX_DEPTH) {
      const lineAttr = element.dataset.lineNumber;
      if (lineAttr) {
        return Number.parseInt(lineAttr, 10);
      }
      
      if (!element.parentElement) break;
      element = element.parentElement;
      depth++;
    }
    
    return null;
  }, [containerRef]);
  
  // Find line number from nearest syntax highlighter line
  const getLineNumberFromNearestLine = useCallback((node: Node): number | null => {
    if (!containerRef.current) return null;
    
    const element = (node instanceof Element) ? node : node.parentElement;
    if (!element) return null;
    
    // Shortcut for react-syntax-highlighter's block elements
    if (!(element instanceof HTMLElement) || 
        !element.style || 
        element.style.display !== 'block' || 
        !element.parentElement) {
      return null;
    }
    
    const linesContainer = element.parentElement;
    const lineWithNumber = linesContainer.querySelector('[data-line-number]');
    if (!lineWithNumber) return null;
    
    // Find the index of this line element
    const lineElements = [...linesContainer.children].filter(
      el => el instanceof HTMLElement && el.style && el.style.display === 'block'
    );
    
    const index = lineElements.indexOf(element);
    if (index === -1) return null;
    
    return index + 1; // Convert to 1-based line numbers
  }, [containerRef]);
  
  // Helper function to get line numbers from DOM nodes - optimized
  const getLineNumberFromNode = useCallback((node: Node): number | null => {
    if (!node || !containerRef.current) return null;
    
    // Try direct line number access
    return (
      getLineNumberFromElement(node) || 
      getLineNumberFromAncestor(node) ||
      getLineNumberFromNearestLine(node)
    );
  }, [containerRef, getLineNumberFromElement, getLineNumberFromAncestor, getLineNumberFromNearestLine]);
  
  // Check if mouse position is outside container bounds
  const isOutsideBounds = useCallback((e: MouseEvent, bounds: DOMRect): boolean => {
    return (
      e.clientY < bounds.top || 
      e.clientY > bounds.top + bounds.height || 
      e.clientX < bounds.left || 
      e.clientX > bounds.left + bounds.width
    );
  }, []);
  
  // Get line number from parent elements
  const getLineNumberFromParents = useCallback((element: Element): number | null => {
    if (!containerRef.current) return null;
    
    let current = element;
    let traversalDepth = 0;
    const MAX_DEPTH = UI.MODAL.MAX_DOM_DEPTH;
    
    while (current && current !== containerRef.current && traversalDepth < MAX_DEPTH) {
      traversalDepth++;
      
      const lineNumber = getLineNumberFromEventElement(current);
      if (lineNumber) return lineNumber;
      
      const nextNode = current.parentElement || (current.parentNode instanceof Element ? current.parentNode : null);
      if (!nextNode) break;
      current = nextNode;
    }
    
    return null;
  }, [containerRef, getLineNumberFromEventElement]);
  
  // Find line number from mouse event
  const findLineNumberFromEvent = useCallback((e: MouseEvent): number | null => {
    // Try to get the element under the cursor
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    if (elementUnderCursor === null) return null;
    
    // Try direct line number check
    const lineNumber = getLineNumberFromEventElement(elementUnderCursor);
    if (lineNumber) return lineNumber;
    
    // Try parent traversal
    return getLineNumberFromParents(elementUnderCursor);
  }, [getLineNumberFromEventElement, getLineNumberFromParents]);
  
  // Get container information for drag operations
  const getContainerInfo = useCallback(() => {
    const info = {
      containerBounds: null as DOMRect | null,
      avgLineHeight: 0,
      lineCount: 0,
      lineElements: null as NodeListOf<Element> | null
    };
    
    if (!containerRef.current) return info;
    
    info.containerBounds = containerRef.current.getBoundingClientRect();
    info.lineElements = containerRef.current.querySelectorAll('[data-line-number]');
    
    if (info.lineElements && info.lineElements.length > 0) {
      info.avgLineHeight = containerRef.current.scrollHeight / info.lineElements.length;
    }
    
    if (file && file.content) {
      info.lineCount = file.content.split('\n').length;
    }
    
    return info;
  }, [containerRef, file]);
  
  // Handle mouse move during drag operation
  const handleDragMouseMove = useCallback((
    e: MouseEvent, 
    info: {
      containerBounds: DOMRect | null;
      avgLineHeight: number;
      lineCount: number;
      lineElements: NodeListOf<Element> | null;
    }
  ) => {
    const { containerBounds, avgLineHeight, lineCount } = info;
    
    if (!containerRef.current || !containerBounds) return;
    
    // Check if mouse is outside container bounds
    if (isOutsideBounds(e, containerBounds)) return;
    
    // Try to find line by element
    const lineNumber = findLineNumberFromEvent(e);
    if (lineNumber) {
      handleMouseMove(lineNumber);
      return;
    }
    
    // Use position-based estimation as fallback
    if (avgLineHeight > 0 && lineCount > 0) {
      const relativeY = e.clientY - containerBounds.top;
      const lineIndex = Math.floor(relativeY / avgLineHeight);
      const estimatedLineNumber = Math.max(1, Math.min(lineCount, lineIndex + 1));
      handleMouseMove(estimatedLineNumber);
    }
  }, [containerRef, handleMouseMove, isOutsideBounds, findLineNumberFromEvent]);
  
  // Set up drag handlers with all the necessary logic
  const setupDragHandlers = useCallback(() => {
    // Pre-calculate container bounds and line heights once
    const containerInfo = getContainerInfo();
    
    // Define the event handlers
    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleDragMouseMove(e, containerInfo);
    };
    
    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };
    
    // Attach event listeners
    window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    // Return cleanup function
    return {
      cleanup: () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      }
    };
  }, [handleMouseUp, getContainerInfo, handleDragMouseMove]);
  
  // Set up mouse move and up listeners for drag selection - optimized
  useEffect(() => {
    if (!isDragging) return;

    // Set up drag handlers
    const { cleanup } = setupDragHandlers();
    
    return cleanup;
  }, [isDragging, setupDragHandlers]);
  
  // Find the start line in the code wrapper
  const findStartLineInWrapper = useCallback((range: Range, codeWrapper: Element): number | null => {
    // Get all line elements
    const lineElements = [...codeWrapper.children];
    const totalLines = lineElements.length;
    
    // Get the bounding rectangle for the selection
    const rangeRect = range.getBoundingClientRect();
    
    // Find the closest line to the start of the selection
    for (let i = 0; i < totalLines; i++) {
      const lineElement = lineElements[i] as Element;
      const lineRect = lineElement.getBoundingClientRect();
      if (rangeRect.top <= (lineRect.bottom + 5)) { // Some tolerance
        return i + 1; // 1-based line numbering
      }
    }
    
    return null;
  }, []);
  
  // Find the end line in the code wrapper
  const findEndLineInWrapper = useCallback((range: Range, codeWrapper: Element): number | null => {
    // Get all line elements
    const lineElements = [...codeWrapper.children];
    const totalLines = lineElements.length;
    
    // Get the bounding rectangle for the selection
    const rangeRect = range.getBoundingClientRect();
    
    // Find the closest line to the end of the selection
    for (let i = totalLines - 1; i >= 0; i--) {
      const lineElement = lineElements[i] as Element;
      const lineRect = lineElement.getBoundingClientRect();
      if (rangeRect.bottom >= (lineRect.top - 5)) { // Some tolerance
        return i + 1; // 1-based line numbering
      }
    }
    
    return null;
  }, []);
  
  // Helper for finding line numbers from code wrapper
  const getLineNumbersFromCodeWrapper = useCallback((range: Range): {startLine: number | null; endLine: number | null} => {
    if (!containerRef.current) return { startLine: null, endLine: null };
    
    const codeWrapper = containerRef.current.querySelector('.react-syntax-highlighter-line-numbers-rows');
    if (!codeWrapper) return { startLine: null, endLine: null };
    
    return {
      startLine: findStartLineInWrapper(range, codeWrapper),
      endLine: findEndLineInWrapper(range, codeWrapper)
    };
  }, [containerRef, findStartLineInWrapper, findEndLineInWrapper]);
  
  // Calculate average line height
  const calculateAverageLineHeight = useCallback((lineElements: NodeListOf<Element>, container: HTMLDivElement): number => {
    return lineElements.length > 0 
      ? (container.scrollHeight / lineElements.length) 
      : 20; // Default approximation
  }, []);
  
  // Helper for estimating line numbers from scroll position
  const estimateLineNumbersFromScroll = useCallback((lineCount: number): {startLine: number | null; endLine: number | null} => {
    if (!containerRef.current) return { startLine: null, endLine: null };
    
    const lineElements = containerRef.current.querySelectorAll('[data-line-number]');
    const avgLineHeight = calculateAverageLineHeight(lineElements, containerRef.current);
    
    const scrollTop = containerRef.current.scrollTop;
    const startLine = Math.max(1, Math.floor(scrollTop / avgLineHeight) + 1);
    const endLine = startLine + lineCount - 1;
    
    return { startLine, endLine };
  }, [containerRef, calculateAverageLineHeight]);
  
  // Helper for estimating line numbers from text content
  const estimateLineNumbersFromText = useCallback((
    range: Range, 
    existingStartLine: number | null, 
    existingEndLine: number | null
  ): {startLine: number | null; endLine: number | null} => {
    const selectedText = range.toString();
    const lineCount = (selectedText.match(/\n/g) || []).length + 1;
    
    // Case 1: Only have start line
    if (existingStartLine && !existingEndLine) {
      return { 
        startLine: existingStartLine, 
        endLine: existingStartLine + lineCount - 1 
      };
    } 
    
    // Case 2: Only have end line
    if (!existingStartLine && existingEndLine) {
      return { 
        startLine: Math.max(1, existingEndLine - lineCount + 1), 
        endLine: existingEndLine 
      };
    }
    
    // Case 3: Use scroll position
    if (containerRef.current) {
      return estimateLineNumbersFromScroll(lineCount);
    }
    
    // Case 4: Fallback
    return { startLine: 1, endLine: lineCount };
  }, [containerRef, estimateLineNumbersFromScroll]);
  
  // Helper function to get line numbers from a range
  const getLineNumbersFromRange = useCallback((range: Range): {startLine: number | null; endLine: number | null} => {
    // Step 1: Try DOM node approach
    const startLine = getLineNumberFromNode(range.startContainer);
    const endLine = getLineNumberFromNode(range.endContainer);
    
    // Check if we have both lines
    if (startLine && endLine) {
      return { startLine, endLine };
    }
    
    // Step 2: Try code wrapper approach
    const wrapperResult = getLineNumbersFromCodeWrapper(range);
    if (wrapperResult.startLine && wrapperResult.endLine) {
      return wrapperResult;
    }
    
    // Step 3: Combine what we have or use text approach
    const finalStartLine = startLine || wrapperResult.startLine;
    const finalEndLine = endLine || wrapperResult.endLine;
    
    // If still missing one or both, estimate from text
    if (!finalStartLine || !finalEndLine) {
      return estimateLineNumbersFromText(range, finalStartLine, finalEndLine);
    }
    
    return { startLine: finalStartLine, endLine: finalEndLine };
  }, [getLineNumberFromNode, getLineNumbersFromCodeWrapper, estimateLineNumbersFromText]);
  
  // Helper to add a line range to the selection
  const addLineRangeToSelection = useCallback((startLine: number, endLine: number) => {
    setSelectedLines((prev: LineRange[]) => {
      // Create a new range from the selection
      const newRange = {
        start: Math.min(startLine, endLine),
        end: Math.max(startLine, endLine)
      };
      
      // Merge with existing ranges efficiently
      return mergeLineRanges([...prev, newRange]);
    });
  }, [mergeLineRanges]);

  // Process valid line numbers from selection
  const processValidLineNumbers = useCallback((lineNumbers: {startLine: number | null; endLine: number | null}) => {
    if (!lineNumbers.startLine || !lineNumbers.endLine) return;
    
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    }
    
    addLineRangeToSelection(lineNumbers.startLine, lineNumbers.endLine);
  }, [addLineRangeToSelection]);
  
  // Get selection range safely
  const getSelectionRange = useCallback((): Range | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    
    try {
      return selection.getRangeAt(0);
    } catch (error) {
      console.error('Error getting selection range:', error);
      return null;
    }
  }, []);

  // Optimized text selection handler
  const handleSelectionChange = useCallback(() => {
    // Early exits for invalid conditions
    if (selectionMode === 'entire' || !containerRef.current) return;
    
    const range = getSelectionRange();
    if (!range) return;
    
    try {
      // Get line numbers from the range
      const lineNumbers = getLineNumbersFromRange(range);
      
      // Process line numbers if valid
      processValidLineNumbers(lineNumbers);
    } catch (error) {
      console.error('Error handling text selection:', error);
    }
  }, [selectionMode, containerRef, getSelectionRange, getLineNumbersFromRange, processValidLineNumbers]);
  
  // Check if a specific line is within any of the ranges
  const isLineInRanges = useCallback((lineNumber: number, ranges: LineRange[]): boolean => {
    return ranges.some(range => 
      lineNumber >= range.start && lineNumber <= range.end
    );
  }, []);
  
  // Add a single line to the range collection
  const addLineToRanges = useCallback((lineNumber: number, ranges: LineRange[]): LineRange[] => {
    return mergeLineRanges([...ranges, { start: lineNumber, end: lineNumber }]);
  }, [mergeLineRanges]);
  
  // Remove a line from all ranges, splitting ranges if needed
  const removeLineFromRanges = useCallback((lineNumber: number, ranges: LineRange[]): LineRange[] => {
    // First, filter out any ranges that are exactly this single line
    const filteredRanges = ranges.filter(range => 
      !(range.start === lineNumber && range.end === lineNumber)
    );
    
    // Then, split any ranges that contain this line
    return filteredRanges.flatMap(range => {
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
  }, []);
  
  // Toggle a single line's selection state
  const toggleLineSelection = useCallback((lineNumber: number) => {
    setSelectedLines((prev: LineRange[]) => {
      const isCurrentlySelected = isLineInRanges(lineNumber, prev);
      
      return isCurrentlySelected 
        ? removeLineFromRanges(lineNumber, prev)
        : addLineToRanges(lineNumber, prev);
    });
  }, [isLineInRanges, removeLineFromRanges, addLineToRanges]);
  
  // Handle shift+click selection
  const handleShiftClick = useCallback((lineNumber: number) => {
    if (lastSelectedLine === null) return;
    
    setSelectedLines((prev: LineRange[]) => {
      const start = Math.min(lastSelectedLine, lineNumber);
      const end = Math.max(lastSelectedLine, lineNumber);
      
      // Add new range and merge with existing selections
      return mergeLineRanges([...prev, { start, end }]);
    });
  }, [lastSelectedLine, mergeLineRanges]);

  // Handle line click for selection - simplified for better performance
  const handleLineClick = useCallback((lineNumber: number) => {
    if (selectionMode === 'entire' || isDragging) return;
    
    if (shiftKeyPressed && lastSelectedLine !== null) {
      handleShiftClick(lineNumber);
    } else {
      toggleLineSelection(lineNumber);
    }
    
    // Update last selected line for shift+click functionality
    setLastSelectedLine(lineNumber);
  }, [selectionMode, shiftKeyPressed, lastSelectedLine, isDragging, handleShiftClick, toggleLineSelection]);
  
  // Get content for a single range
  const getContentForSingleRange = useCallback((lines: string[], range: LineRange): string => {
    const lineCount = lines.length;
    
    // Ensure indices are within bounds
    const start = Math.max(0, range.start - 1);
    const end = Math.min(lineCount - 1, range.end - 1);
    
    if (start === 0 && end === lineCount - 1) {
      // Entire file is selected - return original content
      return file?.content || '';
    }
    
    // Use slice for better performance on a single range
    return lines.slice(start, end + 1).join('\n');
  }, [file]);
  
  // Get content for multiple ranges
  const getContentForMultipleRanges = useCallback((lines: string[], ranges: LineRange[]): string => {
    const lineCount = lines.length;
    const selectedContent: string[] = [];
    
    let contentIndex = 0;
    for (const range of ranges) {
      // Ensure indices are within bounds
      const start = Math.max(0, range.start - 1);
      const end = Math.min(lineCount - 1, range.end - 1);
      
      for (let i = start; i <= end; i++) {
        selectedContent[contentIndex++] = lines[i];
      }
    }
    
    // Truncate any unused array elements and join
    return selectedContent.slice(0, contentIndex).join('\n');
  }, []);

  // Calculate selected content from line ranges - performance optimized
  const getSelectedContent = useCallback((): string => {
    if (!file || !file.content) return '';
    
    // Fast paths for common cases
    if (selectionMode === 'entire' || selectedLines.length === 0) {
      return file.content;
    }
    
    // Memoize the split lines for better performance
    const lines = file.content.split('\n');
    
    // Determine which approach to use based on selection
    if (selectedLines.length === 1) {
      return getContentForSingleRange(lines, selectedLines[0]);
    }
    
    return getContentForMultipleRanges(lines, selectedLines);
  }, [file, selectedLines, selectionMode, getContentForSingleRange, getContentForMultipleRanges]);
  
  // Check if a line is part of the current drag selection
  const isLineDragSelected = useCallback((lineNumber: number): boolean => {
    if (!isDragging || dragStartLine === null || dragCurrentLine === null) {
      return false;
    }
    
    return lineNumber >= Math.min(dragStartLine, dragCurrentLine) && 
           lineNumber <= Math.max(dragStartLine, dragCurrentLine);
  }, [isDragging, dragStartLine, dragCurrentLine]);
  
  // Get the background color for selected lines
  const getLineBackgroundColor = useCallback((isHighlighted: boolean): string | undefined => {
    if (!isHighlighted) return undefined;
    
    return currentTheme === 'dark' 
      ? 'rgba(62, 68, 82, 0.5)' 
      : 'rgba(230, 242, 255, 0.5)';
  }, [currentTheme]);
  
  // Get the text color for line numbers
  const getLineNumberColor = useCallback((isHighlighted: boolean): string => {
    if (isHighlighted) {
      return currentTheme === 'dark' ? '#61afef' : '#0366d6';
    }
    
    return currentTheme === 'dark' ? '#636d83' : '#999';
  }, [currentTheme]);
  
  // Handle clicks on line numbers
  const handleLineNumberClick = useCallback((e: any, lineNumber: number) => {
    // Handle line number clicks directly for better responsiveness
    e.preventDefault();
    e.stopPropagation();
    if (selectionMode === 'specific') {
      handleLineClick(lineNumber);
    }
  }, [selectionMode, handleLineClick]);
  
  // Handle mouse down on line numbers
  const handleLineNumberMouseDown = useCallback((e: any, lineNumber: number) => {
    // Only handle mouse down for drag operations
    e.preventDefault(); // Prevent default to avoid text selection
    e.stopPropagation(); // Stop propagation to prevent unintended interactions
    if (selectionMode === 'specific') {
      handleMouseDown(lineNumber, e);
    }
  }, [selectionMode, handleMouseDown]);

  // Get props for each line in the syntax highlighter
  const getLineProps = useCallback((lineNumber: number) => {
    // Check if this line is selected
    const isSelected = isLineSelected(lineNumber);
    const isDragSelected = isLineDragSelected(lineNumber);
    
    return {
      style: { 
        display: 'block',
        cursor: selectionMode === 'specific' ? 'pointer' : 'default',
        backgroundColor: getLineBackgroundColor(isSelected || isDragSelected),
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
  }, [
    selectionMode, 
    isDragging, 
    isLineSelected,
    isLineDragSelected,
    getLineBackgroundColor,
    handleLineClick,
    handleMouseDown,
    handleMouseMove
  ]);
  
  // Get the styles for each line number in the syntax highlighter
  const getLineNumberStyle = useCallback((lineNumber: number) => {
    // Check selection status
    const isSelected = isLineSelected(lineNumber);
    const isDragSelected = isLineDragSelected(lineNumber);
    const isHighlighted = isSelected || isDragSelected;
    
    return {
      minWidth: '3em',
      paddingRight: '1em',
      textAlign: 'right' as const,
      userSelect: 'none' as const,
      cursor: selectionMode === 'specific' ? 'pointer' : 'default',
      color: getLineNumberColor(isHighlighted),
      backgroundColor: getLineBackgroundColor(isHighlighted),
      // Add handlers for line number selection
      onClick: (e: any) => handleLineNumberClick(e, lineNumber),
      onMouseDown: (e: any) => handleLineNumberMouseDown(e, lineNumber),
      onMouseMove: () => {
        if (isDragging) {
          handleMouseMove(lineNumber);
        }
      },
    };
  }, [
    selectionMode, 
    isDragging, 
    isLineSelected,
    isLineDragSelected,
    getLineNumberColor,
    getLineBackgroundColor,
    handleLineNumberClick,
    handleLineNumberMouseDown,
    handleMouseMove
  ]);
  
  // Toggle selection mode
  const toggleSelectionMode = (mode: 'none' | 'entire' | 'specific') => {
    setSelectionMode(mode);
    
    if (mode === 'none') {
      // View-only mode - clear all selections
      setSelectedLines([]);
      setIsDragging(false);
    } else if (mode === 'entire') {
      // When switching to entire file mode, clear line selections and deactivate selection
      setSelectedLines([]);
    } else if (mode === 'specific') {
      // When entering specific line mode, automatically activate selection mode
      setIsDragging(false);
      
      // Restore initial selection if available
      if (initialSelection.length > 0) {
        setSelectedLines([...initialSelection]);
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
  
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content file-view-modal" aria-describedby={undefined}>
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
              {selectionMode === 'none' ? (
                <span>Viewing file (no selection)</span>
              ) : selectionMode === 'entire' ? (
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
            role="presentation"
            aria-label="File content viewer"
          >
            {file ? (
              <div
                className="syntax-highlighter-wrapper"
              >
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
                  {file.content || ''}
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
                onClick={() => {
                  if (!file) return;
                  
                  if (selectionMode === 'none') {
                    // Just close without updating selection
                    onClose();
                    return;
                  }
                  
                  // Update selected file with line ranges
                  onUpdateSelectedFile(
                    file.path,
                    selectionMode === 'specific' && selectedLines.length > 0 ? [...selectedLines] : undefined
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