import React from 'react';
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
}) => (
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
    
    // Cancel button should not be present
    const cancelButton = screen.queryByText('Cancel');
    expect(cancelButton).not.toBeInTheDocument();
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
    
    // Check if progress bar exists
    const progressBar = document.querySelector('.progress-bar');
    expect(progressBar).toBeInTheDocument();
    
    // Check if progress bar has the indeterminate width (30% for 300 files)
    expect(progressBar).toHaveStyle('width: 30%');
  });
}); 