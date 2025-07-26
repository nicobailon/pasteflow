import { renderHook } from '@testing-library/react';

import useFileTree from '../hooks/use-file-tree';
import { TreeNode, FileData } from '../types/file-types';

// Mock the files and folder structure for testing
const createMockFiles = (): FileData[] => [
  { 
    name: 'dir1', 
    path: '/root/dir1',
    isDirectory: true,
    size: 0,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'file1.js', 
    path: '/root/dir1/file1.js',
    isDirectory: false,
    content: 'content1',
    tokenCount: 10,
    size: 100,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'dir2', 
    path: '/root/dir2',
    isDirectory: true,
    size: 0,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'file2.js', 
    path: '/root/dir2/file2.js',
    isDirectory: false,
    content: 'content2',
    tokenCount: 20,
    size: 200,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'dir3', 
    path: '/root/dir3',
    isDirectory: true,
    size: 0,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'file3.js', 
    path: '/root/dir3/file3.js',
    isDirectory: false,
    content: 'content3',
    tokenCount: 30,
    size: 300,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'nested', 
    path: '/root/dir3/nested',
    isDirectory: true,
    size: 0,
    isBinary: false,
    isSkipped: false
  },
  { 
    name: 'nestedFile.js', 
    path: '/root/dir3/nested/nestedFile.js',
    isDirectory: false,
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
    const dir1 = visibleTree.find((node: TreeNode) => node.id === '/root/dir1');
    const dir2 = visibleTree.find((node: TreeNode) => node.id === '/root/dir2');
    const dir3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3');
    
    // Verify expanded state is properly reflected
    expect(dir1?.isExpanded).toBe(true);
    expect(dir2?.isExpanded).toBe(false); // Not in expandedNodes, so should be false
    expect(dir3?.isExpanded).toBe(true);
    
    // Check if children of expanded directories are visible in the flattened tree
    const file1 = visibleTree.find((node: TreeNode) => node.id === '/root/dir1/file1.js');
    const file2 = visibleTree.find((node: TreeNode) => node.id === '/root/dir2/file2.js');
    const file3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3/file3.js');
    
    // ASSERTION 1: Children of expanded directories should be in the flattened tree
    expect(file1).toBeDefined();
    expect(file3).toBeDefined();
    
    // ASSERTION 2: Children of collapsed directories should NOT be in the flattened tree
    expect(file2).toBeUndefined();
    
    // ASSERTION 3: Verify correct tree structure and levels
    expect(file1?.level).toBe(2); // Root/dir1/file
    expect(file3?.level).toBe(2); // Root/dir3/file
    
    // ASSERTION 4: Verify parent-child relationships (parent path is in the path)
    expect(file1?.path).toContain('/root/dir1');
    expect(file3?.path).toContain('/root/dir3');
    
    // ASSERTION 5: Verify file metadata is preserved
    expect(file1?.fileData?.tokenCount).toBe(10);
    expect(file3?.fileData?.tokenCount).toBe(30);
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
    for (const dir of initialDirs) {
      expect(dir.isExpanded).toBe(false);
    }
    
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
    const dir1 = visibleTree.find((node: TreeNode) => node.id === '/root/dir1');
    const dir2 = visibleTree.find((node: TreeNode) => node.id === '/root/dir2');
    const dir3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3');
    
    expect(dir1?.isExpanded).toBe(true);
    expect(dir2?.isExpanded).toBe(true);
    expect(dir3?.isExpanded).toBe(false);
    
    // Children of newly expanded directories should now be visible
    const file1 = visibleTree.find((node: TreeNode) => node.id === '/root/dir1/file1.js');
    const file2 = visibleTree.find((node: TreeNode) => node.id === '/root/dir2/file2.js');
    
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
    const dir3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3');
    expect(dir3?.isExpanded).toBe(true);
    
    // Check that nested directory is expanded
    const nestedDir = visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested');
    expect(nestedDir?.isExpanded).toBe(true);
    
    // Check that files in both dir3 and nested dir are visible
    const file3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3/file3.js');
    const nestedFile = visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested/nestedFile.js');
    
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
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir3/file3.js')).toBeDefined();
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested/nestedFile.js')).toBeDefined();
    
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
    const dir3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3');
    expect(dir3?.isExpanded).toBe(false);
    
    // Neither file3 nor nestedFile should be visible, regardless of nested's expanded state
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir3/file3.js')).toBeUndefined();
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested')).toBeUndefined();
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested/nestedFile.js')).toBeUndefined();
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
    const dir3 = visibleTree.find((node: TreeNode) => node.id === '/root/dir3');
    expect(dir3).toBeDefined();
    expect(dir3?.isExpanded).toBe(true);
    
    // Check if nested directory is in the tree and expanded
    const nestedDir = visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested');
    expect(nestedDir).toBeDefined();
    expect(nestedDir?.isExpanded).toBe(true);
    
    // Check if nestedFile is in the tree
    const nestedFile = visibleTree.find((node: TreeNode) => node.id === '/root/dir3/nested/nestedFile.js');
    expect(nestedFile).toBeDefined();
    
    // Other directories and files should not be in the filtered tree
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir1')).toBeUndefined();
    expect(visibleTree.find((node: TreeNode) => node.id === '/root/dir2')).toBeUndefined();
  });
});

describe('Edge Case Handling', () => {
  it('should handle circular reference detection', () => {
    // Create mock file structure with potential circular reference
    const files: FileData[] = [
      { 
        path: '/project/src', 
        name: 'src', 
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      },
      { 
        path: '/project/src/symlink-to-project', 
        name: 'symlink-to-project', 
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      },
      { 
        path: '/project/src/index.js', 
        name: 'index.js', 
        isDirectory: false,
        content: 'console.log("test");',
        tokenCount: 5,
        size: 20,
        isBinary: false,
        isSkipped: false
      }
    ];
    
    const expandedNodes = { '/project/src': true };
    
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: files,
        selectedFolder: '/project',
        expandedNodes,
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );
    
    const { visibleTree } = result.current;
    
    // Should handle gracefully without infinite loops
    expect(visibleTree.length).toBeLessThan(1000);                   // 1. No infinite expansion
    expect(visibleTree.some(node => node.id.includes('symlink'))).toBe(true); // 2. Symlink included
    expect(visibleTree.filter(node => node.level > 10)).toHaveLength(0); // 3. Reasonable depth limit
    
    // Verify tree structure integrity
    const srcNode = visibleTree.find(node => node.id === '/project/src');
    expect(srcNode).toBeDefined();                                    // 4. Parent directory exists
    expect(srcNode?.type).toBe('directory');                          // 5. Correct node type
  });
  
  it('should handle extremely deep directory structures', () => {
    // Create very deep nested structure
    const deepFiles: FileData[] = [];
    let currentPath = '/project';
    
    // Create 50 levels deep
    for (let i = 0; i < 50; i++) {
      currentPath += `/level${i}`;
      deepFiles.push({
        path: currentPath,
        name: `level${i}`,
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      });
    }
    
    // Add a file at the deepest level
    deepFiles.push({
      path: currentPath + '/deepfile.js',
      name: 'deepfile.js',
      isDirectory: false,
      content: 'console.log("deep");',
      tokenCount: 5,
      size: 20,
      isBinary: false,
      isSkipped: false
    });
    
    const allExpanded = deepFiles.reduce((acc, file) => {
      if (file.isDirectory) {
        acc[file.path] = true;
      }
      return acc;
    }, {} as Record<string, boolean>);
    
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: deepFiles,
        selectedFolder: '/project',
        expandedNodes: allExpanded,
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );
    
    const { visibleTree } = result.current;
    
    expect(visibleTree.length).toBe(51);                             // 1. All levels + file processed
    
    // Find the deepest directory
    const deepestDir = visibleTree.find(node => node.id.includes('level49'));
    expect(deepestDir?.level).toBe(50);                              // 2. Correct depth calculation
    
    // Find the deepest file
    const deepestFile = visibleTree.find(node => node.id.includes('deepfile.js'));
    expect(deepestFile?.level).toBe(51);                             // 3. File at correct depth
    
    expect(visibleTree.every(node => node.level >= 0)).toBe(true);   // 4. No negative levels
    expect(visibleTree.every(node => node.level < 100)).toBe(true);  // 5. Reasonable depth limit
  });
  
  it('should handle empty directories correctly', () => {
    const files: FileData[] = [
      { 
        path: '/project/empty-dir', 
        name: 'empty-dir', 
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      },
      { 
        path: '/project/src', 
        name: 'src', 
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      },
      { 
        path: '/project/src/file.js', 
        name: 'file.js', 
        isDirectory: false,
        content: 'content',
        tokenCount: 10,
        size: 100,
        isBinary: false,
        isSkipped: false
      }
    ];
    
    const expandedNodes = {
      '/project/empty-dir': true,
      '/project/src': true
    };
    
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: files,
        selectedFolder: '/project',
        expandedNodes,
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );
    
    const { visibleTree } = result.current;
    
    // Empty directory should still be visible
    const emptyDir = visibleTree.find(node => node.id === '/project/empty-dir');
    expect(emptyDir).toBeDefined();                                   // 1. Empty dir exists
    expect(emptyDir?.isExpanded).toBe(true);                         // 2. Can be expanded
    expect(emptyDir?.children?.length || 0).toBe(0);                 // 3. No children
    
    // Non-empty directory for comparison
    const srcDir = visibleTree.find(node => node.id === '/project/src');
    expect((srcDir?.children?.length || 0) > 0).toBe(true);          // 4. Has children
    
    // Verify total structure
    expect(visibleTree.length).toBe(4);                              // 5. Root + 2 dirs + 1 file
  });
  
  it('should handle files with extremely long paths', () => {
    // Create files with very long paths
    const longPathFiles: FileData[] = [];
    
    // Create a path with 500 characters
    const longDirName = 'a'.repeat(50);
    let longPath = '/project';
    
    // Build a deep path with long directory names
    for (let i = 0; i < 8; i++) {
      longPath += `/${longDirName}${i}`;
      longPathFiles.push({
        path: longPath,
        name: `${longDirName}${i}`,
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      });
    }
    
    // Add file with extremely long name
    const longFileName = 'very_long_file_name_that_exceeds_normal_limits_' + 'x'.repeat(100) + '.js';
    longPathFiles.push({
      path: `${longPath}/${longFileName}`,
      name: longFileName,
      isDirectory: false,
      content: 'content',
      tokenCount: 10,
      size: 100,
      isBinary: false,
      isSkipped: false
    });
    
    const expandedNodes = longPathFiles.reduce((acc, file) => {
      if (file.isDirectory) {
        acc[file.path] = true;
      }
      return acc;
    }, {} as Record<string, boolean>);
    
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: longPathFiles,
        selectedFolder: '/project',
        expandedNodes,
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );
    
    const { visibleTree } = result.current;
    
    // Should handle long paths without errors
    expect(visibleTree.length).toBe(9);                              // 1. All items processed
    
    // Verify the long file is included
    const longFile = visibleTree.find(node => node.name === longFileName);
    expect(longFile).toBeDefined();                                   // 2. Long filename handled
    expect(longFile?.level).toBe(9);                                 // 3. Correct depth
    
    // Verify path integrity
    expect(longFile?.path).toContain(longPath);                      // 4. Parent path correct
    expect(longFile?.id.length).toBeGreaterThan(500);               // 5. Full path preserved
  });
  
  it('should handle mixed file types and binary files', () => {
    const mixedFiles: FileData[] = [
      { 
        path: '/project/image.png', 
        name: 'image.png', 
        isDirectory: false,
        size: 5000,
        isBinary: true,
        isSkipped: false
      },
      { 
        path: '/project/script.js', 
        name: 'script.js', 
        isDirectory: false,
        content: 'console.log("test");',
        tokenCount: 10,
        size: 100,
        isBinary: false,
        isSkipped: false
      },
      { 
        path: '/project/data.bin', 
        name: 'data.bin', 
        isDirectory: false,
        size: 10000,
        isBinary: true,
        isSkipped: false
      },
      { 
        path: '/project/.gitignore', 
        name: '.gitignore', 
        isDirectory: false,
        content: 'node_modules/',
        tokenCount: 5,
        size: 50,
        isBinary: false,
        isSkipped: true
      }
    ];
    
    const { result } = renderHook(() => 
      useFileTree({
        allFiles: mixedFiles,
        selectedFolder: '/project',
        expandedNodes: {},
        searchTerm: '',
        fileTreeSortOrder: 'default'
      })
    );
    
    const { visibleTree } = result.current;
    
    // All files should be in the tree
    expect(visibleTree.length).toBe(5);                              // 1. Root + 4 files
    
    // Verify binary files are marked correctly
    const imagePng = visibleTree.find(node => node.name === 'image.png');
    expect(imagePng?.fileData?.isBinary).toBe(true);                 // 2. Binary flag preserved
    expect(imagePng?.fileData?.tokenCount).toBeUndefined();          // 3. No tokens for binary
    
    // Verify text files
    const scriptJs = visibleTree.find(node => node.name === 'script.js');
    expect(scriptJs?.fileData?.isBinary).toBe(false);                // 4. Not binary
    expect(scriptJs?.fileData?.tokenCount).toBe(10);                 // 5. Has token count
    
    // Verify skipped files
    const gitignore = visibleTree.find(node => node.name === '.gitignore');
    expect(gitignore?.fileData?.isSkipped).toBe(true);               // 6. Skip flag preserved
  });
}); 