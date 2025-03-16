import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FileData, FileViewModalProps, SelectedFileWithLines } from '../types/FileTypes';

// Mock the Modal component and setAppElement before importing FileViewModal
jest.mock('react-modal', () => {
  return {
    __esModule: true,
    default: ({ isOpen, onRequestClose, children, contentLabel, className, overlayClassName }: any) => {
      if (!isOpen) return null;
      return (
        <div data-testid="modal" aria-modal="true" aria-label={contentLabel} className={className}>
          {children}
        </div>
      );
    },
    setAppElement: jest.fn()
  };
});

// Now import FileViewModal after mocking react-modal
import FileViewModal from '../components/FileViewModal';

// Mock theme context
jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ currentTheme: 'light' }),
}));

// Mock the syntax highlighter to avoid issues with its implementation
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: any }) => (
    <pre data-testid="syntax-highlighter">{children}</pre>
  ),
}));

jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  Check: () => <div data-testid="check-icon" />,
  Trash: () => <div data-testid="trash-icon" />,
  CheckSquare: () => <div data-testid="check-square-icon" />,
  Square: () => <div data-testid="square-icon" />,
  X: () => <div data-testid="x-icon" />
}));

describe('FileViewModal Component', () => {
  // Test data
  const testFile: FileData = {
    name: 'test.js',
    path: '/path/to/test.js',
    content: 'const test = "Hello World";\nconst foo = "bar";\nconst baz = true;\nconsole.log(test);',
    tokenCount: 20,
    size: 100,
    isBinary: false,
    isSkipped: false
  };
  
  const allFiles: FileData[] = [testFile];
  
  // Mock props and handlers
  const mockOnClose = jest.fn();
  const mockOnUpdateSelectedFile = jest.fn();
  
  const defaultProps: FileViewModalProps = {
    isOpen: true,
    onClose: mockOnClose,
    filePath: '/path/to/test.js',
    allFiles,
    selectedFile: undefined,
    onUpdateSelectedFile: mockOnUpdateSelectedFile
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders correctly when open', () => {
    render(<FileViewModal {...defaultProps} />);
    
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByText('test.js')).toBeInTheDocument();
    expect(screen.getByText(/const test = "Hello World";/)).toBeInTheDocument();
  });
  
  it('does not render when closed', () => {
    render(<FileViewModal {...{ ...defaultProps, isOpen: false }} />);
    
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });
  
  it('calls onClose when close button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    const closeButton = screen.getByTitle('Close');
    fireEvent.click(closeButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
  
  it('calls onClose when cancel button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
  
  test.skip('defaults to entire file selection mode', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Find the label text that indicates entire file selection
    const entireFileRadio = screen.getByLabelText('Entire file');
    expect(entireFileRadio).toBeInTheDocument();
    
    // Check that "Selection: Entire file" text is shown
    expect(screen.getByText('Selection:')).toBeInTheDocument();
    expect(screen.getByText('Entire file')).toBeInTheDocument();
  });
  
  test.skip('switches to specific lines mode when radio is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Initially in entire file mode - check radio button is checked
    const entireFileRadio = screen.getByLabelText('Entire file');
    expect(entireFileRadio).toHaveAttribute('checked');
    
    // Click to switch modes
    const specificLinesRadio = screen.getByLabelText('Specific lines');
    fireEvent.click(specificLinesRadio);
    
    // Now should be in specific lines mode
    expect(specificLinesRadio).toHaveAttribute('checked');
    expect(screen.getByText('Selection:')).toBeInTheDocument();
    expect(screen.getByText('Entire file')).toBeInTheDocument(); // Still shows this for empty selection
  });
  
  it('shows selection tools when in specific lines mode', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Switch to specific lines mode
    const specificLinesRadio = screen.getByLabelText('Specific lines');
    fireEvent.click(specificLinesRadio);
    
    // Now should see the selection tools
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });
  
  test.skip('applies entire file selection when Apply button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Ensure we're in entire file mode by checking the radio button
    const entireFileRadio = screen.getByLabelText('Entire file');
    expect(entireFileRadio).toHaveAttribute('checked');
    
    // Click Apply button
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);
    
    // Check that onUpdateSelectedFile was called with the entire file
    expect(mockOnUpdateSelectedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/path/to/test.js',
        content: testFile.content,
        isFullFile: true
      })
    );
    
    // Check that onClose was called
    expect(mockOnClose).toHaveBeenCalled();
  });
  
  it('selects all lines when "Select All" button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Switch to specific lines mode
    const specificLinesRadio = screen.getByLabelText('Specific lines');
    fireEvent.click(specificLinesRadio);
    
    // Click "Select All" button
    const selectAllButton = screen.getByText('Select All');
    fireEvent.click(selectAllButton);
    
    // Should show that we're selecting entire file
    expect(screen.getByText('(Entire File)')).toBeInTheDocument();
    
    // Click Apply button
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);
    
    // Check that onUpdateSelectedFile was called with all lines
    expect(mockOnUpdateSelectedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/path/to/test.js',
        lines: expect.arrayContaining([expect.objectContaining({ start: 1 })]),
        isFullFile: false
      })
    );
  });
  
  it('clears selection when "Clear" button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Switch to specific lines mode
    const specificLinesRadio = screen.getByLabelText('Specific lines');
    fireEvent.click(specificLinesRadio);
    
    // Select all lines first
    const selectAllButton = screen.getByText('Select All');
    fireEvent.click(selectAllButton);
    
    // There should be a selection
    expect(screen.getByText('(Entire File)')).toBeInTheDocument();
    
    // Now clear the selection
    const clearButton = screen.getByText('Clear');
    fireEvent.click(clearButton);
    
    // Selection should be cleared
    expect(screen.queryByText('(Entire File)')).not.toBeInTheDocument();
  });
  
  test.skip('loads with specific lines pre-selected if provided in selectedFile prop', () => {
    const selectedFile: SelectedFileWithLines = {
      path: '/path/to/test.js',
      content: testFile.content,
      tokenCount: 15,
      lines: [{ start: 2, end: 3 }],
      isFullFile: false
    };
    
    render(<FileViewModal {...defaultProps} selectedFile={selectedFile} />);
    
    // Should be in specific lines mode
    const specificLinesRadio = screen.getByLabelText('Specific lines');
    expect(specificLinesRadio).toHaveAttribute('checked');
    
    // Should show the selected lines
    expect(screen.getByText('Selection: Lines 2-3')).toBeInTheDocument();
  });
  
  it('loads with entire file pre-selected if isFullFile is true in selectedFile prop', () => {
    const selectedFile: SelectedFileWithLines = {
      path: '/path/to/test.js',
      content: testFile.content,
      tokenCount: 20,
      isFullFile: true
    };
    
    render(<FileViewModal {...defaultProps} selectedFile={selectedFile} />);
    
    // Should be in entire file mode
    const entireFileRadio = screen.getByLabelText('Entire file');
    expect(entireFileRadio).toHaveAttribute('checked');
  });
  
  it('shows "Reset" button when there was a previous selection', () => {
    const selectedFile: SelectedFileWithLines = {
      path: '/path/to/test.js',
      content: testFile.content,
      tokenCount: 15,
      lines: [{ start: 2, end: 3 }],
      isFullFile: false
    };
    
    render(<FileViewModal {...defaultProps} selectedFile={selectedFile} />);
    
    // Should show Reset button
    expect(screen.getByText('Reset')).toBeInTheDocument();
    
    // Clear the selection
    const clearButton = screen.getByText('Clear');
    fireEvent.click(clearButton);
    
    // Click Reset to restore original selection
    const resetButton = screen.getByText('Reset');
    fireEvent.click(resetButton);
    
    // Original selection should be restored
    expect(screen.getByText('Selection: Lines 2-3')).toBeInTheDocument();
  });
  
  it('handles empty file content gracefully', () => {
    const emptyFile: FileData = {
      ...testFile,
      content: '',
      tokenCount: 0
    };
    
    render(
      <FileViewModal 
        {...defaultProps} 
        allFiles={[emptyFile]} 
        filePath="/path/to/test.js" 
      />
    );
    
    // Should render without errors
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    
    // Apply button should still work (we'll just check that it doesn't error)
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);
    
    // Verify it was called
    expect(mockOnUpdateSelectedFile).toHaveBeenCalled();
  });
}); 