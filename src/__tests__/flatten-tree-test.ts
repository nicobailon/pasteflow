import { renderHook } from '@testing-library/react';
import useFileTree from '../hooks/useFileTree';
import { TreeNode, FileData } from '../types/FileTypes';

// Mock the files and folder structure for testing
const createMockFiles = (): FileData[] => [
  { 
    name: 'file1.js', 
    path: '/root/dir1/file1.js',
    content: 'content1',
    tokenCount: 10,
    size: 100,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'file2.js', 
    path: '/root/dir2/file2.js',
    content: 'content2',
    tokenCount: 20,
    size: 200,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'file3.js', 
    path: '/root/dir3/file3.js',
    content: 'content3',
    tokenCount: 30,
    size: 300,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'nestedFile.js', 
    path: '/root/dir3/nested/nestedFile.js',
    content: 'nestedContent',
    tokenCount: 40,
    size: 400,
    isBinary: false,
    isSkipped: false
  }
];

describe('flattenTree function in useFileTree', () => {
  it('returns flattened tree with expandedNodes state applied to nodes', () => {
    // Set up initial expanded nodes state
    const expandedNodes = {
      '/root/dir1': true,
      '/root/dir3': true
    };

    // Render the hook
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: createMockFiles(),
        selectedFolder: '/root',
        expandedNodes,
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );

    // Get the flattened tree
    const { visibleTree } = result.current;

    // Check the structure of the flattened tree
    // Confirm root level directories exist
    const dir1 = visibleTree.find(node => node.id === '/root/dir1');
    const dir2 = visibleTree.find(node => node.id === '/root/dir2');
    const dir3 = visibleTree.find(node => node.id === '/root/dir3');
    
    // Verify expanded state is properly reflected
    expect(dir1?.isExpanded).toBe(true);
    expect(dir2?.isExpanded).toBe(false); // Not in expandedNodes, so should be false
    expect(dir3?.isExpanded).toBe(true);
    
    // Check if children of expanded directories are visible in the flattened tree
    const file1 = visibleTree.find(node => node.id === '/root/dir1/file1.js');
    const file2 = visibleTree.find(node => node.id === '/root/dir2/file2.js');
    const file3 = visibleTree.find(node => node.id === '/root/dir3/file3.js');
    
    // Children of expanded directories should be in the flattened tree
    expect(file1).toBeDefined();
    expect(file3).toBeDefined();
    
    // Children of collapsed directories should NOT be in the flattened tree
    expect(file2).toBeUndefined();
  });
  
  it('updates node expanded state when expandedNodes changes', () => {
    // Initial render with no expanded nodes
    const { result, rerender } = renderHook(
      (props) => useFileTree(props),
      {
        initialProps: {
          allFiles: createMockFiles(),
          selectedFolder: '/root',
          expandedNodes: {},
          searchTerm: '',
          fileTreeSortOrder: 'default'
        }
      }
    );
    
    // Initially all directories should be collapsed
    let visibleTree = result.current.visibleTree;
    
    // Verify all dirs are collapsed
    const initialDirs = visibleTree.filter(node => node.type === 'directory');
    initialDirs.forEach(dir => {
      expect(dir.isExpanded).toBe(false);
    });
    
    // Verify no files are visible in the flattened tree
    expect(visibleTree.find(node => node.id.endsWith('.js'))).toBeUndefined();
    
    // Now update expandedNodes
    rerender({
      allFiles: createMockFiles(),
      selectedFolder: '/root',
      expandedNodes: {
        '/root/dir1': true,
        '/root/dir2': true
      },
      searchTerm: '',
      fileTreeSortOrder: 'default'
    });
    
    // After rerender, check the updated visible tree
    visibleTree = result.current.visibleTree;
    
    // Verify dir1 and dir2 are now expanded
    const dir1 = visibleTree.find(node => node.id === '/root/dir1');
    const dir2 = visibleTree.find(node => node.id === '/root/dir2');
    const dir3 = visibleTree.find(node => node.id === '/root/dir3');
    
    expect(dir1?.isExpanded).toBe(true);
    expect(dir2?.isExpanded).toBe(true);
    expect(dir3?.isExpanded).toBe(false);
    
    // Children of newly expanded directories should now be visible
    const file1 = visibleTree.find(node => node.id === '/root/dir1/file1.js');
    const file2 = visibleTree.find(node => node.id === '/root/dir2/file2.js');
    
    expect(file1).toBeDefined();
    expect(file2).toBeDefined();
  });
  
  it('handles nested directories correctly during flattening', () => {
    // Set up expanded nodes with nested directories
    const expandedNodes = {
      '/root/dir3': true,
      '/root/dir3/nested': true
    };
    
    // Render the hook
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: createMockFiles(),
        selectedFolder: '/root',
        expandedNodes,
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );
    
    // Get the flattened tree
    const { visibleTree } = result.current;
    
    // Check that dir3 is expanded
    const dir3 = visibleTree.find(node => node.id === '/root/dir3');
    expect(dir3?.isExpanded).toBe(true);
    
    // Check that nested directory is expanded
    const nestedDir = visibleTree.find(node => node.id === '/root/dir3/nested');
    expect(nestedDir?.isExpanded).toBe(true);
    
    // Check that files in both dir3 and nested dir are visible
    const file3 = visibleTree.find(node => node.id === '/root/dir3/file3.js');
    const nestedFile = visibleTree.find(node => node.id === '/root/dir3/nested/nestedFile.js');
    
    expect(file3).toBeDefined();
    expect(nestedFile).toBeDefined();
  });
  
  it('collapses nested directories when parent directory is collapsed', () => {
    // First render with everything expanded
    const { result, rerender } = renderHook(
      (props) => useFileTree(props),
      {
        initialProps: {
          allFiles: createMockFiles(),
          selectedFolder: '/root',
          expandedNodes: {
            '/root/dir3': true,
            '/root/dir3/nested': true
          },
          searchTerm: '',
          fileTreeSortOrder: 'default'
        }
      }
    );
    
    // Verify everything is initially expanded and visible
    let visibleTree = result.current.visibleTree;
    expect(visibleTree.find(node => node.id === '/root/dir3/file3.js')).toBeDefined();
    expect(visibleTree.find(node => node.id === '/root/dir3/nested/nestedFile.js')).toBeDefined();
    
    // Now collapse the parent directory
    rerender({
      allFiles: createMockFiles(),
      selectedFolder: '/root',
      expandedNodes: {
        // dir3 is now collapsed, nested remains in expandedNodes but should not be visible
        '/root/dir3': false,
        '/root/dir3/nested': true
      },
      searchTerm: '',
      fileTreeSortOrder: 'default'
    });
    
    // After rerender, check the updated visible tree
    visibleTree = result.current.visibleTree;
    
    // dir3 should be collapsed
    const dir3 = visibleTree.find(node => node.id === '/root/dir3');
    expect(dir3?.isExpanded).toBe(false);
    
    // Neither file3 nor nestedFile should be visible, regardless of nested's expanded state
    expect(visibleTree.find(node => node.id === '/root/dir3/file3.js')).toBeUndefined();
    expect(visibleTree.find(node => node.id === '/root/dir3/nested')).toBeUndefined();
    expect(visibleTree.find(node => node.id === '/root/dir3/nested/nestedFile.js')).toBeUndefined();
  });
  
  it('maintains expanded state of directories when search filter is applied', () => {
    // Set up expanded nodes
    const expandedNodes = {
      '/root/dir1': true,
      '/root/dir2': true,
      '/root/dir3': true,
      '/root/dir3/nested': true
    };
    
    // Render the hook
    const { result, rerender } = renderHook(
      (props) => useFileTree(props),
      {
        initialProps: {
          allFiles: createMockFiles(),
          selectedFolder: '/root',
          expandedNodes,
          searchTerm: '',
          fileTreeSortOrder: 'default'
        }
      }
    );
    
    // Apply a search filter
    rerender({
      allFiles: createMockFiles(),
      selectedFolder: '/root',
      expandedNodes,
      searchTerm: 'nested', // Only searching for nested file
      fileTreeSortOrder: 'default'
    });
    
    // Get the filtered tree
    const { visibleTree } = result.current;
    
    // The tree should only contain nodes matching the search or their parents
    // And the expanded state should be preserved
    
    // Check if dir3 is still in the tree and expanded
    const dir3 = visibleTree.find(node => node.id === '/root/dir3');
    expect(dir3).toBeDefined();
    expect(dir3?.isExpanded).toBe(true);
    
    // Check if nested directory is in the tree and expanded
    const nestedDir = visibleTree.find(node => node.id === '/root/dir3/nested');
    expect(nestedDir).toBeDefined();
    expect(nestedDir?.isExpanded).toBe(true);
    
    // Check if nestedFile is in the tree
    const nestedFile = visibleTree.find(node => node.id === '/root/dir3/nested/nestedFile.js');
    expect(nestedFile).toBeDefined();
    
    // Other directories and files should not be in the filtered tree
    expect(visibleTree.find(node => node.id === '/root/dir1')).toBeUndefined();
    expect(visibleTree.find(node => node.id === '/root/dir2')).toBeUndefined();
  });
}); 