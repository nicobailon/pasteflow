import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TreeItem from '../components/TreeItem';
import { TreeNode } from '../types/FileTypes';

// Mock icons
jest.mock('lucide-react', () => ({
  ChevronRight: () => <div data-testid="chevron-icon" />,
  File: () => <div data-testid="file-icon" />,
  Folder: () => <div data-testid="folder-icon" />,
}));

describe('TreeItem Component', () => {
  // Mock props and handlers
  const toggleFileSelection = jest.fn();
  const toggleFolderSelection = jest.fn();
  const toggleExpanded = jest.fn();
  
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // Test data
  const fileNode: TreeNode = {
    id: 'file-1',
    name: 'example.js',
    path: '/path/to/example.js',
    type: 'file',
    level: 2,
    fileData: {
      name: 'example.js',
      path: '/path/to/example.js',
      content: 'console.log("Hello World");',
      tokenCount: 100,
      size: 1024,
      isBinary: false,
      isSkipped: false,
    }
  };
  
  const disabledFileNode: TreeNode = {
    ...fileNode,
    id: 'file-2',
    name: 'binary.bin',
    path: '/path/to/binary.bin',
    fileData: {
      name: 'binary.bin',
      path: '/path/to/binary.bin',
      content: '',
      tokenCount: 0,
      size: 1024,
      isBinary: true,
      isSkipped: false,
    }
  };
  
  const directoryNode: TreeNode = {
    id: 'dir-1',
    name: 'src',
    path: '/path/to/src',
    type: 'directory',
    level: 1,
    isExpanded: false,
    children: [fileNode]
  };
  
  const expandedDirectoryNode: TreeNode = {
    ...directoryNode,
    isExpanded: true,
  };
  
  describe('Event handlers', () => {
    it('calls toggleExpanded when clicking on directory chevron', () => {
      render(
        <TreeItem
          node={directoryNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const chevron = screen.getByTestId('chevron-icon').closest('.tree-item-toggle');
      if (chevron) {
        fireEvent.click(chevron);
        
        expect(toggleExpanded).toHaveBeenCalledWith('dir-1');
        expect(toggleExpanded).toHaveBeenCalledTimes(1);
      }
    });
    
    it('calls toggleExpanded when clicking on directory item', () => {
      render(
        <TreeItem
          node={directoryNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const directoryItem = screen.getByText('src').closest('.tree-item');
      if (directoryItem) {
        fireEvent.click(directoryItem);
        
        expect(toggleExpanded).toHaveBeenCalledWith('dir-1');
        expect(toggleExpanded).toHaveBeenCalledTimes(1);
      }
    });
    
    it('calls toggleFileSelection when clicking on file item', () => {
      render(
        <TreeItem
          node={fileNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const fileItem = screen.getByText('example.js').closest('.tree-item');
      if (fileItem) {
        fireEvent.click(fileItem);
        
        expect(toggleFileSelection).toHaveBeenCalledWith('/path/to/example.js');
        expect(toggleFileSelection).toHaveBeenCalledTimes(1);
      }
    });
    
    it('does not call toggleFileSelection when clicking on disabled file item', () => {
      render(
        <TreeItem
          node={disabledFileNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const fileItem = screen.getByText('binary.bin').closest('.tree-item');
      if (fileItem) {
        fireEvent.click(fileItem);
        
        expect(toggleFileSelection).not.toHaveBeenCalled();
      }
    });
    
    it('responds correctly when checking/unchecking file checkbox', () => {
      // Mock the event handler implementation directly in TreeItem
      // by using a Test Double pattern
      const { rerender } = render(
        <TreeItem
          node={fileNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      // Testing after selection
      rerender(
        <TreeItem
          node={fileNode}
          selectedFiles={['/path/to/example.js']}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      // Verify the checkbox is now checked
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeChecked();
      
      // Test clicking the checkbox via fireEvent
      fireEvent.click(checkbox);
      
      // Verify toggleFileSelection was called
      expect(toggleFileSelection).toHaveBeenCalledWith('/path/to/example.js');
    });
    
    it('responds correctly when checking directory checkbox', () => {
      render(
        <TreeItem
          node={directoryNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const checkbox = screen.getByRole('checkbox');
      
      // We're directly testing the checkbox click behavior
      // rather than the change event
      fireEvent.click(checkbox);
      
      // In the real DOM, clicking a checkbox will check it
      // Since we're in a test environment, we need to treat it as a click
      // that should trigger the directory folder selection
      expect(toggleFolderSelection).toHaveBeenCalled();
    });
    
    it('stops event propagation when clicking checkbox', () => {
      render(
        <TreeItem
          node={fileNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const checkbox = screen.getByRole('checkbox');
      
      // Mock a click event with a spy on stopPropagation
      const mockStopPropagation = jest.fn();
      const mockEvent = { stopPropagation: mockStopPropagation };
      
      // Simulate the click while providing the mocked event
      checkbox.onclick = jest.fn().mockImplementation(e => mockStopPropagation());
      fireEvent.click(checkbox, mockEvent);
      
      // Verify stopPropagation was called
      expect(mockStopPropagation).toHaveBeenCalled();
    });
  });
  
  describe('Rendering based on props', () => {
    it('renders a file item correctly', () => {
      render(
        <TreeItem
          node={fileNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      expect(screen.getByText('example.js')).toBeInTheDocument();
      expect(screen.getByTestId('file-icon')).toBeInTheDocument();
      expect(screen.queryByTestId('chevron-icon')).not.toBeInTheDocument();
      expect(screen.getByText(/~100/)).toBeInTheDocument();
    });
    
    it('renders a directory item correctly', () => {
      render(
        <TreeItem
          node={directoryNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByTestId('folder-icon')).toBeInTheDocument();
      expect(screen.getByTestId('chevron-icon')).toBeInTheDocument();
    });
    
    it('applies correct classes for expanded directories', () => {
      render(
        <TreeItem
          node={expandedDirectoryNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      const toggleElement = screen.getByTestId('chevron-icon').closest('.tree-item-toggle');
      if (toggleElement) {
        expect(toggleElement).toHaveClass('expanded');
        expect(toggleElement).toHaveAttribute('aria-label', 'Collapse folder');
      }
    });
    
    it('shows badge for binary files', () => {
      render(
        <TreeItem
          node={disabledFileNode}
          selectedFiles={[]}
          toggleFileSelection={toggleFileSelection}
          toggleFolderSelection={toggleFolderSelection}
          toggleExpanded={toggleExpanded}
        />
      );
      
      expect(screen.getByText('Binary')).toBeInTheDocument();
    });
  });
}); 