# File Content Flicker Investigation Report

## Executive Summary

This report documents a deep dive investigation into the file content flicker issue in PasteFlow, where clicking on a file in the file tree causes the content area to briefly display previous content before showing the current file's content.

**Root Cause**: The flicker is caused by a lack of synchronization between two separate state arrays (`selectedFiles` and `allFiles`), leading to stale data being displayed during the transition between files.

## Issue Description

When a user clicks on a file in the file tree to view its content:
1. The content area briefly shows the previous file's content
2. After a split second, it updates to show the correct content
3. This creates a jarring "flicker" effect that degrades the user experience

## Technical Investigation

### State Management Architecture

PasteFlow uses a dual-state architecture for managing files:

1. **`allFiles`**: Master list of all files in the workspace with their metadata
2. **`selectedFiles`**: List of files selected by the user for copying/viewing

These two arrays are managed by separate hooks:
- `useAppState` manages `allFiles`
- `useFileSelectionState` manages `selectedFiles`

### The Complete Flow

#### 1. File Selection (Click Event)
```typescript
// tree-item.tsx:508-515
const debouncedToggleFileSelection = useCallback(
  debounce((filePath: string) => {
    toggleFileSelection(filePath);
    if (!file.isContentLoaded && !file.isBinary) {
      loadFileContent(filePath);
    }
  }, 100),
  [toggleFileSelection, loadFileContent, file.isContentLoaded, file.isBinary]
);
```

#### 2. State Update in selectedFiles
```typescript
// use-file-selection-state.ts:84-112
const toggleFileSelection = (filePath: string) => {
  setSelectedFiles(prev => {
    // Creates a copy of file data from allFiles at selection time
    const newFile: SelectedFileWithLines = {
      path: file.path,
      content: file.content,
      tokenCount: file.tokenCount,
      isContentLoaded: file.isContentLoaded,
      // ... other properties
    };
    return [...prev, newFile];
  });
};
```

#### 3. Content Loading Process
```typescript
// use-app-state.ts:630-681
const loadFileContent = async (filePath: string) => {
  // Updates allFiles with loading state
  setAllFiles(prev => /* mark as loading */);
  
  // Fetch content from backend/cache
  const content = await requestFileContent(filePath);
  
  // Updates ONLY allFiles with new content
  setAllFiles(prev => /* update with content */);
  
  // selectedFiles is NOT updated here!
};
```

#### 4. Rendering Pipeline
```typescript
// file-list.tsx:40-92
// Attempts to merge data from both sources at render time
const expandedCards = selectedFiles.map(selectedFile => {
  const file = filesMap.get(selectedFile.path);
  return {
    ...selectedFile,
    isContentLoaded: file?.isContentLoaded || false,
    tokenCount: file?.tokenCount || selectedFile.tokenCount
  };
});
```

### Identified Issues

#### Primary Issue: State Desynchronization
The core problem is that `selectedFiles` and `allFiles` become desynchronized:

1. **Selection Time**: When a file is selected, `selectedFiles` gets a snapshot of the file's current state
2. **Content Loading**: When content is loaded, only `allFiles` is updated
3. **Stale Data**: `selectedFiles` retains the old state (empty content, no tokens)
4. **UI Confusion**: The UI tries to reconcile data from both sources, showing intermediate states

#### Secondary Issues

1. **Debounced Selection (100ms)**
   - The debounce delay can cause the UI to show stale state briefly
   - Multiple rapid clicks can queue up state changes

2. **Multiple Re-renders**
   - Selection change → render with old content
   - Loading state → render with loading indicator
   - Content loaded → render with new content
   - Token count → final render

3. **FileCard Double-Loading**
   ```typescript
   // file-card.tsx:29-35
   useEffect(() => {
     if (!isContentLoaded && !error && !file.isBinary) {
       loadFileContent(filePath);
     }
   }, [filePath, isContentLoaded, error, loadFileContent, file.isBinary]);
   ```
   - Can trigger duplicate content loads
   - Causes additional re-renders

4. **Race Conditions**
   - Concurrent file selections can interleave state updates
   - Cache updates before state can cause inconsistencies

### Visual Flow of the Flicker

```
Time →
T0: User clicks File B (currently viewing File A)
T1: selectedFiles updated with File B (no content)
T2: UI renders File B card with empty content
T3: FileCard effect triggers loadFileContent
T4: allFiles updated with loading state
T5: UI shows loading indicator
T6: Content fetched from backend/cache
T7: allFiles updated with content
T8: FileList merges data from both sources
T9: UI finally shows File B content

Between T2-T9, user sees flicker/empty content
```

### Caching Analysis

The caching system (`enhanced-file-cache.ts`) is well-implemented but doesn't prevent the flicker because:
- Cache is checked during content loading
- But the UI has already rendered with stale/empty data
- Even instant cache hits can't prevent the initial render with wrong data

## Recommendations

### Short-term Fixes

1. **Synchronize selectedFiles on Content Load**
   - When `loadFileContent` updates `allFiles`, also update the corresponding entry in `selectedFiles`
   - This ensures both states have the same content

2. **Pre-load Content on Hover**
   - Load file content when user hovers over a file
   - Reduces the chance of showing empty content

3. **Add Loading State to FileCard**
   - Show a loading spinner instead of empty/stale content
   - Prevents the jarring content switch

### Long-term Solutions

1. **Single Source of Truth**
   - Refactor to use only `allFiles` as the source of truth
   - Make `selectedFiles` just an array of file paths
   - Derive selected file data from `allFiles` at render time

2. **State Machine for File Selection**
   - Implement proper state transitions (idle → selecting → loading → loaded)
   - Prevent intermediate states from being rendered

3. **Optimistic Updates**
   - When selecting a file with cached content, update both states immediately
   - Only show loading state for uncached files

## Impact Assessment

- **Severity**: Medium - Affects user experience but doesn't break functionality
- **Frequency**: High - Occurs on every file selection
- **User Impact**: Creates perception of sluggish/buggy interface
- **Performance**: No significant performance impact, purely visual

## Conclusion

The file content flicker is caused by architectural decisions around state management, specifically the use of two separate, unsynchronized state arrays. While the current architecture works functionally, it creates opportunities for visual inconsistencies during state transitions.

The recommended approach is to implement the short-term fixes immediately to improve user experience, then plan a refactor to use a single source of truth for file data, which would eliminate this class of issues entirely.