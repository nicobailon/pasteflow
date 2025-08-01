import { render } from '@testing-library/react';

import FileList from '../components/file-list';
import { FileData, SelectedFileReference } from '../types/file-types';

// Helper to generate large file datasets for performance testing
function generateLargeFileSet(count: number): FileData[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `file-${index}.ts`,
    path: `/workspace/src/file-${index}.ts`,
    isDirectory: false,
    size: Math.floor(Math.random() * 10000) + 1000,
    isBinary: false,
    isSkipped: false,
    isContentLoaded: true,
    content: `// File ${index}\nexport const value${index} = ${index};\n`.repeat(50),
    tokenCount: Math.floor(Math.random() * 1000) + 100,
  }));
}

// Helper to generate selected file references
function generateSelectedFiles(files: FileData[], percentage: number): SelectedFileReference[] {
  const selectedCount = Math.floor(files.length * percentage);
  return files.slice(0, selectedCount).map(file => ({
    path: file.path,
  }));
}

describe('FileList Performance Tests', () => {
  const mockProps = {
    toggleFileSelection: jest.fn(),
    toggleSelection: jest.fn(),
    openFolder: jest.fn(),
    onViewFile: jest.fn(),
    processingStatus: { status: 'idle' as const, message: '' },
    selectedSystemPrompts: [],
    toggleSystemPromptSelection: jest.fn(),
    selectedRolePrompts: [],
    toggleRolePromptSelection: jest.fn(),
    selectedInstructions: [],
    toggleInstructionSelection: jest.fn(),
    loadFileContent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render efficiently with 100 files', () => {
    const files = generateLargeFileSet(100);
    const selectedFiles = generateSelectedFiles(files, 0.5); // 50% selected

    const startTime = performance.now();
    
    const { container } = render(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    const renderTime = performance.now() - startTime;
    
    // Performance assertion: Should render within 100ms
    expect(renderTime).toBeLessThan(100);
    
    // Verify correct number of file cards rendered
    const fileCards = container.querySelectorAll('.file-card');
    expect(fileCards.length).toBe(50); // 50% of 100 files
  });

  it('should render efficiently with 1000 files', () => {
    const files = generateLargeFileSet(1000);
    const selectedFiles = generateSelectedFiles(files, 0.1); // 10% selected

    const startTime = performance.now();
    
    const { container } = render(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    const renderTime = performance.now() - startTime;
    
    // Performance assertion: Should render within 500ms even with 1000 files
    expect(renderTime).toBeLessThan(500);
    
    // Verify correct number of file cards rendered
    const fileCards = container.querySelectorAll('.file-card');
    expect(fileCards.length).toBe(100); // 10% of 1000 files
  });

  it('should handle re-renders efficiently when selection changes', () => {
    const files = generateLargeFileSet(500);
    let selectedFiles = generateSelectedFiles(files, 0.2); // 20% selected

    const { rerender } = render(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    // Measure re-render time when selection changes
    selectedFiles = generateSelectedFiles(files, 0.3); // Change to 30% selected
    
    const startTime = performance.now();
    
    rerender(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    const rerenderTime = performance.now() - startTime;
    
    // Re-render should be fast due to memoized Maps
    expect(rerenderTime).toBeLessThan(50);
  });

  it('should efficiently handle files with multiple line ranges', () => {
    const files = generateLargeFileSet(200);
    
    // Create selected files with multiple line ranges
    const selectedFiles: SelectedFileReference[] = files.slice(0, 50).map((file, index) => ({
      path: file.path,
      lines: index % 2 === 0 
        ? [{ start: 1, end: 10 }, { start: 20, end: 30 }, { start: 40, end: 50 }]
        : undefined, // Mix of full files and files with line ranges
    }));

    const startTime = performance.now();
    
    const { container } = render(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    const renderTime = performance.now() - startTime;
    
    // Should handle line ranges efficiently
    expect(renderTime).toBeLessThan(200);
    
    // Verify expanded cards are created for line ranges
    const fileCards = container.querySelectorAll('.file-card');
    // 25 files with 3 line ranges each = 75, plus 25 full files = 100 total
    expect(fileCards.length).toBe(100);
  });

  it('should benefit from memoization on re-renders with same props', () => {
    const files = generateLargeFileSet(100);
    const selectedFiles = generateSelectedFiles(files, 0.5);

    const { rerender } = render(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    // Measure re-render time with identical props
    const startTime = performance.now();
    
    rerender(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    const rerenderTime = performance.now() - startTime;
    
    // Re-render with same props should be very fast due to memoization
    expect(rerenderTime).toBeLessThan(10);
  });

  it('should handle empty file lists efficiently', () => {
    const startTime = performance.now();
    
    render(
      <FileList
        {...mockProps}
        files={[]}
        selectedFiles={[]}
      />
    );

    const renderTime = performance.now() - startTime;
    
    // Empty lists should render very quickly
    expect(renderTime).toBeLessThan(10);
  });

  it('should filter binary and skipped files efficiently', () => {
    const files = generateLargeFileSet(500);
    
    // Mark half as binary or skipped
    files.forEach((file, index) => {
      if (index % 2 === 0) {
        file.isBinary = true;
      } else if (index % 3 === 0) {
        file.isSkipped = true;
      }
    });

    const selectedFiles = files.map(file => ({ path: file.path }));

    const startTime = performance.now();
    
    const { container } = render(
      <FileList
        {...mockProps}
        files={files}
        selectedFiles={selectedFiles}
      />
    );

    const renderTime = performance.now() - startTime;
    
    // Filtering should be efficient
    expect(renderTime).toBeLessThan(100);
    
    // Verify only non-binary, non-skipped files are rendered
    const fileCards = container.querySelectorAll('.file-card');
    const expectedCount = files.filter(f => !f.isBinary && !f.isSkipped).length;
    expect(fileCards.length).toBe(expectedCount);
  });
});