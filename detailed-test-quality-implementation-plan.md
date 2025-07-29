# Detailed Test Quality Implementation Plan - PasteFlow
**Generated:** 2025-07-26  
**Based on:** comprehensive-test-quality-code-review.md  
**Duration:** 8 weeks (2 months)  
**Effort:** 40-60 development hours  
**Target Score:** 6.8/10 → 9.0/10  

## Overview

This implementation plan systematically addresses all test quality violations identified in the comprehensive code review. The plan is structured in 4 phases with clear deliverables, success criteria, and risk mitigation strategies.

### Executive Summary of Issues to Resolve

| Priority | Issues | Files Affected | Hours Est. |
|----------|--------|----------------|-------------|
| **CRITICAL** | Skipped tests, Mock explosions | 2 files | 8-12 hours |
| **HIGH** | Assertion density, Implementation focus | 6 files | 16-20 hours |  
| **MEDIUM** | Edge cases, Integration gaps | 8 files | 12-16 hours |
| **INFRASTRUCTURE** | Automation, Templates | All files | 8-12 hours |

---

## PHASE 1: CRITICAL VIOLATIONS (Week 1)
**Duration:** 5 days  
**Effort:** 12-16 hours  
**Blocker Resolution:** All critical violations must be fixed before proceeding  

### Task 1.1: Remove Skipped Tests (IMMEDIATE - Day 1)
**Priority:** 🔴 CRITICAL  
**Files:** `src/__tests__/file-view-modal-test.tsx`  
**Estimated Time:** 2-3 hours  

#### Technical Steps:
```bash
# 1. Identify all skipped tests
git grep -n "\.skip\|\.todo" src/__tests__/

# 2. Expected findings in file-view-modal-test.tsx:
# Lines 132-160: it.skip('should handle long line selections in large files')
# Lines 174-198: it.skip('should display loading state during content fetch')  
# Lines 248-265: it.skip('should handle keyboard navigation')
```

#### Implementation Actions:
```typescript
// BEFORE: Skipped test (Lines 132-160)
it.skip('should handle long line selections in large files', () => {
  // Test implementation exists but skipped
});

// AFTER: Either fix and activate OR delete if obsolete
it('should handle long line selections in large files', () => {
  // Fixed implementation with proper assertions
  const largeFile = createLargeTestFile(10000); // 10k lines
  const selection = { start: 5000, end: 5010 };
  
  render(<FileViewModal file={largeFile} selectedLines={[selection]} />);
  
  expect(screen.getByText(/Lines 5000-5010/)).toBeInTheDocument();
  expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument();
  expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
});

// OR delete if test is obsolete/redundant
```

#### Success Criteria:
- [ ] Zero `.skip` or `.todo` tests in entire codebase
- [ ] All activated tests pass
- [ ] No reduction in overall test coverage
- [ ] Documentation updated if any tests were removed

### Task 1.2: Create Shared Mock Infrastructure (Day 1-2)
**Priority:** 🔴 CRITICAL  
**Files:** New shared mock modules  
**Estimated Time:** 3-4 hours  

#### Create `src/__tests__/__mocks__/lucide-react.tsx`:
```typescript
// Complete mock for all Lucide React icons used across tests
import React from 'react';

// Centralized list of all icons used in the application
const USED_ICONS = [
  'Folder', 'FolderOpen', 'File', 'X', 'ChevronDown', 'ChevronUp', 
  'ChevronRight', 'Filter', 'RefreshCw', 'Search', 'Eye', 'Check', 
  'Trash', 'CheckSquare', 'Square', 'MessageSquareCode', 'Settings'
];

// Generate mock components for all icons
const mockIcons = USED_ICONS.reduce((acc, iconName) => {
  acc[iconName] = ({ size, className, ...props }: any) => (
    <div 
      data-testid={`${iconName.toLowerCase()}-icon`}
      data-size={size}
      className={className}
      {...props}
    />
  );
  return acc;
}, {} as Record<string, React.FC<any>>);

// Export all mocked icons
export const {
  Folder, FolderOpen, File, X, ChevronDown, ChevronUp, ChevronRight,
  Filter, RefreshCw, Search, Eye, Check, Trash, CheckSquare, Square,
  MessageSquareCode, Settings
} = mockIcons;

// Default export for jest.mock() compatibility
export default mockIcons;
```

#### Update affected test files:
```typescript
// BEFORE: Individual icon mocking in sidebar-test.tsx (11 mocks)
jest.mock('lucide-react', () => ({
  Folder: () => <div data-testid="folder-icon" />,
  ChevronDown: () => <div data-testid="chevron-down-icon" />,
  // ... 8 more individual mocks
}));

// AFTER: Single shared mock import (1 mock)
jest.mock('lucide-react');
```

#### Files to Update:
1. `sidebar-test.tsx` - Remove 10 individual icon mocks
2. `file-view-modal-test.tsx` - Use shared icon mocks
3. `system-prompts-modal-test.tsx` - Use shared icon mocks
4. `tree-item-test.tsx` - Use shared icon mocks
5. `expand-collapse-functions-test.tsx` - Use shared icon mocks

#### Success Criteria:
- [ ] Shared `__mocks__/lucide-react.tsx` created
- [ ] All files using >3 mocks reduced to ≤3 mocks
- [ ] All existing tests still pass
- [ ] Mock count verification script passes

### Task 1.3: Fix Critical Assertion Density Violations (Day 2-3)
**Priority:** 🔴 CRITICAL  
**Files:** `workspace-test.ts`, `flatten-tree-test.ts`, `file-loading-progress-test.tsx`  
**Estimated Time:** 4-5 hours  

#### Fix `workspace-test.ts` - Lines 12-28:
```typescript
// BEFORE: Single assertion (Lines 12-28)
test('saves and loads workspace with complete state', () => {
  const { result } = renderHook(() => useAppState());
  
  act(() => {
    result.current.setUserInstructions('test instructions');
    result.current.setSelectedFiles([{ path: 'test.ts', lines: [] }]);
  });
  
  act(() => {
    result.current.saveWorkspace('test');
  });
  
  const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
  expect(workspaces['test']).toBeDefined(); // ONLY 1 ASSERTION
});

// AFTER: Multiple comprehensive assertions (3+ assertions)
test('saves and loads workspace with complete state', () => {
  const { result } = renderHook(() => useAppState());
  
  // Setup initial state
  act(() => {
    result.current.setUserInstructions('test instructions');
    result.current.setSelectedFiles([{ path: 'test.ts', lines: [] }]);
  });
  
  // Save workspace
  act(() => {
    result.current.saveWorkspace('test');
  });
  
  // ASSERTION 1: Verify workspace exists in localStorage
  const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
  expect(workspaces['test']).toBeDefined();
  
  // ASSERTION 2: Verify workspace structure and content
  const workspace = JSON.parse(workspaces['test']);
  expect(workspace.userInstructions).toBe('test instructions');
  expect(workspace.selectedFiles).toHaveLength(1);
  expect(workspace.selectedFiles[0].path).toBe('test.ts');
  
  // ASSERTION 3: Verify metadata and completeness
  expect(workspace.expandedNodes).toBeDefined();
  expect(workspace.savedAt).toBeGreaterThan(Date.now() - 1000);
  expect(typeof workspace.tokenCounts).toBe('object');
  
  // Clear current state to test loading
  act(() => {
    result.current.setUserInstructions('');
    result.current.setSelectedFiles([]);
  });
  
  // Load workspace
  act(() => {
    result.current.loadWorkspace('test');
  });
  
  // ASSERTION 4: Verify state restoration
  expect(result.current.userInstructions).toBe('test instructions');
  expect(result.current.selectedFiles).toHaveLength(1);
  expect(result.current.selectedFiles[0].path).toBe('test.ts');
  
  // ASSERTION 5: Verify side effects (current workspace tracking)
  expect(localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE)).toBe('test');
});
```

#### Similar fixes needed for:
- `workspace-test.ts` Lines 83-93 (`gets workspace names`)
- `workspace-test.ts` Lines 136-151 (`handles empty workspace names`)
- `flatten-tree-test.ts` Lines 85-90
- `file-loading-progress-test.tsx` Lines 45-58, 92-105

#### Success Criteria:
- [ ] All tests have ≥2 meaningful assertions
- [ ] Assertions test different aspects of behavior
- [ ] No tests rely on single truth checks
- [ ] Automated assertion density check passes

### Task 1.4: Mock Count Verification Script (Day 3)
**Priority:** 🔴 CRITICAL  
**Estimated Time:** 1-2 hours  

#### Create `scripts/test-quality/mock-count-checker.ts`:
```typescript
#!/usr/bin/env npx tsx

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

interface MockViolation {
  file: string;
  mockCount: number;
  mocks: string[];
}

function countMocksInFile(filePath: string): { count: number; mocks: string[] } {
  const content = readFileSync(filePath, 'utf8');
  
  // Find jest.mock() calls
  const mockMatches = content.match(/jest\.mock\(['"`][^'"`]+['"`]/g) || [];
  
  // Find other mock patterns
  const mockFnMatches = content.match(/const \w+ = jest\.fn\(\)/g) || [];
  const spyMatches = content.match(/jest\.spyOn\(/g) || [];
  
  const allMocks = [...mockMatches, ...mockFnMatches, ...spyMatches];
  
  return {
    count: allMocks.length,
    mocks: allMocks
  };
}

async function checkMockLimits() {
  const testFiles = glob.sync('src/__tests__/**/*.{ts,tsx}', { absolute: true });
  const violations: MockViolation[] = [];
  
  for (const file of testFiles) {
    const { count, mocks } = countMocksInFile(file);
    
    if (count > 3) {
      violations.push({
        file: file.replace(process.cwd(), '.'),
        mockCount: count,
        mocks
      });
    }
  }
  
  if (violations.length > 0) {
    console.error('❌ Mock limit violations found:');
    violations.forEach(v => {
      console.error(`\n${v.file}: ${v.mockCount} mocks (limit: 3)`);
      v.mocks.forEach(mock => console.error(`  - ${mock}`));
    });
    process.exit(1);
  }
  
  console.log('✅ All test files comply with 3-mock limit');
}

checkMockLimits().catch(console.error);
```

#### Add to package.json:
```json
{
  "scripts": {
    "test:mock-check": "npx tsx scripts/test-quality/mock-count-checker.ts",
    "test:quality-gates": "npm run test:mock-check && npm test -- --passWithNoTests"
  }
}
```

### Phase 1 Completion Criteria:
- [ ] Zero skipped tests in codebase
- [ ] All files have ≤3 mocks (verified by script)
- [ ] All tests have ≥2 meaningful assertions
- [ ] Shared mock infrastructure in place
- [ ] All existing tests pass
- [ ] Mock count checker integrated into CI

---

## PHASE 2: HIGH PRIORITY ISSUES (Week 2-3)
**Duration:** 10 days  
**Effort:** 16-20 hours  
**Focus:** Behavior testing, Error scenarios, Mock reduction  

### Task 2.1: Refactor Implementation-Detail Tests (Day 4-6)
**Priority:** 🟡 HIGH  
**Files:** `file-processing/ipc-handlers-test.ts`, `sidebar-test.tsx`  
**Estimated Time:** 6-8 hours  

#### Transform `file-processing/ipc-handlers-test.ts`:
```typescript
// BEFORE: Testing implementation details
it('should register required IPC handlers on startup', () => {
  expect(ipcMain.on).toHaveBeenCalledWith('request-file-list', expect.any(Function));
  expect(ipcMain.on).toHaveBeenCalledWith('cancel-file-loading', expect.any(Function));
});

// AFTER: Testing actual behavior and outcomes
describe('File Processing IPC Communication', () => {
  let mockRenderer: MockRenderer;
  
  beforeEach(() => {
    mockRenderer = createMockRenderer();
  });
  
  it('should process file requests and return structured file data', async () => {
    // Arrange - Create test directory with known files
    const testDir = await createTempTestDirectory({
      'src/index.js': 'console.log("hello");',
      'README.md': '# Test Project',
      'package.json': '{"name": "test"}'
    });
    
    // Act - Simulate IPC file request
    const result = await simulateIPCCall('request-file-list', testDir);
    
    // Assert - Verify business outcomes
    expect(result.status).toBe('complete');                    // 1. Operation completed
    expect(result.files).toHaveLength(3);                      // 2. All files found
    expect(result.totalTokens).toBeGreaterThan(0);             // 3. Token counting worked
    expect(result.files.every(f => f.tokenCount > 0)).toBe(true); // 4. Each file has tokens
    
    // Verify file structure
    const indexFile = result.files.find(f => f.name === 'index.js');
    expect(indexFile).toBeDefined();
    expect(indexFile.content).toBe('console.log("hello");');
    expect(indexFile.isBinary).toBe(false);
  });
  
  it('should handle cancellation during processing', async () => {
    const largeTestDir = await createLargeTestDirectory(1000); // 1000 files
    
    // Start processing
    const processingPromise = simulateIPCCall('request-file-list', largeTestDir);
    
    // Cancel mid-process
    setTimeout(() => simulateIPCCall('cancel-file-loading'), 100);
    
    const result = await processingPromise;
    
    // Verify cancellation behavior
    expect(result.status).toBe('cancelled');                   // 1. Status reflects cancellation
    expect(result.files.length).toBeLessThan(1000);           // 2. Processing was interrupted
    expect(result.message).toMatch(/cancelled/i);             // 3. User-visible message
  });
  
  it('should handle directory access errors gracefully', async () => {
    const restrictedDir = '/root/restricted';
    
    const result = await simulateIPCCall('request-file-list', restrictedDir);
    
    expect(result.status).toBe('error');                       // 1. Error status
    expect(result.message).toMatch(/permission|access/i);     // 2. Meaningful error message
    expect(result.files).toEqual([]);                         // 3. No partial data
  });
});
```

### Task 2.2: Add Missing Error Scenario Tests (Day 6-8)
**Priority:** 🟡 HIGH  
**Focus:** Error handling, Edge cases, User feedback  
**Estimated Time:** 5-6 hours  

#### Add to `workspace-test.ts`:
```typescript
describe('Workspace Error Handling', () => {
  it('should handle corrupted workspace data gracefully', () => {
    // Arrange - Simulate corrupted localStorage data
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, '{"corrupt": "invalid-json-data"}');
    
    const { result } = renderHook(() => useAppState());
    
    // Act - Attempt to load corrupted workspace
    let errorOccurred = false;
    try {
      act(() => {
        result.current.loadWorkspace('corrupt');
      });
    } catch (error) {
      errorOccurred = true;
    }
    
    // Assert - Graceful degradation
    expect(errorOccurred).toBe(false);                         // 1. No uncaught errors
    expect(result.current.userInstructions).toBe('');         // 2. Clean fallback state
    expect(result.current.selectedFiles).toEqual([]);         // 3. Empty selection
    
    // Verify corrupted data is cleaned up
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    expect(workspaces.corrupt).toBeUndefined();               // 4. Corrupted data removed
  });
  
  it('should handle localStorage quota exceeded', () => {
    // Mock localStorage to simulate quota exceeded
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = jest.fn().mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    
    const { result } = renderHook(() => useWorkspaceState());
    
    let saveError = null;
    act(() => {
      try {
        result.current.saveWorkspace('large-workspace');
      } catch (error) {
        saveError = error;
      }
    });
    
    // Verify graceful handling
    expect(saveError).toBeNull();                              // 1. Error caught internally
    // Should dispatch error event for UI to handle
    // expect(mockErrorDispatch).toHaveBeenCalledWith(...);   // 2. User notification
    
    // Restore original implementation
    localStorage.setItem = originalSetItem;
  });
});
```

#### Add to `file-loading-progress-test.tsx`:
```typescript
describe('File Loading Error States', () => {
  it('should display error message when file loading fails', async () => {
    const mockOnCancel = jest.fn();
    
    render(
      <FileLoadingProgress
        status={{
          status: 'error',
          message: 'Permission denied accessing directory',
          processed: 10,
          total: 100
        }}
        onCancel={mockOnCancel}
      />
    );
    
    // Verify error state display
    expect(screen.getByText(/error/i)).toBeInTheDocument();           // 1. Error indicator
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument(); // 2. Specific error message
    expect(screen.getByText('10 / 100')).toBeInTheDocument();        // 3. Progress at error point
    expect(screen.getByText('Cancel')).toBeInTheDocument();          // 4. Cancel still available
  });
});
```

### Task 2.3: Increase Integration Test Coverage (Day 8-10)
**Priority:** 🟡 HIGH  
**Focus:** Full user workflows, Component integration  
**Estimated Time:** 5-6 hours  

#### Create `src/__tests__/integration/file-selection-workflow-test.tsx`:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createTempTestDirectory, cleanupTempDirectory } from '../test-helpers';

describe('Complete File Selection Workflow Integration', () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await createTempTestDirectory({
      'src/index.js': 'console.log("hello");',
      'src/utils.js': 'export const helper = () => {};',
      'README.md': '# Test Project',
      'package.json': '{"name": "test"}',
      'node_modules/react/index.js': 'module.exports = React;' // Should be excluded
    });
  });
  
  afterEach(async () => {
    await cleanupTempDirectory(tempDir);
  });
  
  it('should complete full file selection workflow', async () => {
    render(<App />);
    
    // STEP 1: Select folder
    const selectFolderBtn = screen.getByText('Select Folder');
    fireEvent.click(selectFolderBtn);
    
    // Mock electron dialog response
    mockElectronDialog.resolveWith(tempDir);
    
    // STEP 2: Wait for file scanning to complete
    await waitFor(() => {
      expect(screen.getByText(/scanning complete/i)).toBeInTheDocument();
    }, { timeout: 5000 });
    
    // STEP 3: Verify files are displayed (excluding node_modules)
    expect(screen.getByText('index.js')).toBeInTheDocument();      // 1. JS files shown
    expect(screen.getByText('utils.js')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();     // 2. MD files shown
    expect(screen.queryByText('node_modules')).not.toBeInTheDocument(); // 3. Excluded properly
    
    // STEP 4: Select specific files
    const indexFileCard = screen.getByTestId('file-card-src/index.js');
    fireEvent.click(indexFileCard);
    
    const utilsFileCard = screen.getByTestId('file-card-src/utils.js');  
    fireEvent.click(utilsFileCard);
    
    // STEP 5: Verify selection state
    expect(screen.getByText('2 files selected')).toBeInTheDocument(); // 4. Selection count
    
    // STEP 6: Apply filters
    const filterBtn = screen.getByTestId('filter-button');
    fireEvent.click(filterBtn);
    
    // Add exclusion pattern for JS files
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { 
      target: { value: textarea.value + '\n**/*.js' } 
    });
    
    const saveFiltersBtn = screen.getByText('Save Filters');
    fireEvent.click(saveFiltersBtn);
    
    // STEP 7: Verify filtering worked
    await waitFor(() => {
      expect(screen.queryByText('index.js')).not.toBeInTheDocument(); // 5. JS files filtered
      expect(screen.queryByText('utils.js')).not.toBeInTheDocument();
    });
    expect(screen.getByText('README.md')).toBeInTheDocument();       // 6. MD files remain
    
    // STEP 8: Test copy functionality
    const copyBtn = screen.getByTestId('copy-all-button');
    fireEvent.click(copyBtn);
    
    // Verify clipboard content
    const clipboardContent = await navigator.clipboard.readText();
    expect(clipboardContent).toContain('# Test Project');            // 7. Correct content copied
    expect(clipboardContent).not.toContain('console.log');          // 8. Filtered content excluded
  });
  
  it('should handle cancellation during file scanning', async () => {
    render(<App />);
    
    const selectFolderBtn = screen.getByText('Select Folder');
    fireEvent.click(selectFolderBtn);
    
    // Mock a large directory that takes time to scan
    mockElectronDialog.resolveWith('/large/directory');
    
    // Wait for scanning to start
    await waitFor(() => {
      expect(screen.getByText(/scanning/i)).toBeInTheDocument();
    });
    
    // Cancel during scanning
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    
    // Verify cancellation handling
    await waitFor(() => {
      expect(screen.getByText(/cancelled/i)).toBeInTheDocument();    // 1. Cancellation message
    });
    expect(screen.queryByText(/scanning/i)).not.toBeInTheDocument(); // 2. Scanning stopped
    expect(screen.getByText('Select Folder')).toBeInTheDocument();   // 3. Back to initial state
  });
});
```

### Phase 2 Completion Criteria:
- [ ] All implementation-detail tests converted to behavior tests
- [ ] Error scenarios covered for all major features
- [ ] Integration tests cover complete user workflows
- [ ] Error handling provides meaningful user feedback
- [ ] Cancellation works correctly for long operations

---

## PHASE 3: MEDIUM PRIORITY IMPROVEMENTS (Week 4-5)
**Duration:** 10 days  
**Effort:** 12-16 hours  
**Focus:** Edge cases, Performance testing, Accessibility  

### Task 3.1: Add Edge Case Coverage (Day 11-13)
**Priority:** 🟠 MEDIUM  
**Estimated Time:** 6-8 hours  

#### Add to `flatten-tree-test.ts`:
```typescript
describe('Edge Case Handling', () => {
  it('should handle circular reference detection', () => {
    // Create mock file structure with potential circular reference
    const files: FileData[] = [
      { path: '/project/src', name: 'src', isDirectory: true },
      { path: '/project/src/symlink-to-project', name: 'symlink-to-project', isDirectory: true }, // Potential circular ref
      { path: '/project/src/index.js', name: 'index.js', isDirectory: false }
    ];
    
    const expandedNodes = { '/project/src': true };
    const result = flattenFileTree(files, expandedNodes);
    
    // Should handle gracefully without infinite loops
    expect(result.length).toBeLessThan(1000);                   // 1. No infinite expansion
    expect(result.some(node => node.path.includes('symlink'))).toBe(true); // 2. Symlink included
    expect(result.filter(node => node.level > 10)).toHaveLength(0); // 3. Reasonable depth limit
  });
  
  it('should handle extremely deep directory structures', () => {
    // Create very deep nested structure
    const deepFiles: FileData[] = [];
    let currentPath = '/project';
    
    // Create 50 levels deep
    for (let i = 0; i < 50; i++) {
      currentPath += `/level${i}`;
      deepFiles.push({
        path: currentPath,
        name: `level${i}`,
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      });
    }
    
    const allExpanded = deepFiles.reduce((acc, file) => {
      acc[file.path] = true;
      return acc;
    }, {} as Record<string, boolean>);
    
    const result = flattenFileTree(deepFiles, allExpanded);
    
    expect(result.length).toBe(50);                             // 1. All levels processed
    expect(result[49].level).toBe(49);                          // 2. Correct depth calculation
    expect(result.every(node => node.level >= 0)).toBe(true);   // 3. No negative levels
  });
});
```

### Task 3.2: Performance Testing (Day 13-15)
**Priority:** 🟠 MEDIUM  
**Estimated Time:** 4-5 hours  

#### Create `src/__tests__/performance/large-file-processing-test.ts`:
```typescript
import { performance } from 'perf_hooks';

describe('Large File Processing Performance', () => {
  it('should process 1000 files within reasonable time', async () => {
    const startTime = performance.now();
    
    // Create large test dataset
    const largeFileSet = Array.from({ length: 1000 }, (_, i) => ({
      path: `/project/file${i}.js`,
      name: `file${i}.js`,
      content: `// File ${i}\n${'console.log("test");'.repeat(10)}`,
      size: 200,
      isBinary: false,
      isSkipped: false,
      tokenCount: 50
    }));
    
    // Process files (simulate batch processing)
    const batchSize = 50;
    const results = [];
    
    for (let i = 0; i < largeFileSet.length; i += batchSize) {
      const batch = largeFileSet.slice(i, i + batchSize);
      const batchResult = await processBatch(batch);
      results.push(...batchResult);
    }
    
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    
    // Performance assertions
    expect(processingTime).toBeLessThan(5000);                  // 1. Under 5 seconds
    expect(results).toHaveLength(1000);                        // 2. All files processed
    expect(results.every(r => r.tokenCount > 0)).toBe(true);   // 3. Token counting worked
    
    // Memory usage should be reasonable
    const memoryUsage = process.memoryUsage();
    expect(memoryUsage.heapUsed).toBeLessThan(100 * 1024 * 1024); // 4. Under 100MB
  });
  
  it('should handle memory efficiently with large file content', async () => {
    // Create files with large content
    const largeFiles = Array.from({ length: 10 }, (_, i) => ({
      path: `/project/large${i}.js`,
      name: `large${i}.js`,
      content: 'x'.repeat(1024 * 1024), // 1MB per file
      size: 1024 * 1024,
      isBinary: false,
      isSkipped: false
    }));
    
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Process large files
    const results = await Promise.all(
      largeFiles.map(file => processFileContent(file))
    );
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;
    
    // Memory assertions
    expect(results).toHaveLength(10);                           // 1. All processed
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);     // 2. Under 50MB increase
    expect(results.every(r => r.tokenCount > 1000)).toBe(true); // 3. Token counting accurate
  });
});
```

### Task 3.3: Accessibility Testing (Day 15-16)
**Priority:** 🟠 MEDIUM  
**Estimated Time:** 2-3 hours  

#### Add to `system-prompt-card-test.tsx`:
```typescript
describe('Accessibility Features', () => {
  it('should support keyboard navigation', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    const removeButton = screen.getByTitle('Remove from selection');
    const copyButton = screen.getByTestId('copy-button');
    
    // Test tab order
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(copyButton);            // 1. Copy button focusable
    
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(document.activeElement).toBe(removeButton);          // 2. Remove button next
    
    // Test keyboard activation
    fireEvent.keyDown(removeButton, { key: 'Enter' });
    expect(mockToggleSelection).toHaveBeenCalledWith(mockPrompt); // 3. Enter activates
    
    fireEvent.keyDown(removeButton, { key: ' ' });
    expect(mockToggleSelection).toHaveBeenCalledTimes(2);       // 4. Space also activates
  });
  
  it('should provide proper ARIA attributes', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    const card = screen.getByRole('article', { name: /system prompt/i });
    const removeButton = screen.getByRole('button', { name: /remove from selection/i });
    const copyButton = screen.getByRole('button', { name: /copy/i });
    
    // Verify ARIA attributes
    expect(card).toHaveAttribute('aria-label');                 // 1. Card labeled
    expect(removeButton).toHaveAttribute('aria-describedby');   // 2. Button described
    expect(copyButton).not.toHaveAttribute('aria-hidden');     // 3. Interactive elements visible
  });
});
```

### Phase 3 Completion Criteria:
- [ ] Edge cases covered for complex scenarios
- [ ] Performance tests verify acceptable response times
- [ ] Memory usage remains within reasonable bounds
- [ ] Accessibility features tested and working
- [ ] All tests pass consistently

---

## PHASE 4: INFRASTRUCTURE & AUTOMATION (Week 6-8)
**Duration:** 15 days  
**Effort:** 8-12 hours  
**Focus:** Automation, Templates, Documentation  

### Task 4.1: Automated Quality Enforcement (Day 17-19)
**Priority:** 🟠 INFRASTRUCTURE  
**Estimated Time:** 4-5 hours  

#### Create Pre-commit Hook `scripts/pre-commit-test-quality.sh`:
```bash
#!/bin/bash
set -e

echo "🔍 Running test quality checks..."

# Check for skipped tests
SKIPPED_TESTS=$(git grep -n "\.skip\|\.todo" src/__tests__/ || true)
if [ -n "$SKIPPED_TESTS" ]; then
    echo "❌ Skipped tests found:"
    echo "$SKIPPED_TESTS"
    echo "Remove .skip/.todo or fix the tests before committing."
    exit 1
fi

# Check mock count limits
echo "📊 Checking mock count limits..."
npm run test:mock-check

# Check assertion density
echo "🎯 Checking assertion density..."
npm run test:assertion-check

# Run all tests
echo "🧪 Running all tests..."
npm test -- --passWithNoTests --coverage --coverageThreshold='{"global":{"branches":80,"functions":80,"lines":80,"statements":80}}'

echo "✅ All test quality checks passed!"
```

#### Create `scripts/test-quality/assertion-density-checker.ts`:
```typescript
#!/usr/bin/env npx tsx

import { readFileSync } from 'fs';
import { glob } from 'glob';

interface AssertionViolation {
  file: string;
  testName: string;
  lineNumber: number;
  assertionCount: number;
}

function countAssertionsInTest(testContent: string): number {
  // Count expect() calls, toHaveBeenCalled, etc.
  const expectMatches = testContent.match(/expect\(/g) || [];
  const toHaveBeenMatches = testContent.match(/\.toHaveBeenCalled/g) || [];
  const toThrowMatches = testContent.match(/\.toThrow/g) || [];
  
  return expectMatches.length + toHaveBeenMatches.length + toThrowMatches.length;
}

function analyzeTestFile(filePath: string): AssertionViolation[] {
  const content = readFileSync(filePath, 'utf8');
  const violations: AssertionViolation[] = [];
  
  // Find all test blocks
  const testRegex = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s+)?\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\);/g;
  let match;
  
  while ((match = testRegex.exec(content)) !== null) {
    const testName = match[1];
    const testBody = match[2];
    const assertionCount = countAssertionsInTest(testBody);
    
    if (assertionCount < 2) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      violations.push({
        file: filePath.replace(process.cwd(), '.'),
        testName,
        lineNumber,
        assertionCount
      });
    }
  }
  
  return violations;
}

async function checkAssertionDensity() {
  const testFiles = glob.sync('src/__tests__/**/*.{ts,tsx}', { absolute: true });
  let allViolations: AssertionViolation[] = [];
  
  for (const file of testFiles) {
    const violations = analyzeTestFile(file);
    allViolations = [...allViolations, ...violations];
  }
  
  if (allViolations.length > 0) {
    console.error('❌ Assertion density violations found:');
    allViolations.forEach(v => {
      console.error(`\n${v.file}:${v.lineNumber}`);
      console.error(`  Test: "${v.testName}"`);
      console.error(`  Assertions: ${v.assertionCount} (minimum: 2)`);
    });
    process.exit(1);
  }
  
  console.log('✅ All tests meet assertion density requirements');
}

checkAssertionDensity().catch(console.error);
```

#### Update `package.json`:
```json
{
  "scripts": {
    "test:assertion-check": "npx tsx scripts/test-quality/assertion-density-checker.ts",
    "test:quality-full": "npm run test:mock-check && npm run test:assertion-check && npm test",
    "prepare": "husky install",
    "test:ci": "npm run test:quality-full -- --coverage --watchAll=false"
  },
  "husky": {
    "hooks": {
      "pre-commit": "./scripts/pre-commit-test-quality.sh"
    }
  }
}
```

### Task 4.2: Test Templates and Documentation (Day 19-21)
**Priority:** 🟠 INFRASTRUCTURE  
**Estimated Time:** 3-4 hours  

#### Create `docs/test-templates/unit-test-template.ts`:
```typescript
// Template for unit tests following PasteFlow standards
// Copy this template and replace placeholders with your actual implementation

import { functionToTest } from '../path/to/module';

describe('ModuleName', () => {
  // Setup and teardown (if needed)
  beforeEach(() => {
    // Reset mocks, clear state, etc.
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    // Cleanup resources if needed
  });
  
  // TEMPLATE: Basic functionality test
  it('should [describe the expected behavior]', () => {
    // Arrange - Set up test data and expectations
    const input = { /* realistic test data */ };
    const expectedOutput = { /* expected result */ };
    
    // Act - Execute the function
    const result = functionToTest(input);
    
    // Assert - Verify multiple aspects (minimum 2 assertions)
    expect(result).toEqual(expectedOutput);                    // 1. Primary output
    expect(result.metadata).toBeDefined();                     // 2. Side effects/structure
    expect(typeof result.id).toBe('string');                  // 3. Type validation
  });
  
  // TEMPLATE: Error handling test
  it('should handle [error condition] gracefully', async () => {
    // Arrange - Set up error scenario
    const invalidInput = { /* data that should cause error */ };
    
    // Act & Assert - Test error handling
    await expect(functionToTest(invalidInput))                 // 1. Error thrown
      .rejects
      .toThrow('Expected error message');
    
    // Additional assertions for error state
    expect(mockLogger.error).toHaveBeenCalled();              // 2. Error logged
    expect(cleanup).toHaveBeenCalledTimes(1);                 // 3. Cleanup occurred
  });
  
  // TEMPLATE: Edge case test
  it('should handle edge case: [specific edge case]', () => {
    // Arrange - Create edge case scenario
    const edgeInput = { /* boundary/edge case data */ };
    
    // Act
    const result = functionToTest(edgeInput);
    
    // Assert - Verify edge case handling
    expect(result).not.toBeNull();                            // 1. Doesn't crash
    expect(result.warnings).toContain('edge case');          // 2. Appropriate warnings
    expect(result.fallbackUsed).toBe(true);                  // 3. Fallback behavior
  });
  
  // NOTES:
  // - Use realistic test data, not minimal examples
  // - Each test should have 2+ meaningful assertions
  // - Focus on behavior, not implementation details
  // - Use descriptive test names that explain the expected outcome
  // - Keep mocks to a minimum (≤3 per file)
});
```

#### Create `docs/testing-best-practices.md`:
```markdown
# PasteFlow Testing Best Practices

## Quick Reference Checklist

### Before Writing Tests
- [ ] Read the source code to understand the expected behavior
- [ ] Identify edge cases and error scenarios
- [ ] Plan to test outcomes, not implementation details

### Test Structure Requirements
- [ ] **Minimum 2 assertions** per test
- [ ] **Maximum 3 mocks** per test file
- [ ] **No `.skip` or `.todo`** tests
- [ ] **Use `expect().rejects`** for async errors
- [ ] **Realistic test data** (not minimal examples)

### Exemplary Patterns to Follow

#### 1. Real Operations (Gold Standard)
```typescript
// ✅ Follow this pattern from apply-changes-test.ts
it('should create file with correct content', async () => {
  const tempDir = await createTempDirectory();
  const fileChange = { operation: 'CREATE', path: 'test.js', content: 'console.log("hello");' };
  
  await applyFileChanges(fileChange, tempDir);
  
  const exists = await fileExists(join(tempDir, 'test.js'));
  expect(exists).toBe(true);                                   // 1. File created
  
  const content = await readFile(join(tempDir, 'test.js'), 'utf8');
  expect(content).toBe('console.log("hello");');              // 2. Content correct
  
  await cleanupTempDirectory(tempDir);
});
```

#### 2. Error Handling
```typescript
// ✅ Test error conditions thoroughly
it('should handle permission errors gracefully', async () => {
  const restrictedPath = '/root/restricted';
  
  await expect(processDirectory(restrictedPath))               // 1. Error thrown
    .rejects
    .toThrow(/permission denied/i);
  
  expect(mockLogger.error).toHaveBeenCalled();                // 2. Error logged
  expect(mockNotification.show).toHaveBeenCalledWith(         // 3. User notified
    expect.objectContaining({ type: 'error' })
  );
});
```

### Anti-Patterns to Avoid

#### ❌ Implementation Detail Testing
```typescript
// Don't test internal method calls
expect(mockService.internalMethod).toHaveBeenCalled();

// ✅ Test behavior instead
expect(result.data).toContain(expectedUserData);
```

#### ❌ Minimal Test Data
```typescript
// Don't use oversimplified data
const user = { id: 1 };

// ✅ Use realistic data
const user = {
  id: 'user-123',
  name: 'John Doe',
  email: 'john@example.com',
  preferences: { theme: 'dark' },
  createdAt: new Date().toISOString()
};
```

#### ❌ Single Assertions
```typescript
// Don't test only one aspect
expect(result).toBeDefined();

// ✅ Test multiple aspects
expect(result).toBeDefined();                                // 1. Result exists
expect(result.status).toBe('success');                      // 2. Operation succeeded
expect(result.data).toHaveLength(expectedCount);            // 3. Correct data size
```

## Quality Enforcement

### Automated Checks
```bash
# Run before every commit
npm run test:quality-full

# Individual checks
npm run test:mock-check          # Verify ≤3 mocks per file
npm run test:assertion-check     # Verify ≥2 assertions per test
```

### Manual Review Checklist
- [ ] Tests focus on user-visible outcomes
- [ ] Error scenarios are covered
- [ ] Edge cases are tested
- [ ] Test names are descriptive
- [ ] Setup/teardown is proper
- [ ] No skipped or commented tests
```

### Task 4.3: CI/CD Integration (Day 21-22)
**Priority:** 🟠 INFRASTRUCTURE  
**Estimated Time:** 1-2 hours  

#### Update `.github/workflows/test.yml`:
```yaml
name: Test Quality Enforcement

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test-quality:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Check for skipped tests
      run: |
        if git grep -n "\.skip\|\.todo" src/__tests__/; then
          echo "❌ Skipped tests found - see output above"
          exit 1
        else
          echo "✅ No skipped tests found"
        fi
    
    - name: Check mock count limits
      run: npm run test:mock-check
    
    - name: Check assertion density
      run: npm run test:assertion-check
    
    - name: Run tests with coverage
      run: npm run test:ci
    
    - name: Upload coverage reports
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
        fail_ci_if_error: true
        
    - name: Test quality summary
      run: |
        echo "🎉 All test quality checks passed!"
        echo "📊 Coverage reports uploaded"
        echo "✅ Ready for merge"
```

### Phase 4 Completion Criteria:
- [ ] Pre-commit hooks prevent quality violations
- [ ] CI/CD enforces all quality standards
- [ ] Test templates available for developers
- [ ] Documentation covers best practices
- [ ] Automated reporting in place

---

## SUCCESS METRICS & TRACKING

### Key Performance Indicators

| Metric | Baseline | Week 2 Target | Week 4 Target | Final Target |
|--------|----------|---------------|---------------|--------------|
| **Overall Quality Score** | 6.8/10 | 7.5/10 | 8.5/10 | 9.0/10 |
| **Files with >3 Mocks** | 5 files | 2 files | 1 file | 0 files |
| **Tests with <2 Assertions** | 8 tests | 4 tests | 2 tests | 0 tests |
| **Skipped Tests** | 4 tests | 0 tests | 0 tests | 0 tests |
| **Error Test Coverage** | 60% | 75% | 85% | 90% |
| **Integration Test Coverage** | 40% | 55% | 70% | 80% |

### Weekly Progress Tracking

#### Week 1 Deliverables:
- [ ] Zero skipped tests (`grep "\.skip\|\.todo" src/__tests__/` returns empty)
- [ ] Shared mock infrastructure created (`src/__tests__/__mocks__/lucide-react.tsx`)
- [ ] All files have ≤3 mocks (verified by `npm run test:mock-check`)
- [ ] All tests have ≥2 assertions (verified by `npm run test:assertion-check`)

#### Week 2-3 Deliverables:
- [ ] Implementation-detail tests converted to behavior tests
- [ ] Error scenarios added to all major features
- [ ] Integration tests cover complete workflows
- [ ] Mock count reduced by 60%

#### Week 4-5 Deliverables:
- [ ] Edge cases covered for complex scenarios
- [ ] Performance tests verify response times <5s for 1000 files
- [ ] Accessibility features tested
- [ ] Memory usage remains <100MB for large operations

#### Week 6-8 Deliverables:
- [ ] Pre-commit hooks block quality violations
- [ ] CI/CD enforces all standards
- [ ] Test templates and documentation complete
- [ ] Quality metrics automated and tracked

### Measurement Commands

```bash
# Daily quality check
npm run test:quality-full

# Generate quality report
npm run test:quality-report

# Verify specific metrics
git grep -c "\.skip\|\.todo" src/__tests__/ | wc -l  # Should be 0
npm run test:mock-check --reporter=json | jq '.violations | length'  # Should be 0
npm run test:assertion-check --reporter=json | jq '.violations | length'  # Should be 0
```

## RISK MITIGATION

### High-Risk Areas

#### 1. Breaking Existing Functionality
**Risk:** Refactoring tests might break working features  
**Mitigation:**
- Run full test suite after each change
- Use feature flags for major refactors
- Maintain backward compatibility during transition
- Create safety net with snapshot tests temporarily

#### 2. Performance Degradation
**Risk:** More comprehensive tests might slow down development  
**Mitigation:**
- Run expensive tests only in CI
- Use `--watch` mode for development
- Parallelize test execution
- Optimize test data creation

#### 3. Developer Resistance
**Risk:** Team might resist stricter quality standards  
**Mitigation:**
- Provide clear examples and templates
- Show benefits through better bug detection
- Implement gradually with clear communication
- Offer pairing sessions for difficult conversions

### Contingency Plans

#### If Timeline Slips:
1. **Week 1 Priority:** Focus only on critical violations (skipped tests, mock limits)
2. **Week 2-3 Fallback:** Complete behavior conversion for most critical files only
3. **Week 4+ Optional:** Treat as nice-to-have improvements

#### If Tests Become Too Complex:
1. **Simplify Approach:** Focus on essential behavior testing only
2. **Split Large Tests:** Break complex integration tests into smaller units
3. **Use Test Helpers:** Create more utilities to reduce boilerplate

#### If CI/CD Integration Fails:
1. **Manual Process:** Use pre-commit hooks as primary enforcement
2. **Gradual Rollout:** Enable CI checks file-by-file
3. **Fallback Metrics:** Use npm scripts for local validation

## RESOURCE ALLOCATION

### Development Hours Breakdown

| Phase | Tasks | Hours | Priority |
|-------|--------|-------|----------|
| **Phase 1** | Critical fixes | 12-16 | MUST DO |
| **Phase 2** | High priority improvements | 16-20 | SHOULD DO |
| **Phase 3** | Medium priority enhancements | 12-16 | NICE TO HAVE |
| **Phase 4** | Infrastructure & automation | 8-12 | INVESTMENT |
| **Total** | Complete implementation | **48-64** | |

### Skill Requirements

#### Essential Skills:
- Jest/Testing Library experience
- TypeScript proficiency
- Understanding of testing patterns
- Basic shell scripting (for automation)

#### Helpful Skills:
- CI/CD configuration
- Performance testing
- Accessibility testing
- Node.js tooling

### Tools and Dependencies

#### Required:
```json
{
  "devDependencies": {
    "@testing-library/jest-dom": "^5.16.5",
    "@testing-library/react": "^13.4.0",
    "jest": "^29.7.0",
    "typescript": "^5.0.0"
  }
}
```

#### Additional Tools:
```json
{
  "devDependencies": {
    "husky": "^8.0.3",
    "tsx": "^3.12.0",
    "glob": "^8.1.0",
    "codecov": "^3.8.3"
  }
}
```

---

## FINAL IMPLEMENTATION CHECKLIST

### Pre-Implementation
- [ ] Team alignment on quality standards
- [ ] Development environment prepared
- [ ] Backup of current test suite created
- [ ] Timeline communicated to stakeholders

### Phase 1 (Week 1) - CRITICAL
- [ ] All skipped tests removed or activated
- [ ] Shared mock infrastructure created
- [ ] Mock count violations resolved
- [ ] Assertion density violations fixed
- [ ] Automated checking scripts created

### Phase 2 (Week 2-3) - HIGH PRIORITY
- [ ] Implementation-detail tests converted
- [ ] Error scenario tests added
- [ ] Integration test coverage increased
- [ ] Behavior-focused testing established

### Phase 3 (Week 4-5) - MEDIUM PRIORITY
- [ ] Edge case coverage added
- [ ] Performance tests implemented
- [ ] Accessibility tests added
- [ ] Complex scenario handling verified

### Phase 4 (Week 6-8) - INFRASTRUCTURE
- [ ] Pre-commit hooks configured
- [ ] CI/CD integration complete
- [ ] Test templates created
- [ ] Documentation updated
- [ ] Quality metrics automated

### Post-Implementation
- [ ] Final quality score ≥9.0/10
- [ ] All automated checks passing
- [ ] Team training on new standards
- [ ] Monitoring and maintenance plan established

---

**Document Version:** 1.0  
**Last Updated:** 2025-07-26  
**Next Review:** After Week 2 completion  
**Success Criteria:** All critical violations resolved, quality score >8.5/10