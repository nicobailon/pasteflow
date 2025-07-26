import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the App component to test just the processing indicator
const MockProcessingIndicator = ({ 
  status,
  message,
  processed = 0,
  directories = 0,
  total = 0,
  onCancel
}: {
  status: "idle" | "processing" | "complete" | "error";
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
  onCancel: () => void;
}) => {
  return (
    <div className="processing-indicator">
      <div className="spinner"></div>
      <span>{message}</span>
      {processed !== undefined && (
        <div className="progress-bar-container">
          <div 
            className="progress-bar" 
            style={{ 
              width: total ? 
                `${Math.min((processed / total) * 100, 100)}%` :
                `${Math.min(processed * 0.1, 100)}%` 
            }}
          />
          <span className="progress-details">
            {processed.toLocaleString()} files
            {directories ? ` · ${directories.toLocaleString()} directories` : ''}
          </span>
        </div>
      )}
      {status === "processing" && (
        <button 
          className="cancel-button"
          onClick={onCancel}
        >
          Cancel
        </button>
      )}
    </div>
  );
};

describe('File Loading Progress UI', () => {
  it('should render the processing indicator with progress details', () => {
    const handleCancel = jest.fn();
    
    render(
      <MockProcessingIndicator 
        status="processing"
        message="Loading files..."
        processed={500}
        directories={30}
        total={1000}
        onCancel={handleCancel}
      />
    );
    
    // Check if the message is displayed
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
    
    // Check if progress details are displayed
    expect(screen.getByText(/500 files/)).toBeInTheDocument();
    expect(screen.getByText(/30 directories/)).toBeInTheDocument();
    
    // Check if progress bar exists
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toBeInTheDocument();
    
    // Check if progress bar has correct width (50%)
    expect(progressBar).toHaveStyle('width: 50%');
  });
  
  it('should call onCancel when cancel button is clicked', () => {
    const handleCancel = jest.fn();
    
    render(
      <MockProcessingIndicator 
        status="processing"
        message="Loading files..."
        processed={100}
        directories={10}
        onCancel={handleCancel}
      />
    );
    
    // Find and click the cancel button
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    // Check if the cancel handler was called
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
  
  it('should not show cancel button when processing is complete', () => {
    const handleCancel = jest.fn();
    
    render(
      <MockProcessingIndicator 
        status="complete"
        message="Loaded 1000 files"
        processed={1000}
        directories={50}
        total={1000}
        onCancel={handleCancel}
      />
    );
    
    // ASSERTION 1: Cancel button should not be present
    const cancelButton = screen.queryByText('Cancel');
    expect(cancelButton).not.toBeInTheDocument();
    
    // ASSERTION 2: Completion message should be displayed
    expect(screen.getByText('Loaded 1000 files')).toBeInTheDocument();
    
    // ASSERTION 3: Progress bar should show 100% completion
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toHaveStyle('width: 100%');
    
    // ASSERTION 4: All file and directory counts should be displayed
    expect(screen.getByText(/1,000 files/)).toBeInTheDocument();
    expect(screen.getByText(/50 directories/)).toBeInTheDocument();
  });
  
  it('should not show cancel button when there is an error', () => {
    const handleCancel = jest.fn();
    
    render(
      <MockProcessingIndicator 
        status="error"
        message="Error loading files"
        onCancel={handleCancel}
      />
    );
    
    // Cancel button should not be present
    const cancelButton = screen.queryByText('Cancel');
    expect(cancelButton).not.toBeInTheDocument();
  });
  
  it('should display indeterminate progress when total is not provided', () => {
    const handleCancel = jest.fn();
    
    render(
      <MockProcessingIndicator 
        status="processing"
        message="Loading files..."
        processed={300}
        directories={25}
        onCancel={handleCancel}
      />
    );
    
    // ASSERTION 1: Check if progress bar exists
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toBeInTheDocument();
    
    // ASSERTION 2: Check if progress bar has the indeterminate width (30% for 300 files)
    expect(progressBar).toHaveStyle('width: 30%');
    
    // ASSERTION 3: Verify processing message is displayed
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
    
    // ASSERTION 4: Verify file and directory counts are shown
    expect(screen.getByText(/300 files/)).toBeInTheDocument();
    expect(screen.getByText(/25 directories/)).toBeInTheDocument();
    
    // ASSERTION 5: Cancel button should be present during processing
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});

describe('File Loading Error States', () => {
  it('should display error message when file loading fails', async () => {
    const mockOnCancel = jest.fn();
    
    render(
      <MockProcessingIndicator
        status="error"
        message="Permission denied accessing directory"
        processed={10}
        total={100}
        onCancel={mockOnCancel}
      />
    );
    
    // Verify error state display
    expect(screen.getByText(/Permission denied accessing directory/i)).toBeInTheDocument(); // 1. Specific error message
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();                         // 2. Cancel button hidden on error
    
    // Verify progress information is still shown
    const progressDetails = screen.getByText(/10 files/);
    expect(progressDetails).toBeInTheDocument();                                          // 3. Progress at error point
    
    // Verify progress bar shows partial progress
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toBeInTheDocument();                                             // 4. Progress bar present
    expect(progressBar).toHaveStyle('width: 10%');                                       // 5. Shows 10% progress
  });
  
  it('should display different error types appropriately', () => {
    const errorScenarios = [
      { message: 'Network error: Unable to connect', expectedText: /network error/i },
      { message: 'Invalid directory path', expectedText: /invalid directory/i },
      { message: 'Access denied: Insufficient permissions', expectedText: /access denied/i },
      { message: 'Disk full: Cannot process files', expectedText: /disk full/i }
    ];
    
    errorScenarios.forEach(({ message, expectedText }) => {
      const { unmount } = render(
        <MockProcessingIndicator
          status="error"
          message={message}
          processed={0}
          total={0}
          onCancel={jest.fn()}
        />
      );
      
      // Verify specific error message is displayed
      expect(screen.getByText(expectedText)).toBeInTheDocument();
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
      
      unmount();
    });
  });
  
  it('should handle error state with partial progress information', () => {
    const mockOnCancel = jest.fn();
    
    render(
      <MockProcessingIndicator
        status="error"
        message="Processing interrupted: Memory limit exceeded"
        processed={750}
        directories={45}
        total={1500}
        onCancel={mockOnCancel}
      />
    );
    
    // Verify error message
    expect(screen.getByText(/Memory limit exceeded/i)).toBeInTheDocument();              // 1. Error message shown
    
    // Verify partial progress is displayed
    expect(screen.getByText(/750 files/)).toBeInTheDocument();                         // 2. Files processed shown
    expect(screen.getByText(/45 directories/)).toBeInTheDocument();                    // 3. Directories shown
    
    // Verify progress bar shows correct partial progress (50%)
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toHaveStyle('width: 50%');                                     // 4. Progress bar at 50%
    
    // Verify no cancel button in error state
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();                      // 5. No cancel button
  });
  
  it('should transition from processing to error state', () => {
    const mockOnCancel = jest.fn();
    
    const { rerender } = render(
      <MockProcessingIndicator
        status="processing"
        message="Loading files..."
        processed={500}
        total={1000}
        onCancel={mockOnCancel}
      />
    );
    
    // Verify initial processing state
    expect(screen.getByText('Loading files...')).toBeInTheDocument();                  // 1. Processing message
    expect(screen.getByText('Cancel')).toBeInTheDocument();                           // 2. Cancel button present
    
    // Transition to error state
    rerender(
      <MockProcessingIndicator
        status="error"
        message="Error: File system access failed"
        processed={500}
        total={1000}
        onCancel={mockOnCancel}
      />
    );
    
    // Verify error state
    expect(screen.getByText(/File system access failed/i)).toBeInTheDocument();       // 3. Error message shown
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();                     // 4. Cancel button removed
    expect(screen.getByText(/500 files/)).toBeInTheDocument();                       // 5. Progress preserved
  });
  
  it('should display error state without progress information', () => {
    render(
      <MockProcessingIndicator
        status="error"
        message="Fatal error: Unable to initialize file processor"
        onCancel={jest.fn()}
      />
    );
    
    // Verify error message without progress
    expect(screen.getByText(/Fatal error/i)).toBeInTheDocument();                     // 1. Error message
    expect(screen.getByText(/Unable to initialize/i)).toBeInTheDocument();            // 2. Full error text
    
    // The mock component shows "0 files" when processed is 0 (default)
    // Check that it shows minimal progress info
    expect(screen.getByText(/0 files/)).toBeInTheDocument();                         // 3. Shows 0 files
    expect(screen.queryByText(/directories/)).not.toBeInTheDocument();               // 4. No directory count
    
    // Progress bar should exist but be at 0%
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toBeInTheDocument();                                          // 5. Progress bar exists
    expect(progressBar).toHaveStyle('width: 0%');                                    // 6. Progress at 0%
  });
  
  it('should handle cancellation callback properly in error state', () => {
    const mockOnCancel = jest.fn();
    
    render(
      <MockProcessingIndicator
        status="error"
        message="Operation failed"
        processed={100}
        total={200}
        onCancel={mockOnCancel}
      />
    );
    
    // Try to find and click where cancel button would be
    const processingIndicator = document.querySelector('.processing-indicator');
    expect(processingIndicator).toBeInTheDocument();                                  // 1. Component rendered
    
    // Verify cancel button is not present
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();                    // 2. No cancel button
    
    // Verify onCancel is never called in error state
    fireEvent.click(processingIndicator!);
    expect(mockOnCancel).not.toHaveBeenCalled();                                    // 3. Handler not called
  });
}); 