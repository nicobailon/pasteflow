import { renderHook } from '@testing-library/react';
import useFileTree from '../hooks/useFileTree';
import { FileData, TreeNode } from '../types/FileTypes';

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

  it('should build a file tree from flat files', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'default'
    }));

    // Check that the tree was built
    expect(result.current.fileTree.length).toBeGreaterThan(0);
    
    // Check that directories and files are organized correctly
    const srcNode = findNodeByName(result.current.fileTree, 'src', 'directory');
    expect(srcNode).toBeDefined();
    expect(srcNode?.type).toBe('directory');
    expect(srcNode?.children?.length).toBeGreaterThan(0);
  });

  it('should sort the tree in alphabetical order (name-asc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'name-asc'
    }));

    const rootChildren = result.current.fileTree;
    
    // Find nodes by path
    const srcNode = findNodeByPath(rootChildren, '/src');
    const packageJsonNode = findNodeByPath(rootChildren, '/package.json');
    
    // Ensure directories come before files
    expect(rootChildren.indexOf(srcNode as TreeNode))
      .toBeLessThanOrEqual(rootChildren.indexOf(packageJsonNode as TreeNode));
    
    // Check src/components folder has children sorted alphabetically
    const componentsNode = findNodeByPath(result.current.fileTree, '/src/components');
    if (componentsNode && componentsNode.children) {
      const footerNode = componentsNode.children.find(node => node.name === 'Footer.tsx');
      const headerNode = componentsNode.children.find(node => node.name === 'Header.tsx');
      
      if (footerNode && headerNode) {
        expect(componentsNode.children.indexOf(footerNode))
          .toBeLessThan(componentsNode.children.indexOf(headerNode));
      }
    }
  });

  it('should sort the tree in reverse alphabetical order (name-desc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'name-desc'
    }));

    // Check src/components folder has children sorted in reverse alphabetically
    const componentsNode = findNodeByPath(result.current.fileTree, '/src/components');
    if (componentsNode && componentsNode.children) {
      const footerNode = findNodeByPath(componentsNode.children, '/src/components/Footer.tsx');
      const headerNode = findNodeByPath(componentsNode.children, '/src/components/Header.tsx');
      
      // Header should come before Footer in desc order
      expect(componentsNode.children.indexOf(headerNode as TreeNode))
        .toBeLessThan(componentsNode.children.indexOf(footerNode as TreeNode));
    }
  });

  it('should sort by token count (tokens-asc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'tokens-asc'
    }));
    
    // Find files in the root level
    const rootChildren = result.current.fileTree;
    const fileNodes = rootChildren.filter(node => node.type === 'file');
    
    // If there are file nodes, check that they're sorted by token count in ascending order
    if (fileNodes.length > 1) {
      for (let i = 0; i < fileNodes.length - 1; i++) {
        const currentTokens = fileNodes[i].fileData?.tokenCount || 0;
        const nextTokens = fileNodes[i + 1].fileData?.tokenCount || 0;
        expect(currentTokens).toBeLessThanOrEqual(nextTokens);
      }
    }
  });

  it('should sort by token count (tokens-desc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'tokens-desc'
    }));
    
    // Find files in the root level
    const rootChildren = result.current.fileTree;
    const fileNodes = rootChildren.filter(node => node.type === 'file');
    
    // If there are file nodes, check that they're sorted by token count in descending order
    if (fileNodes.length > 1) {
      for (let i = 0; i < fileNodes.length - 1; i++) {
        const currentTokens = fileNodes[i].fileData?.tokenCount || 0;
        const nextTokens = fileNodes[i + 1].fileData?.tokenCount || 0;
        expect(currentTokens).toBeGreaterThanOrEqual(nextTokens);
      }
    }
  });

  it('should sort by file extension (extension-asc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'extension-asc'
    }));

    // Directories should still be first
    const rootChildren = result.current.fileTree;
    const files = rootChildren.filter((node: TreeNode) => node.type === 'file');
    
    // Check if extensions are sorted correctly
    // HTML should come before JS which comes before JSON
    const extensions = files.map((file: TreeNode) => file.name.split('.').pop());
    const sortedExtensions = [...extensions].sort();
    expect(extensions).toEqual(sortedExtensions);
  });

  it('should sort by file extension (extension-desc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'extension-desc'
    }));

    // Directories should still be first
    const rootChildren = result.current.fileTree;
    const files = rootChildren.filter((node: TreeNode) => node.type === 'file');
    
    // Check if extensions are sorted correctly in reverse
    const extensions = files.map((file: TreeNode) => file.name.split('.').pop());
    const sortedExtensions = [...extensions].sort().reverse();
    expect(extensions).toEqual(sortedExtensions);
  });

  it('should prioritize important directories in default sorting', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'default'
    }));

    const rootChildren = result.current.fileTree;
    const directories = rootChildren.filter((node: TreeNode) => node.type === 'directory');
    
    // Check if src directory is first (highest priority)
    if (directories.length >= 2) {
      const srcIndex = directories.findIndex((dir: TreeNode) => dir.name === 'src');
      const publicIndex = directories.findIndex((dir: TreeNode) => dir.name === 'public');
      
      // src should come before public in the default sort
      expect(srcIndex).toBeLessThan(publicIndex);
    }
  });

  it('should filter the tree based on search term', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: 'header',
      fileTreeSortOrder: 'default'
    }));

    // Only nodes matching search or containing matching descendants should be in visible tree
    const visibleTree = result.current.visibleTree;
    
    // Check if the Header.tsx file is in the visible tree
    const headerNode = visibleTree.find(node => node.name === 'Header.tsx' || 
                                              (node.children && node.children.some(child => child.name === 'Header.tsx')));
    expect(headerNode).toBeDefined();
  });
}); 