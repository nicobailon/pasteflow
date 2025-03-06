import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ApplyChangesModal } from '../components/ApplyChangesModal';

// Mock the electron IPC renderer
const mockSend = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();

// Sample XML for testing
const testXml = `
<changed_files>
  <file>
    <file_summary>Update button styles in SearchBar component</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/SearchBar.tsx</file_path>
    <file_code>
import React, { useState } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  placeholder?: string;
}

const SearchBar = ({
  searchTerm,
  onSearchChange,
  placeholder = "Search...",
}: SearchBarProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className={\`search-bar \${isFocused ? "focused" : ""}\`}>
      <div className="search-icon">
        <Search size={16} />
      </div>
      <input
        type="text"
        className="search-input"
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />
      {searchTerm && (
        <button
          className="search-clear-btn improved"
          onClick={() => onSearchChange("")}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
    </file_code>
  </file>
</changed_files>
`;

// Setup global mocks
beforeEach(() => {
  // Reset mocks
  mockSend.mockReset();
  mockOn.mockReset();
  mockRemoveListener.mockReset();
  
  // Setup window.electron mock
  window.electron = {
    ipcRenderer: {
      send: mockSend,
      on: mockOn,
      removeListener: mockRemoveListener
    }
  };
});

describe('ApplyChangesModal', () => {
  const mockOnClose = jest.fn();
  const selectedFolder = '/test/project/path';
  
  test('renders correctly with the selected folder', () => {
    render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Check if the modal title is rendered
    expect(screen.getByText('Apply XML Changes')).toBeInTheDocument();
    
    // Check if the selected folder is displayed
    expect(screen.getByText(selectedFolder)).toBeInTheDocument();
    
    // Check if the textarea is rendered
    expect(screen.getByPlaceholderText('Paste XML here...')).toBeInTheDocument();
    
    // Check if buttons are rendered
    expect(screen.getByText('Apply Changes')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });
  
  test('shows error when trying to apply without XML', () => {
    render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Try to apply without entering XML
    fireEvent.click(screen.getByText('Apply Changes'));
    
    // The Apply Changes button should be disabled when there's no XML
    expect(screen.getByText('Apply Changes').closest('button')).toBeDisabled();
    
    // Verify that ipcRenderer.send was not called
    expect(mockSend).not.toHaveBeenCalled();
  });
  
  test('sends XML to main process when Apply Changes is clicked', () => {
    render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Enter XML in the textarea
    const textarea = screen.getByPlaceholderText('Paste XML here...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: testXml } });
    
    // Click Apply Changes button
    fireEvent.click(screen.getByText('Apply Changes'));
    
    // Check if status message is displayed
    expect(screen.getByText('Applying changes...')).toBeInTheDocument();
    
    // Verify that ipcRenderer.send was called with the correct arguments
    expect(mockSend).toHaveBeenCalledWith('apply-changes', {
      xml: testXml,
      projectDirectory: selectedFolder
    });
  });
  
  test('handles successful response from main process', async () => {
    render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Simulate successful response from main process
    const successCallback = mockOn.mock.calls.find(call => call[0] === 'apply-changes-response')?.[1];
    
    // Enter XML in the textarea
    const textarea = screen.getByPlaceholderText('Paste XML here...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: testXml } });
    
    // Click Apply Changes button
    fireEvent.click(screen.getByText('Apply Changes'));
    
    // Trigger the success callback
    if (successCallback) {
      act(() => {
        successCallback({ success: true, message: 'All changes applied successfully' });
      });
    }
    
    // Check if success message is displayed
    await waitFor(() => {
      expect(screen.getByText('Success: All changes applied successfully')).toBeInTheDocument();
    });
    
    // Check if XML input is cleared
    expect(textarea.value).toBe('');
  });
  
  test('handles error response from main process', async () => {
    render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Simulate error response from main process
    const errorCallback = mockOn.mock.calls.find(call => call[0] === 'apply-changes-response')?.[1];
    
    // Enter XML in the textarea
    const textarea = screen.getByPlaceholderText('Paste XML here...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: testXml } });
    
    // Click Apply Changes button
    fireEvent.click(screen.getByText('Apply Changes'));
    
    // Trigger the error callback
    if (errorCallback) {
      act(() => {
        errorCallback({ success: false, error: 'Invalid XML format' });
      });
    }
    
    // Check if error message is displayed
    await waitFor(() => {
      expect(screen.getByText('Error: Invalid XML format')).toBeInTheDocument();
    });
    
    // Check if XML input is not cleared
    expect(textarea.value).toBe(testXml);
  });
  
  test('closes the modal when Close button is clicked', () => {
    render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Click Close button
    fireEvent.click(screen.getByText('Close'));
    
    // Verify that onClose was called
    expect(mockOnClose).toHaveBeenCalled();
  });
  
  test('removes event listener on unmount', () => {
    const { unmount } = render(<ApplyChangesModal selectedFolder={selectedFolder} onClose={mockOnClose} />);
    
    // Unmount the component
    unmount();
    
    // Verify that removeListener was called
    expect(mockRemoveListener).toHaveBeenCalledWith('apply-changes-response', expect.any(Function));
  });
});

// Add TypeScript declaration for the window.electron object
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, data?: any) => void;
        on: (channel: string, func: (...args: any[]) => void) => void;
        removeListener: (channel: string, func: (...args: any[]) => void) => void;
      };
    };
  }
} 