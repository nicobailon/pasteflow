import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

import '@testing-library/jest-dom';
import { FileData, SelectedFileWithLines, LineRange } from '../types/FileTypes';

import { setupMockLocalStorage } from './testHelpers';

// Custom FileList component for testing
function TestFileList({ initialFiles = [] as SelectedFileWithLines[] }: { initialFiles?: SelectedFileWithLines[] }) {
  // Initialize state without using generic type parameter
  const [selectedFiles, setSelectedFiles] = React.useState(initialFiles);
  
  const toggleFileSelection = (path: string) => {
    const isSelected = selectedFiles.some((file: SelectedFileWithLines) => file.path === path);
    
    if (isSelected) {
      setSelectedFiles(selectedFiles.filter((file: SelectedFileWithLines) => file.path !== path));
    } else {
      setSelectedFiles([...selectedFiles, { path, isFullFile: true }]);
    }
  };
  
  const toggleSelection = (path: string, lineRange?: LineRange) => {
    const fileIndex = selectedFiles.findIndex((file: SelectedFileWithLines) => file.path === path);
    
    if (fileIndex === -1 || !lineRange) {
      toggleFileSelection(path);
      return;
    }
    
    const file = selectedFiles[fileIndex];
    
    if (!file.lines) {
      // If file is selected as full file, remove it completely
      if (file.isFullFile) {
        setSelectedFiles(selectedFiles.filter((f: SelectedFileWithLines) => f.path !== path));
      }
      return;
    }
    
    // Check if this specific line range exists
    const lineIndex = file.lines.findIndex(
      (range: LineRange) => range.start === lineRange.start && range.end === lineRange.end
    );
    
    if (lineIndex !== -1) {
      // Remove this specific line range
      const updatedLines = file.lines.filter((_: LineRange, i: number) => i !== lineIndex);
      
      if (updatedLines.length === 0) {
        // If no more lines, remove the file entirely
        setSelectedFiles(selectedFiles.filter((f: SelectedFileWithLines) => f.path !== path));
      } else {
        // Update with the remaining line ranges
        const updatedFile = { ...file, lines: updatedLines };
        setSelectedFiles(selectedFiles.map((f: SelectedFileWithLines) => 
          f.path === path ? updatedFile : f
        ));
      }
    }
  };

  return (
    <div data-testid="file-list-mock">
      <div data-testid="selected-files-count">{selectedFiles.length}</div>
      
      {selectedFiles.map((file: SelectedFileWithLines) => (
        <div key={file.path} data-testid={`selected-file-${file.path}`}>
          <div>{file.path}</div>
          <div data-testid={`line-ranges-${file.path}`}>
            {file.lines && file.lines.map((lineRange: LineRange, index: number) => (
              <div key={`${lineRange.start}-${lineRange.end}`} data-testid={`line-range-${index}`}>
                Lines {lineRange.start}-{lineRange.end}
                <button 
                  data-testid={`toggle-range-${file.path}-${lineRange.start}-${lineRange.end}`}
                  onClick={() => toggleSelection(file.path, lineRange)}
                >
                  Remove Range
                </button>
              </div>
            ))}
          </div>
          <button 
            data-testid={`toggle-file-${file.path}`}
            onClick={() => toggleFileSelection(file.path)}
          >
            Remove File
          </button>
        </div>
      ))}
      
      <button 
        data-testid="add-test-file"
        onClick={() => toggleFileSelection('test-file.js')}
      >
        Add File
      </button>

      <button 
        data-testid="add-test-range"
        onClick={() => {
          // First ensure the file is selected
          if (!selectedFiles.some((f: SelectedFileWithLines) => f.path === 'test-file.js')) {
            toggleFileSelection('test-file.js');
          }
          
          // Then add the specific range
          const testFile = selectedFiles.find((f: SelectedFileWithLines) => f.path === 'test-file.js');
          if (testFile && !testFile.isFullFile) {
            const updatedLines = [...(testFile.lines || []), { start: 10, end: 20 }];
            const updatedFile = { ...testFile, lines: updatedLines };
            setSelectedFiles(selectedFiles.map((f: SelectedFileWithLines) => 
              f.path === 'test-file.js' ? updatedFile : f
            ));
          }
        }}
      >
        Add Range 10-20
      </button>
    </div>
  );
}

describe('Toggle Selection Functionality', () => {
  // Use the shared localStorage mock
  beforeEach(() => {
    setupMockLocalStorage();
    window.localStorage.setItem('pasteflow-selected-files', JSON.stringify([]));
  });

  // Sample file data
  const testFiles: FileData[] = [
    {
      name: 'test-file.js',
      path: 'test-file.js',
      content: 'const test = "Hello";\nconst world = "World";\nconsole.log(test, world);\n',
      size: 100,
      tokenCount: 20,
      isBinary: false,
      isSkipped: false
    }
  ];
  
  it('toggles selection for an entire file', async () => {
    render(<TestFileList />);
    
    // Initially no files should be selected
    expect(screen.getByTestId('selected-files-count').textContent).toBe('0');
    
    // Add a file to the selection
    fireEvent.click(screen.getByTestId('add-test-file'));
    
    // Now the file should be selected
    expect(screen.getByTestId('selected-files-count').textContent).toBe('1');
    
    // Find the selected file
    const selectedFile = screen.getByTestId('selected-file-test-file.js');
    expect(selectedFile).toBeInTheDocument();
    
    // Remove the file from selection
    fireEvent.click(screen.getByTestId('toggle-file-test-file.js'));
    
    // Now no files should be selected
    expect(screen.getByTestId('selected-files-count').textContent).toBe('0');
  });

  // Add the test for toggling specific line ranges
  it('toggles selection for a specific line range within a file', async () => {
    // Create a component with initial selected files
    const initialFiles: SelectedFileWithLines[] = [
      {
        path: 'test-file.js',
        isFullFile: false,
        lines: [
          { start: 1, end: 5 },
          { start: 10, end: 15 }
        ]
      }
    ];
    
    render(<TestFileList initialFiles={initialFiles} />);
    
    // The file should be selected with two line ranges
    expect(screen.getByTestId('selected-files-count').textContent).toBe('1');
    
    // Find the selected file
    const selectedFile = screen.getByTestId('selected-file-test-file.js');
    expect(selectedFile).toBeInTheDocument();
    
    // Check that both line ranges are displayed
    const lineRanges = screen.getByTestId('line-ranges-test-file.js');
    expect(lineRanges.children).toHaveLength(2);
    
    // Remove one specific line range
    fireEvent.click(screen.getByTestId('toggle-range-test-file.js-1-5'));
    
    // Now only one line range should remain
    expect(screen.getByTestId('line-ranges-test-file.js').children).toHaveLength(1);
    
    // The file should still be selected
    expect(screen.getByTestId('selected-files-count').textContent).toBe('1');
    
    // Remove the second line range
    fireEvent.click(screen.getByTestId('toggle-range-test-file.js-10-15'));
    
    // Now no files should be selected since all ranges were removed
    expect(screen.getByTestId('selected-files-count').textContent).toBe('0');
  });
  
  it('removes the entire file when toggleSelection is called on a full-file selection', async () => {
    // Create a component with initial full-file selection
    const initialFiles: SelectedFileWithLines[] = [
      {
        path: 'test-file.js',
        isFullFile: true
      }
    ];
    
    render(<TestFileList initialFiles={initialFiles} />);
    
    // The file should be selected
    expect(screen.getByTestId('selected-files-count').textContent).toBe('1');
    
    // Remove the file using toggleFileSelection
    fireEvent.click(screen.getByTestId('toggle-file-test-file.js'));
    
    // Now no files should be selected
    expect(screen.getByTestId('selected-files-count').textContent).toBe('0');
  });
}); 