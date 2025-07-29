import { fireEvent, render, screen } from '@testing-library/react';

import '@testing-library/jest-dom';
import Sidebar from '../components/sidebar';
import { FileData, TreeNode } from '../types/file-types';

// Using shared lucide-react mock from jest.config.js

// Mock the useFileTree hook
jest.mock('../hooks/use-file-tree', () => ({
  __esModule: true,
  default: jest.fn(({ allFiles: _allFiles, expandedNodes }) => {
    // Create a simple file tree structure for testing
    
    // Helper functions to create tree nodes
    const createFileNode = (path: string, name: string, level: number): TreeNode => ({
      id: path,
      name,
      path,
      type: 'file',
      level,
      fileData: {
        name,
        path,
        isDirectory: false,
        content: 'content',
        tokenCount: 10,
        size: 100,
        isBinary: false,
        isSkipped: false
      }
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
    
    // Build the tree structure
    const rootDir = '/test';
    
    // Create directories with files
    const dir1 = createDirNode(`${rootDir}/dir1`, 'dir1', 1, [
      createFileNode(`${rootDir}/dir1/file1.js`, 'file1.js', 2)
    ]);
    
    const dir2 = createDirNode(`${rootDir}/dir2`, 'dir2', 1, [
      createFileNode(`${rootDir}/dir2/file2.js`, 'file2.js', 2)
    ]);
    
    const dir3Nested = createDirNode(`${rootDir}/dir3/nested`, 'nested', 2, [
      createFileNode(`${rootDir}/dir3/nested/nestedFile.js`, 'nestedFile.js', 3)
    ]);
    
    const dir3 = createDirNode(`${rootDir}/dir3`, 'dir3', 1, [
      createFileNode(`${rootDir}/dir3/file3.js`, 'file3.js', 2),
      dir3Nested
    ]);
    
    // Create the file tree
    const fileTree = [dir1, dir2, dir3];
    
    // Function to flatten the tree (simulating the same logic as in useFileTree)
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
    
    return {
      fileTree,
      visibleTree: flattenTree(fileTree),
      isTreeBuildingComplete: true
    };
  })
}));

describe('Expand and Collapse All Functions', () => {
  // Test data
  const testFiles: FileData[] = [
    { name: 'file1.js', path: '/test/dir1/file1.js', isDirectory: false, content: 'content', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
    { name: 'file2.js', path: '/test/dir2/file2.js', isDirectory: false, content: 'content', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
    { name: 'file3.js', path: '/test/dir3/file3.js', isDirectory: false, content: 'content', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
    { name: 'nestedFile.js', path: '/test/dir3/nested/nestedFile.js', isDirectory: false, content: 'content', tokenCount: 10, size: 100, isBinary: false, isSkipped: false }
  ];
  
  // Base props for tests
  const baseProps = {
    selectedFolder: '/test',
    openFolder: jest.fn(),
    allFiles: testFiles,
    selectedFiles: [] as FileData[],
    toggleFileSelection: jest.fn(),
    toggleFolderSelection: jest.fn(),
    searchTerm: '',
    onSearchChange: jest.fn(),
    selectAllFiles: jest.fn(),
    deselectAllFiles: jest.fn(),
    resetFolderState: jest.fn(),
    onFileTreeSortChange: jest.fn(),
    toggleFilterModal: jest.fn(),
    refreshFileTree: jest.fn()
  };
  
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('collapses all folders with collapseAllFolders function', () => {
    // Start with all folders expanded
    const toggleExpanded = jest.fn();
    const expandedNodes = {
      '/test/dir1': true,
      '/test/dir2': true,
      '/test/dir3': true,
      '/test/dir3/nested': true
    };
    
    const props = {
      ...baseProps,
      expandedNodes,
      toggleExpanded
    };
    
    render(<Sidebar {...props} />);
    
    // Check if collapse all button is enabled
    const collapseAllBtn = screen.getByTitle('Collapse all folders');
    expect(collapseAllBtn).not.toBeDisabled();
    
    // Click the collapse all button
    fireEvent.click(collapseAllBtn);
    
    // Verify that toggleExpanded was called for each expanded folder
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir1');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir2');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir3');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir3/nested');
    
    // Verify toggleExpanded was called exactly 4 times (for each expanded folder)
    expect(toggleExpanded).toHaveBeenCalledTimes(4);
  });
  
  it('expands all folders with expandAllFolders function', () => {
    // Start with all folders collapsed
    const toggleExpanded = jest.fn();
    const expandedNodes = {};
    
    const props = {
      ...baseProps,
      expandedNodes,
      toggleExpanded
    };
    
    render(<Sidebar {...props} />);
    
    // Check if expand all button is enabled
    const expandAllBtn = screen.getByTitle('Expand all folders');
    expect(expandAllBtn).not.toBeDisabled();
    
    // Click the expand all button
    fireEvent.click(expandAllBtn);
    
    // Verify that toggleExpanded was called for each collapsed folder
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir1');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir2');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir3');
    
    // In a real scenario, it should also discover and expand nested folders
    // But in our mock, we can't perfectly reproduce this behavior since we're not
    // updating the actual tree between clicks
    
    // Verify toggleExpanded was called at least for the top-level directories
    expect(toggleExpanded).toHaveBeenCalledTimes(4);
  });
  
  it('disables collapse all button when no folders are expanded', () => {
    // No folders expanded
    const props = {
      ...baseProps,
      expandedNodes: {},
      toggleExpanded: jest.fn()
    };
    
    render(<Sidebar {...props} />);
    
    // Collapse all button should be disabled
    const collapseAllBtn = screen.getByTitle('Collapse all folders');
    expect(collapseAllBtn).toBeDisabled();
    
    // Expand all button should be enabled
    const expandAllBtn = screen.getByTitle('Expand all folders');
    expect(expandAllBtn).not.toBeDisabled();
  });
  
  it('disables expand all button when all folders are already expanded', () => {
    // All folders expanded
    const props = {
      ...baseProps,
      expandedNodes: {
        '/test/dir1': true,
        '/test/dir2': true,
        '/test/dir3': true,
        '/test/dir3/nested': true
      },
      toggleExpanded: jest.fn()
    };
    
    render(<Sidebar {...props} />);
    
    // Expand all button should be disabled
    const expandAllBtn = screen.getByTitle('Expand all folders');
    expect(expandAllBtn).toBeDisabled();
    
    // Collapse all button should be enabled
    const collapseAllBtn = screen.getByTitle('Collapse all folders');
    expect(collapseAllBtn).not.toBeDisabled();
  });
  
  it('partially expands and collapses nested folders', () => {
    // Mock state for tracking expandedNodes
    let expandedNodesState: Record<string, boolean> = {
      '/test/dir1': true
    };
    
    // Mock toggleExpanded to update our state
    const toggleExpanded = jest.fn((nodeId: string) => {
      expandedNodesState = {
        ...expandedNodesState,
        [nodeId]: !expandedNodesState[nodeId]
      };
    });
    
    const props = {
      ...baseProps,
      expandedNodes: expandedNodesState,
      toggleExpanded
    };
    
    const { rerender } = render(<Sidebar {...props} />);
    
    // Initially, only dir1 is expanded
    // Click expand all button
    const expandAllBtn = screen.getByTitle('Expand all folders');
    fireEvent.click(expandAllBtn);
    
    // Verify that toggleExpanded was called for all non-expanded folders
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir2');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir3');
    
    // It should not have been called for already expanded dir1
    expect(toggleExpanded).not.toHaveBeenCalledWith('/test/dir1');
    
    // If we were to rerender with updated state, all dirs would be expanded
    // In a real implementation, this would also show nested folders
    // But we'll test the collapse all function
    
    // Reset the mock
    toggleExpanded.mockClear();
    
    // Update state as if all dirs are now expanded
    expandedNodesState = {
      '/test/dir1': true,
      '/test/dir2': true,
      '/test/dir3': true,
      '/test/dir3/nested': true
    };
    
    // Rerender with updated state
    rerender(<Sidebar 
      {...baseProps}
      expandedNodes={expandedNodesState}
      toggleExpanded={toggleExpanded}
    />);
    
    // Click collapse all button
    const collapseAllBtn = screen.getByTitle('Collapse all folders');
    fireEvent.click(collapseAllBtn);
    
    // Verify that toggleExpanded was called for all expanded folders
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir1');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir2');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir3');
    expect(toggleExpanded).toHaveBeenCalledWith('/test/dir3/nested');
  });
}); 