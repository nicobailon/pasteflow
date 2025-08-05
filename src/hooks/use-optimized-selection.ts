import { useCallback, useMemo, useState } from 'react';

import { LineRange } from '../types/file-types';

interface OptimizedSelectionHook {
  selectedLines: LineRange[];
  selectedLinesSet: Set<number>;
  selectLine: (lineNumber: number) => void;
  selectRange: (start: number, end: number) => void;
  toggleLine: (lineNumber: number) => void;
  isLineSelected: (lineNumber: number) => boolean;
  clearSelection: () => void;
  setSelectedLines: (lines: LineRange[]) => void;
  mergeLineRanges: (ranges: LineRange[]) => LineRange[];
  getSelectedLinesCount: () => number;
}

export const useOptimizedSelection = (initialSelection: LineRange[] = []): OptimizedSelectionHook => {
  const [selectedLines, setSelectedLinesState] = useState<LineRange[]>(initialSelection);
  
  const selectedLinesSet = useMemo(() => {
    const set = new Set<number>();
    for (const range of selectedLines) {
      for (let i = range.start; i <= range.end; i++) {
        set.add(i);
      }
    }
    return set;
  }, [selectedLines]);
  
  const isLineSelected = useCallback((lineNumber: number): boolean => {
    return selectedLinesSet.has(lineNumber);
  }, [selectedLinesSet]);
  
  const mergeLineRanges = useCallback((ranges: LineRange[]): LineRange[] => {
    if (ranges.length === 0) return [];
    if (ranges.length === 1) return [{ ...ranges[0] }];
    
    const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);
    const mergedRanges: LineRange[] = [];
    let currentRange: LineRange = { ...sortedRanges[0] };
    
    for (let i = 1; i < sortedRanges.length; i++) {
      const nextRange = sortedRanges[i];
      
      if (nextRange.start <= currentRange.end + 1) {
        if (nextRange.end > currentRange.end) {
          currentRange.end = nextRange.end;
        }
      } else {
        mergedRanges.push(currentRange);
        currentRange = { ...nextRange };
      }
    }
    
    mergedRanges.push(currentRange);
    return mergedRanges;
  }, []);
  
  const selectLine = useCallback((lineNumber: number) => {
    setSelectedLinesState(prev => 
      mergeLineRanges([...prev, { start: lineNumber, end: lineNumber }])
    );
  }, [mergeLineRanges]);
  
  const selectRange = useCallback((start: number, end: number) => {
    setSelectedLinesState(prev => 
      mergeLineRanges([...prev, { start: Math.min(start, end), end: Math.max(start, end) }])
    );
  }, [mergeLineRanges]);
  
  const toggleLine = useCallback((lineNumber: number) => {
    setSelectedLinesState(prev => {
      const isCurrentlySelected = selectedLinesSet.has(lineNumber);
      
      if (isCurrentlySelected) {
        const filteredRanges = prev.filter(range => 
          !(range.start === lineNumber && range.end === lineNumber)
        );
        
        return filteredRanges.flatMap(range => {
          if (lineNumber < range.start || lineNumber > range.end) {
            return [range];
          }
          
          const fragments: LineRange[] = [];
          
          if (lineNumber > range.start) {
            fragments.push({ start: range.start, end: lineNumber - 1 });
          }
          
          if (lineNumber < range.end) {
            fragments.push({ start: lineNumber + 1, end: range.end });
          }
          
          return fragments;
        });
      } else {
        return mergeLineRanges([...prev, { start: lineNumber, end: lineNumber }]);
      }
    });
  }, [selectedLinesSet, mergeLineRanges]);
  
  const clearSelection = useCallback(() => {
    setSelectedLinesState([]);
  }, []);
  
  const setSelectedLines = useCallback((lines: LineRange[]) => {
    setSelectedLinesState(lines);
  }, []);
  
  const getSelectedLinesCount = useCallback(() => {
    return selectedLinesSet.size;
  }, [selectedLinesSet]);
  
  return {
    selectedLines,
    selectedLinesSet,
    selectLine,
    selectRange,
    toggleLine,
    isLineSelected,
    clearSelection,
    setSelectedLines,
    mergeLineRanges,
    getSelectedLinesCount,
  };
};