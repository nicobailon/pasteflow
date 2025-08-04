import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FileData, FileViewModalProps, SelectedFileWithLines } from '../types/file-types';
import FileViewModal from '../components/file-view-modal';

// Mock the ThemeContext
jest.mock('../context/theme-context', () => ({
  useTheme: () => ({ currentTheme: 'light' }),
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
    isSkipped: false,
    isDirectory: false,
    isContentLoaded: true
  };
  
  const allFiles: FileData[] = [testFile];
  
  // Mock props and handlers
  const mockOnClose = jest.fn();
  const mockOnUpdateSelectedFile = jest.fn();
  const mockLoadFileContent = jest.fn().mockResolvedValue(undefined);
  
  const defaultProps: FileViewModalProps = {
    isOpen: true,
    onClose: mockOnClose,
    filePath: '/path/to/test.js',
    allFiles,
    selectedFile: undefined,
    onUpdateSelectedFile: mockOnUpdateSelectedFile,
    loadFileContent: mockLoadFileContent
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders correctly when open', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Check for modal presence by looking for the dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // File name should be in the title
    expect(screen.getByText('test.js')).toBeInTheDocument();
    // File content should be displayed
    expect(screen.getByText(/const test = "Hello World";/)).toBeInTheDocument();
    // In view-only mode (default), the button says "Close" instead of "Apply"
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
  
  it('does not render when closed', () => {
    render(<FileViewModal {...{ ...defaultProps, isOpen: false }} />);
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Verify no content is rendered when modal is closed
    expect(screen.queryByText('test.js')).not.toBeInTheDocument();
  });
  
  it('calls onClose when close button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Get the close button in the header (not the apply button)
    const buttons = screen.getAllByTitle('Close');
    // The first button with title "Close" is the X button in the header
    fireEvent.click(buttons[0]);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    // Verify other handlers were not called
    expect(mockOnUpdateSelectedFile).not.toHaveBeenCalled();
  });
  
  it('calls onClose when cancel button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    // Verify onUpdateSelectedFile was not called when canceling
    expect(mockOnUpdateSelectedFile).not.toHaveBeenCalled();
  });
  
  it('defaults to view only mode when no file is selected', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Find the radio button for view only mode (default)
    const viewOnlyRadio = screen.getByRole('radio', { name: /view only/i });
    expect(viewOnlyRadio).toBeInTheDocument();
    expect(viewOnlyRadio).toBeChecked();
    
    // Check that the other radios exist but are not checked
    const entireFileRadio = screen.getByRole('radio', { name: /select entire file/i });
    expect(entireFileRadio).toBeInTheDocument();
    expect(entireFileRadio).not.toBeChecked();
    
    const specificLinesRadio = screen.getByRole('radio', { name: /select specific lines/i });
    expect(specificLinesRadio).toBeInTheDocument();
    expect(specificLinesRadio).not.toBeChecked();
    
    // Verify selection mode labels are present
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByText('Select entire file')).toBeInTheDocument();
    expect(screen.getByText('Select specific lines')).toBeInTheDocument();
    
    // Verify selection display shows view only mode
    expect(screen.getByText('Viewing file (no selection)')).toBeInTheDocument();
  });
  
  it('switches to specific lines mode when radio is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Initially in view only mode by default
    const viewOnlyRadio = screen.getByRole('radio', { name: /view only/i });
    expect(viewOnlyRadio).toBeChecked();
    
    // Selection should initially show view only
    expect(screen.getByText('Viewing file (no selection)')).toBeInTheDocument();
    
    // Click to switch to specific lines mode
    const specificLinesRadio = screen.getByRole('radio', { name: /specific lines/i });
    fireEvent.click(specificLinesRadio);
    
    // Should show selection tools in specific lines mode
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
    
    // Verify we can now select lines (functional test rather than checking radio state)
    const selectAllButton = screen.getByText('Select All');
    fireEvent.click(selectAllButton);
    
    // Should show that entire file is selected via line selection
    expect(screen.getByText('(Entire File)')).toBeInTheDocument();
  });
  
  it('shows selection tools when in specific lines mode', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Switch to specific lines mode
    const specificLinesRadio = screen.getByRole('radio', { name: /select specific lines/i });
    fireEvent.click(specificLinesRadio);
    
    // Now should see the selection tools
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });
  
  it('applies entire file selection when Apply button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Switch to entire file mode
    const entireFileRadio = screen.getByRole('radio', { name: /entire file/i });
    fireEvent.click(entireFileRadio);
    expect(entireFileRadio).toBeChecked();
    
    // Click Apply button
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);
    
    // Check that onUpdateSelectedFile was called with the entire file
    expect(mockOnUpdateSelectedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/path/to/test.js',
        content: testFile.content,
        isFullFile: true,
        tokenCount: expect.any(Number)
      })
    );
    
    // Check that onClose was called
    expect(mockOnClose).toHaveBeenCalled();
    
    // Verify the handler was called exactly once
    expect(mockOnUpdateSelectedFile).toHaveBeenCalledTimes(1);
  });
  
  it('selects all lines when "Select All" button is clicked', () => {
    render(<FileViewModal {...defaultProps} />);
    
    // Switch to specific lines mode
    const specificLinesRadio = screen.getByRole('radio', { name: /select specific lines/i });
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
    const specificLinesRadio = screen.getByRole('radio', { name: /select specific lines/i });
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
  
  it('loads with specific lines pre-selected if provided in selectedFile prop', () => {
    const selectedFile: SelectedFileWithLines = {
      path: '/path/to/test.js',
      content: testFile.content,
      tokenCount: 15,
      lines: [{ start: 2, end: 3 }],
      isFullFile: false
    };
    
    render(<FileViewModal {...defaultProps} selectedFile={selectedFile} />);
    
    // Should start in view only mode even with pre-selected lines
    const viewOnlyRadio = screen.getByRole('radio', { name: /view only/i });
    expect(viewOnlyRadio).toBeChecked();
    
    // Switch to specific lines mode to see the pre-selected lines
    const specificLinesRadio = screen.getByRole('radio', { name: /select specific lines/i });
    fireEvent.click(specificLinesRadio);
    
    // Should show the selected lines in the selection display
    expect(screen.getByText('Selection: Lines 2-3')).toBeInTheDocument();
    
    // Reset button should be available since there's a previous selection
    expect(screen.getByText('Reset')).toBeInTheDocument();
    
    // Apply button should work with pre-selected lines
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);
    
    expect(mockOnUpdateSelectedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ start: 2, end: 3 }],
        isFullFile: false
      })
    );
  });
  
  it('loads with entire file pre-selected if isFullFile is true in selectedFile prop', () => {
    const selectedFile: SelectedFileWithLines = {
      path: '/path/to/test.js',
      content: testFile.content,
      tokenCount: 20,
      isFullFile: true
    };
    
    render(<FileViewModal {...defaultProps} selectedFile={selectedFile} />);
    
    // Should start in view only mode by default
    const viewOnlyRadio = screen.getByRole('radio', { name: /view only/i });
    expect(viewOnlyRadio).toBeChecked();
    
    // But when we switch to entire file mode, it should be selected
    const entireFileRadio = screen.getByRole('radio', { name: /select entire file/i });
    fireEvent.click(entireFileRadio);
    expect(entireFileRadio).toBeChecked();
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
    
    // First switch to specific lines mode to see the Reset button
    const specificLinesRadio = screen.getByRole('radio', { name: /select specific lines/i });
    fireEvent.click(specificLinesRadio);
    
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
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    
    // In view-only mode, the button says "Close"
    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);
    
    // Verify onClose was called
    expect(mockOnClose).toHaveBeenCalled();
  });
}); 