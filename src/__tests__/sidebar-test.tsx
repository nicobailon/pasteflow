import { fireEvent, render, screen } from '@testing-library/react';

import '@testing-library/jest-dom';
import Sidebar from '../components/sidebar';
import { FileData, SelectedFileWithLines, TreeNode } from '../types/file-types';

// Using shared lucide-react mock from jest.config.js

// Mock the hooks
jest.mock('../hooks/use-file-tree', () => ({
  __esModule: true,
  default: jest.fn(({ expandedNodes }) => {
    // Create a sample file tree based on the test data
    const createTreeNode = (file: FileData, level: number): TreeNode => ({
      id: file.path,
      name: file.name,
      path: file.path,
      type: 'file',
      level,
      fileData: file
    });

    const createDirNode = (path: string, name: string, level: number, children: TreeNode[]): TreeNode => ({
      id: path,
      name,
      path,
      type: 'directory',
      level,
      isExpanded: expandedNodes[path] === true,
      children
    });

    // Build a simple test tree structure
    const dir1 = createDirNode('/root/dir1', 'dir1', 1, [
      createTreeNode({ 
        name: 'file1.js', 
        path: '/root/dir1/file1.js',
        content: 'content1',
        tokenCount: 10,
        size: 100,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      }, 2)
    ]);
    
    const dir2 = createDirNode('/root/dir2', 'dir2', 1, [
      createTreeNode({ 
        name: 'file2.js', 
        path: '/root/dir2/file2.js',
        content: 'content2',
        tokenCount: 20,
        size: 200,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      }, 2)
    ]);
    
    // Add a nested directory to test deeper structures
    const nestedDir = createDirNode('/root/dir3/nested', 'nested', 2, [
      createTreeNode({ 
        name: 'nestedFile.js', 
        path: '/root/dir3/nested/nestedFile.js',
        content: 'nestedContent',
        tokenCount: 30,
        size: 300,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      }, 3)
    ]);
    
    const dir3 = createDirNode('/root/dir3', 'dir3', 1, [
      nestedDir,
      createTreeNode({ 
        name: 'file3.js', 
        path: '/root/dir3/file3.js',
        content: 'content3',
        tokenCount: 40,
        size: 400,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      }, 2)
    ]);

    // Create the fileTree array
    const fileTree = [dir1, dir2, dir3];
    
    // Create the flattened tree based on expanded state
    const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
      let result: TreeNode[] = [];
      
      for (const node of nodes) {
        // Clone node and update isExpanded based on expandedNodes
        const nodeWithUpdatedExpanded = {
          ...node,
          isExpanded: node.type === 'directory' 
            ? (expandedNodes[node.id] === undefined ? node.isExpanded : expandedNodes[node.id])
            : undefined
        };
        
        result.push(nodeWithUpdatedExpanded);
        
        if (nodeWithUpdatedExpanded.type === 'directory' && 
            nodeWithUpdatedExpanded.isExpanded && 
            nodeWithUpdatedExpanded.children) {
          result = [...result, ...flattenTree(nodeWithUpdatedExpanded.children)];
        }
      }
      
      return result;
    };

    // Return the hook result
    return {
      fileTree,
      visibleTree: flattenTree(fileTree),
      isTreeBuildingComplete: true
    };
  })
}));

describe('Sidebar Component', () => {
  // Mock props
  const mockProps = {
    selectedFolder: '/root',
    openFolder: jest.fn(),
    allFiles: [
      { 
        name: 'file1.js', 
        path: '/root/dir1/file1.js',
        content: 'content1',
        tokenCount: 10,
        size: 100,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      },
      { 
        name: 'file2.js', 
        path: '/root/dir2/file2.js',
        content: 'content2',
        tokenCount: 20,
        size: 200,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      },
      { 
        name: 'file3.js', 
        path: '/root/dir3/file3.js',
        content: 'content3',
        tokenCount: 40,
        size: 400,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      },
      { 
        name: 'nestedFile.js', 
        path: '/root/dir3/nested/nestedFile.js',
        content: 'nestedContent',
        tokenCount: 30,
        size: 300,
        isBinary: false,
        isSkipped: false,
        isDirectory: false
      }
    ],
    selectedFiles: [] as SelectedFileWithLines[],
    toggleFileSelection: jest.fn(),
    toggleFolderSelection: jest.fn(),
    searchTerm: '',
    onSearchChange: jest.fn(),
    selectAllFiles: jest.fn(),
    deselectAllFiles: jest.fn(),
    expandedNodes: {},
    toggleExpanded: jest.fn(),
    resetFolderState: jest.fn(),
    onFileTreeSortChange: jest.fn(),
    toggleFilterModal: jest.fn(),
    refreshFileTree: jest.fn(),
    onViewFile: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the sidebar with no expanded folders by default', () => {
    render(<Sidebar {...mockProps} />);
    
    // Check that the folder is present
    expect(screen.getByText('dir1')).toBeInTheDocument();
    expect(screen.getByText('dir2')).toBeInTheDocument();
    expect(screen.getByText('dir3')).toBeInTheDocument();
    
    // Files should not be visible initially since directories are not expanded
    expect(screen.queryByText('file1.js')).not.toBeInTheDocument();
    expect(screen.queryByText('file2.js')).not.toBeInTheDocument();
    expect(screen.queryByText('file3.js')).not.toBeInTheDocument();
    expect(screen.queryByText('nestedFile.js')).not.toBeInTheDocument();
  });

  it('collapses all folders when collapse all button is clicked', async () => {
    // Start with some expanded nodes
    const expandedProps = {
      ...mockProps,
      expandedNodes: {
        '/root/dir1': true,
        '/root/dir2': true,
        '/root/dir3': true
      }
    };
    
    const { rerender } = render(<Sidebar {...expandedProps} />);
    
    // Verify folders are expanded (files are visible)
    expect(screen.getByText('file1.js')).toBeInTheDocument();
    expect(screen.getByText('file2.js')).toBeInTheDocument();
    expect(screen.getByText('file3.js')).toBeInTheDocument();
    
    // Find and click the collapse all button
    const collapseAllButton = screen.getByTitle('Collapse all folders');
    fireEvent.click(collapseAllButton);
    
    // Verify that toggleExpanded was called for each expanded folder
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir1');
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir2');
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir3');
    
    // Update expandedNodes to simulate the state change
    const collapsedProps = {
      ...expandedProps,
      expandedNodes: {}
    };
    
    // Re-render with the updated props
    rerender(<Sidebar {...collapsedProps} />);
    
    // Now files should not be visible
    expect(screen.queryByText('file1.js')).not.toBeInTheDocument();
    expect(screen.queryByText('file2.js')).not.toBeInTheDocument();
    expect(screen.queryByText('file3.js')).not.toBeInTheDocument();
  });

  it('expands all folders when expand all button is clicked', async () => {
    // Start with no expanded nodes
    const { rerender } = render(<Sidebar {...mockProps} />);
    
    // Verify folders are collapsed (files are not visible)
    expect(screen.queryByText('file1.js')).not.toBeInTheDocument();
    expect(screen.queryByText('file2.js')).not.toBeInTheDocument();
    expect(screen.queryByText('file3.js')).not.toBeInTheDocument();
    
    // Find and click the expand all button
    const expandAllButton = screen.getByTitle('Expand all folders');
    fireEvent.click(expandAllButton);
    
    // Verify that toggleExpanded was called for each collapsed folder
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir1');
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir2');
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir3');
    
    // Update expandedNodes to simulate the state change
    const expandedProps = {
      ...mockProps,
      expandedNodes: {
        '/root/dir1': true,
        '/root/dir2': true,
        '/root/dir3': true,
        '/root/dir3/nested': true
      }
    };
    
    // Re-render with the updated props
    rerender(<Sidebar {...expandedProps} />);
    
    // Now files should be visible
    expect(screen.getByText('file1.js')).toBeInTheDocument();
    expect(screen.getByText('file2.js')).toBeInTheDocument();
    expect(screen.getByText('file3.js')).toBeInTheDocument();
    expect(screen.getByText('nestedFile.js')).toBeInTheDocument();
  });

  it('disables collapse all button when no folders are expanded', () => {
    render(<Sidebar {...mockProps} />);
    
    // Find the collapse all button
    const collapseAllButton = screen.getByTitle('Collapse all folders');
    
    // Verify it's disabled
    expect(collapseAllButton).toBeDisabled();
  });

  it('disables expand all button when all folders are already expanded', () => {
    const expandedProps = {
      ...mockProps,
      expandedNodes: {
        '/root/dir1': true,
        '/root/dir2': true,
        '/root/dir3': true,
        '/root/dir3/nested': true
      }
    };
    
    render(<Sidebar {...expandedProps} />);
    
    // Find the expand all button
    const expandAllButton = screen.getByTitle('Expand all folders');
    
    // Verify it's disabled
    expect(expandAllButton).toBeDisabled();
  });

  it('calls toggleExpanded when clicking on a tree item', () => {
    render(<Sidebar {...mockProps} />);
    
    // Find a directory and click it
    const dirItem = screen.getByText('dir1');
    fireEvent.click(dirItem);
    
    // Verify toggleExpanded was called
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir1');
  });

  it('applies expand/collapse to nested folders correctly', async () => {
    // Start with dir3 expanded but nested folder collapsed
    const partiallyExpandedProps = {
      ...mockProps,
      expandedNodes: {
        '/root/dir3': true
      }
    };
    
    const { rerender } = render(<Sidebar {...partiallyExpandedProps} />);
    
    // Verify dir3 is expanded (file3.js is visible) but nested folder is not expanded (nestedFile.js is not visible)
    expect(screen.getByText('file3.js')).toBeInTheDocument();
    expect(screen.getByText('nested')).toBeInTheDocument();
    expect(screen.queryByText('nestedFile.js')).not.toBeInTheDocument();
    
    // Find and click the expand all button
    const expandAllButton = screen.getByTitle('Expand all folders');
    fireEvent.click(expandAllButton);
    
    // Verify toggleExpanded was called for all non-expanded folders
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir1');
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir2');
    expect(mockProps.toggleExpanded).toHaveBeenCalledWith('/root/dir3/nested');
    // It should not be called for already expanded dir3
    expect(mockProps.toggleExpanded).not.toHaveBeenCalledWith('/root/dir3');
    
    // Update expandedNodes to simulate the state change
    const fullyExpandedProps = {
      ...partiallyExpandedProps,
      expandedNodes: {
        '/root/dir1': true,
        '/root/dir2': true,
        '/root/dir3': true,
        '/root/dir3/nested': true
      }
    };
    
    // Re-render with the updated props
    rerender(<Sidebar {...fullyExpandedProps} />);
    
    // Now all files should be visible
    expect(screen.getByText('file1.js')).toBeInTheDocument();
    expect(screen.getByText('file2.js')).toBeInTheDocument();
    expect(screen.getByText('file3.js')).toBeInTheDocument();
    expect(screen.getByText('nestedFile.js')).toBeInTheDocument();
  });

  it('calls onViewFile when clicking on view file button', async () => {
    // Start with dir1 expanded so file1.js is visible
    const expandedProps = {
      ...mockProps,
      expandedNodes: {
        '/root/dir1': true
      }
    };
    
    render(<Sidebar {...expandedProps} />);
    
    // Verify file1.js is visible
    expect(screen.getByText('file1.js')).toBeInTheDocument();
    
    // Find all eye icons and click the first one (which should be for file1.js)
    const eyeIcons = screen.getAllByTestId('eye-icon');
    const viewFileButton = eyeIcons[0].closest('button');
    
    if (viewFileButton) {
      fireEvent.click(viewFileButton);
      
      // Verify onViewFile was called with the correct file path
      expect(mockProps.onViewFile).toHaveBeenCalledWith('/root/dir1/file1.js');
      expect(mockProps.onViewFile).toHaveBeenCalledTimes(1);
    }
  });
  
  it('passes the onViewFile prop to TreeItem components', () => {
    // Create a prop with a file that has line selections
    const propsWithSelectedFile = {
      ...mockProps,
      selectedFiles: [{
        path: '/root/dir1/file1.js',
        content: 'content1',
        tokenCount: 10,
        lines: [{ start: 1, end: 5 }],
        isFullFile: false
      }] as SelectedFileWithLines[],
      expandedNodes: {
        '/root/dir1': true
      }
    };
    
    render(<Sidebar {...propsWithSelectedFile} />);
    
    // Verify file1.js is visible and has a "Partial" badge
    expect(screen.getByText('file1.js')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    
    // Find the view file button and click it
    const eyeIcons = screen.getAllByTestId('eye-icon');
    const viewFileButton = eyeIcons[0].closest('button');
    
    if (viewFileButton) {
      fireEvent.click(viewFileButton);
      
      // Verify onViewFile was called with the correct file path
      expect(mockProps.onViewFile).toHaveBeenCalledWith('/root/dir1/file1.js');
    }
  });
}); 