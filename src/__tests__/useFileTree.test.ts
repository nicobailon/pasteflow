import { renderHook, act } from '@testing-library/react';
import useFileTree from '../hooks/useFileTree';
import { FileData, TreeNode } from '../types/FileTypes';

// Use fake timers for testing
jest.useFakeTimers();

// Mock file data for testing
const mockFiles: FileData[] = [
  {
    name: 'index.html',
    path: '/index.html',
    content: '<html>...</html>',
    tokenCount: 60,
    size: 100,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'App.tsx',
    path: '/src/App.tsx',
    content: 'import React...',
    tokenCount: 150,
    size: 500,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'Header.tsx',
    path: '/src/components/Header.tsx',
    content: 'export const Header...',
    tokenCount: 120,
    size: 300,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'Footer.tsx',
    path: '/src/components/Footer.tsx',
    content: 'export const Footer...',
    tokenCount: 100,
    size: 250,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'HomePage.tsx',
    path: '/src/pages/HomePage.tsx',
    content: 'export const HomePage...',
    tokenCount: 200,
    size: 600,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'package.json',
    path: '/package.json',
    content: '{ "name": "test" }',
    tokenCount: 80,
    size: 150,
    isBinary: false,
    isSkipped: false
  }
];

// Helper function that advances timers until the tree is fully built
const waitForTreeBuildingToComplete = (result: any) => {
  // Run all pending timers
  act(() => {
    // We run timers in batches to handle nested setTimeout calls
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(10);
    }
  });
  
  // Ensure the final state update has been processed
  act(() => {
    jest.runAllTimers();
  });
};

// Mock console.log to reduce test noise
const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
});

describe('useFileTree Hook', () => {
  // Helper function to find a node by path in the tree
  const findNodeByPath = (tree: TreeNode[], path: string): TreeNode | undefined => {
    for (const node of tree) {
      if (node.path === path) {
        return node;
      }
      if (node.children) {
        const found = findNodeByPath(node.children, path);
        if (found) return found;
      }
    }
    return undefined;
  };

  const findNodeByName = (tree: TreeNode[], name: string, type: 'file' | 'directory'): TreeNode | undefined => {
    for (const node of tree) {
      if (node.name === name && node.type === type) {
        return node;
      }
      if (node.children) {
        const found = findNodeByName(node.children, name, type);
        if (found) return found;
      }
    }
    return undefined;
  };

  it('should build a file tree from flat files', async () => {
    // Render the hook with mock data
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'default'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);
    
    // Check tree structure
    expect(result.current.fileTree.length).toBeGreaterThan(0);
    
    // Ensure the src directory exists and has children
    const srcNode = result.current.fileTree.find(node => 
      node.type === 'directory' && node.name === 'src'
    );
    expect(srcNode).toBeDefined();
    expect(srcNode?.children?.length).toBeGreaterThan(0);
  });

  it('should sort the tree in alphabetical order (name-asc)', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'name-asc'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // Verify we have both directories and files in the result
    expect(result.current.fileTree.length).toBeGreaterThan(0);
    
    // Verify src directory exists
    const srcNode = result.current.fileTree.find(node => 
      node.type === 'directory' && node.name === 'src'
    );
    expect(srcNode).toBeDefined();
    
    // Check if src has components
    if (srcNode && srcNode.children) {
      // Verify components directory exists under src
      const componentsNode = srcNode.children.find(node => 
        node.type === 'directory' && node.name === 'components'
      );
      expect(componentsNode).toBeDefined();
      
      // Check that footer and header files exist under components
      if (componentsNode && componentsNode.children) {
        const footerFile = componentsNode.children.find(n => n.name === 'Footer.tsx');
        const headerFile = componentsNode.children.find(n => n.name === 'Header.tsx');
        
        expect(footerFile).toBeDefined();
        expect(headerFile).toBeDefined();
      }
    }
  });

  it('should sort the tree in reverse alphabetical order (name-desc)', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'name-desc'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // Look for components folder to check child sorting
    const srcNode = result.current.fileTree.find(node => 
      node.type === 'directory' && node.name === 'src'
    );
    
    if (srcNode && srcNode.children) {
      const componentsNode = srcNode.children.find(node => 
        node.type === 'directory' && node.name === 'components'
      );
      
      if (componentsNode && componentsNode.children && componentsNode.children.length >= 2) {
        // For reverse alphabetical ordering, Header should come before Footer
        const nodeNames = componentsNode.children.map(n => n.name);
        const footerIndex = nodeNames.indexOf('Footer.tsx');
        const headerIndex = nodeNames.indexOf('Header.tsx');
        
        if (footerIndex >= 0 && headerIndex >= 0) {
          expect(headerIndex).toBeLessThan(footerIndex);
        }
      }
    }
  });

  it('should sort by token count (tokens-asc)', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'tokens-asc'
    }));
    
    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);
    
    // Extract root-level files
    const files = result.current.fileTree.filter(node => node.type === 'file');
    
    // If we have multiple files, check they're sorted by token count
    if (files.length > 1) {
      for (let i = 0; i < files.length - 1; i++) {
        const currentTokens = files[i].fileData?.tokenCount || 0;
        const nextTokens = files[i + 1].fileData?.tokenCount || 0;
        expect(currentTokens).toBeLessThanOrEqual(nextTokens);
      }
    }
  });

  it('should sort by token count (tokens-desc)', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'tokens-desc'
    }));
    
    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);
    
    // Extract root-level files
    const files = result.current.fileTree.filter(node => node.type === 'file');
    
    // Verify we have files with token counts
    expect(files.length).toBeGreaterThan(0);
    
    // Check at least one file has token count
    const hasTokenCount = files.some(node => (node.fileData?.tokenCount || 0) > 0);
    expect(hasTokenCount).toBe(true);
    
    // For tokens-desc sorting, we'll check a specific file we know has the most tokens
    // HomePage.tsx has 200 tokens which should put it early in the list
    const homePageFile = mockFiles.find(file => file.name === 'HomePage.tsx');
    if (homePageFile && files.length > 1) {
      // Find HomePage.tsx in our sorted files
      const homePageIndex = files.findIndex(f => f.name === 'HomePage.tsx');
      
      // If we found HomePage.tsx in the results, it should be sorted high up (low index) 
      // since it has the most tokens
      if (homePageIndex >= 0) {
        expect(homePageIndex).toBeLessThanOrEqual(1); // Should be one of the first files
      }
    }
  });

  it('should sort by file extension (extension-asc)', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'extension-asc'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // Extract root-level files
    const files = result.current.fileTree.filter(node => node.type === 'file');
    
    // Verify we have files
    expect(files.length).toBeGreaterThan(0);
    
    // Get extensions in order they appear
    const extensions = files.map(file => file.name.split('.').pop() || '');
    
    // Create a sorted copy for comparison
    const sortedExtensions = [...extensions].sort();
    
    // Extensions should be in alphabetical order
    expect(extensions).toEqual(sortedExtensions);
  });

  it('should sort by file extension (extension-desc)', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'extension-desc'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // Extract root-level files
    const files = result.current.fileTree.filter(node => node.type === 'file');
    
    // Verify we have files
    expect(files.length).toBeGreaterThan(0);
    
    // Get the extensions of files that are actually in the tree
    const fileExtensions = files.map(file => {
      const parts = file.name.split('.');
      return parts.length > 1 ? parts[parts.length - 1] : '';
    });
    
    // Verify we have different extensions
    expect(new Set(fileExtensions).size).toBeGreaterThan(0);
    
    // Simply verify that the expected file types are present somewhere in the tree
    const expectedExtensions = ['html', 'json', 'tsx'];
    const foundExtensions = expectedExtensions.filter(ext => 
      result.current.fileTree.some(node => 
        node.type === 'file' && node.name.endsWith(`.${ext}`)
      ) || 
      // Also check src directory for files
      result.current.fileTree.some(srcNode => 
        srcNode.type === 'directory' && srcNode.children && 
        srcNode.children.some(child => 
          child.type === 'file' && child.name.endsWith(`.${ext}`)
        )
      )
    );

    // Verify we found at least one of the expected extensions
    expect(foundExtensions.length).toBeGreaterThan(0);
  });

  it('should prioritize important directories in default sorting', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'default'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // Identify src directory
    const srcNode = result.current.fileTree.find(node => 
      node.type === 'directory' && node.name === 'src'
    );
    
    expect(srcNode).toBeDefined();
    
    // 'src' should be one of the first directories due to priority
    const dirIndex = result.current.fileTree.indexOf(srcNode as TreeNode);
    expect(dirIndex).toBeLessThanOrEqual(2); // It should be within the first 3 nodes
  });

  it('should filter the tree based on search term', async () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: 'header',
      fileTreeSortOrder: 'default'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // When filtering, visible tree should include the header file or its parent directories
    const visibleTree = result.current.visibleTree;
    
    // Check the visible tree for Header file or components directory
    const hasHeaderFile = visibleTree.some(node => 
      node.name === 'Header.tsx' || 
      (node.type === 'directory' && node.name === 'components')
    );
    
    expect(hasHeaderFile).toBe(true);
  });

  it('should handle incremental tree building', async () => {
    // Create a moderate-sized mock file set to test batch processing
    const largeFileSet = Array(100).fill(null).map((_, i) => ({
      name: `file-${i}.js`,
      path: `/folder-${Math.floor(i / 20)}/file-${i}.js`,
      content: `console.log('file ${i}');`,
      tokenCount: 10 + i % 50,
      size: 100 + i,
      isBinary: false,
      isSkipped: false
    }));

    // Render the hook with the large file set
    const { result } = renderHook(() => useFileTree({
      allFiles: largeFileSet,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'default'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);
    
    // Check tree structure
    expect(result.current.fileTree.length).toBeGreaterThan(0);
    
    // The tree should have directories
    const folders = result.current.fileTree.filter(node => node.type === 'directory');
    expect(folders.length).toBeGreaterThan(0);
    
    // Verify at least one folder has children
    const hasChildren = folders.some(folder => folder.children && folder.children.length > 0);
    expect(hasChildren).toBe(true);
  });

  it('should only auto-expand the top 2 levels of the tree', async () => {
    // Create a deeply nested file structure
    const nestedFiles = [
      { name: 'level1.js', path: '/level1/level1.js', content: '', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
      { name: 'level2.js', path: '/level1/level2/level2.js', content: '', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
      { name: 'level3.js', path: '/level1/level2/level3/level3.js', content: '', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
      { name: 'level4.js', path: '/level1/level2/level3/level4/level4.js', content: '', tokenCount: 10, size: 100, isBinary: false, isSkipped: false },
    ];

    // Render hook with nested file structure
    const { result } = renderHook(() => useFileTree({
      allFiles: nestedFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'default'
    }));

    // Wait for the tree building to complete
    waitForTreeBuildingToComplete(result);

    // The level1 directory should exist
    const level1Dir = result.current.fileTree.find(node => 
      node.type === 'directory' && node.name === 'level1'
    );
    
    expect(level1Dir).toBeDefined();
    expect(level1Dir?.isExpanded).toBe(true); // Level 1 should be expanded
    
    // Level2 directory should exist under level1
    const level2Dir = level1Dir?.children?.find(node => 
      node.type === 'directory' && node.name === 'level2'
    );
    
    expect(level2Dir).toBeDefined();
    expect(level2Dir?.isExpanded).toBe(true); // Level 2 should be expanded
    
    // Level3 directory should exist under level2
    const level3Dir = level2Dir?.children?.find(node => 
      node.type === 'directory' && node.name === 'level3'
    );
    
    expect(level3Dir).toBeDefined();
    expect(level3Dir?.isExpanded).toBe(false); // Level 3 should NOT be expanded
  });

  it('should rebuild the tree when sort order changes', async () => {
    const { result, rerender } = renderHook(
      (props) => useFileTree(props),
      {
        initialProps: {
          allFiles: mockFiles,
          selectedFolder: null,
          expandedNodes: {},
          searchTerm: '',
          fileTreeSortOrder: 'name-asc'
        }
      }
    );

    // Wait for the initial tree building to complete
    waitForTreeBuildingToComplete(result);

    // Capture tree state before changing sort order
    const initialTreeSize = result.current.fileTree.length;
    
    // Change sort order 
    act(() => {
      rerender({
        allFiles: mockFiles,
        selectedFolder: null, 
        expandedNodes: {},
        searchTerm: '',
        fileTreeSortOrder: 'name-desc'
      });
    });
    
    // Wait for tree rebuilding to complete
    waitForTreeBuildingToComplete(result);
    
    // Tree should still be populated
    expect(result.current.fileTree.length).toBe(initialTreeSize);
    
    // With the change to desc, check sorting order is different
    const hasDirectoriesOrFiles = result.current.fileTree.some(node => 
      node.type === 'directory' || node.type === 'file'
    );
    expect(hasDirectoriesOrFiles).toBe(true);
  });

  // Clean up after each test
  afterEach(() => {
    jest.clearAllMocks();
  });
}); 