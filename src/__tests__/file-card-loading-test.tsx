import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import FileCard from '../components/file-card';
import { FileData, SelectedFileWithLines } from '../types/file-types';

describe('FileCard Loading States', () => {
  const mockLoadFileContent = jest.fn();
  const mockToggleSelection = jest.fn();
  const mockOnViewFile = jest.fn();

  const baseFile: FileData = {
    name: 'test.ts',
    path: '/test/test.ts',
    isDirectory: false,
    size: 1000,
    isBinary: false,
    isSkipped: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should display loading state when content is not loaded', () => {
    const file: FileData = {
      ...baseFile,
      isContentLoaded: false,
    };

    render(
      <FileCard
        file={file}
        selectedFile={undefined}
        toggleSelection={mockToggleSelection}
        onViewFile={mockOnViewFile}
        loadFileContent={mockLoadFileContent}
      />
    );

    // Should show loading indicator
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    
    // Should trigger content loading
    expect(mockLoadFileContent).toHaveBeenCalledWith('/test/test.ts');
  });

  it('should display error state when content loading fails', () => {
    const file: FileData = {
      ...baseFile,
      isContentLoaded: false,
      error: 'Failed to load file',
    };

    render(
      <FileCard
        file={file}
        selectedFile={undefined}
        toggleSelection={mockToggleSelection}
        onViewFile={mockOnViewFile}
        loadFileContent={mockLoadFileContent}
      />
    );

    // Should show error message
    expect(screen.getByText('Error loading')).toBeInTheDocument();
    
    // Should not trigger content loading when there's an error
    expect(mockLoadFileContent).not.toHaveBeenCalled();
  });

  it('should display token count when content is loaded', () => {
    const file: FileData = {
      ...baseFile,
      isContentLoaded: true,
      content: 'const test = "hello world";',
      tokenCount: 42,
    };

    const selectedFile: SelectedFileWithLines = {
      path: '/test/test.ts',
      isFullFile: true,
      isContentLoaded: true,
      tokenCount: 42,
    };

    render(
      <FileCard
        file={file}
        selectedFile={selectedFile}
        toggleSelection={mockToggleSelection}
        onViewFile={mockOnViewFile}
        loadFileContent={mockLoadFileContent}
      />
    );

    // Should show token count
    expect(screen.getByText('~42 tokens')).toBeInTheDocument();
    
    // Should not trigger content loading when already loaded
    expect(mockLoadFileContent).not.toHaveBeenCalled();
  });

  it('should display counting tokens state', () => {
    const file: FileData = {
      ...baseFile,
      isContentLoaded: true,
      content: 'const test = "hello world";',
      isCountingTokens: true,
    };

    const selectedFile: SelectedFileWithLines = {
      path: '/test/test.ts',
      isFullFile: true,
      isContentLoaded: true,
      isCountingTokens: true,
    };

    render(
      <FileCard
        file={file}
        selectedFile={selectedFile}
        toggleSelection={mockToggleSelection}
        onViewFile={mockOnViewFile}
        loadFileContent={mockLoadFileContent}
      />
    );

    // Should show counting tokens state
    expect(screen.getByText('Counting tokens...')).toBeInTheDocument();
  });

  it('should display token count error state', () => {
    const file: FileData = {
      ...baseFile,
      isContentLoaded: true,
      tokenCountError: 'Failed to count tokens',
    };

    const selectedFile: SelectedFileWithLines = {
      path: '/test/test.ts',
      isFullFile: true,
      isContentLoaded: true,
      tokenCountError: 'Failed to count tokens',
    };

    render(
      <FileCard
        file={file}
        selectedFile={selectedFile}
        toggleSelection={mockToggleSelection}
        onViewFile={mockOnViewFile}
        loadFileContent={mockLoadFileContent}
      />
    );

    // Should show specific error message
    expect(screen.getByText('Failed to count tokens')).toBeInTheDocument();
  });

  it('should handle line range selection display', () => {
    const file: FileData = {
      ...baseFile,
      isContentLoaded: true,
      content: 'line1\nline2\nline3\nline4\nline5',
      tokenCount: 10,
    };

    const selectedFile: SelectedFileWithLines = {
      path: '/test/test.ts',
      lines: [{ start: 2, end: 4 }],
      isFullFile: false,
      isContentLoaded: true,
      tokenCount: 3, // Token count for the selected lines
    };

    render(
      <FileCard
        file={file}
        selectedFile={selectedFile}
        toggleSelection={mockToggleSelection}
        onViewFile={mockOnViewFile}
        loadFileContent={mockLoadFileContent}
      />
    );

    // Should show token count for line range
    expect(screen.getByText('~3 tokens')).toBeInTheDocument();
    
    // Should display line range info
    expect(screen.getByText(/Lines 2-4/)).toBeInTheDocument();
  });
});