import { renderHook } from '@testing-library/react-hooks';
import useFileTree from '../hooks/useFileTree';
import { FileData, TreeNode } from '../types/FileTypes';

// Mock sample file data
const mockFiles: FileData[] = [
  {
    name: 'Header.tsx',
    path: '/src/components/Header.tsx',
    content: 'Header component',
    size: 1000,
    tokenCount: 120,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'Footer.tsx',
    path: '/src/components/Footer.tsx',
    content: 'Footer component',
    size: 800,
    tokenCount: 100,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'Home.tsx',
    path: '/src/pages/Home.tsx',
    content: 'Home page',
    size: 1500,
    tokenCount: 200,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'helpers.js',
    path: '/src/utils/helpers.js',
    content: 'Helper functions',
    size: 500,
    tokenCount: 80,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'index.html',
    path: '/public/index.html',
    content: 'HTML template',
    size: 300,
    tokenCount: 50,
    isBinary: false,
    isSkipped: false
  },
  {
    name: 'package.json',
    path: '/package.json',
    content: 'Package config',
    size: 400,
    tokenCount: 60,
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
    const srcNode = findNodeByPath(result.current.fileTree, '/src');
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

    // Directories should still be first
    const rootChildren = result.current.fileTree;
    const packageJsonNode = findNodeByPath(rootChildren, '/package.json');
    const srcNode = findNodeByPath(rootChildren, '/src');
    
    // Ensure directories come before files
    expect(rootChildren.indexOf(srcNode as TreeNode))
      .toBeLessThan(rootChildren.indexOf(packageJsonNode as TreeNode));
    
    // Check src/components folder has children sorted alphabetically
    const componentsNode = findNodeByPath(result.current.fileTree, '/src/components');
    if (componentsNode && componentsNode.children) {
      const footerNode = findNodeByPath(componentsNode.children, '/src/components/Footer.tsx');
      const headerNode = findNodeByPath(componentsNode.children, '/src/components/Header.tsx');
      
      // Footer should come before Header alphabetically in asc order
      expect(componentsNode.children.indexOf(footerNode as TreeNode))
        .toBeLessThan(componentsNode.children.indexOf(headerNode as TreeNode));
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

    // Directories should still be first
    const rootChildren = result.current.fileTree;
    const firstFileNode = rootChildren.find((node: TreeNode) => node.type === 'file');
    expect(firstFileNode?.fileData?.tokenCount).toBe(50); // index.html has lowest token count
  });

  it('should sort by token count (tokens-desc)', () => {
    const { result } = renderHook(() => useFileTree({
      allFiles: mockFiles,
      selectedFolder: null,
      expandedNodes: {},
      searchTerm: '',
      fileTreeSortOrder: 'tokens-desc'
    }));

    // Directories should still be first
    const rootChildren = result.current.fileTree;
    const srcNode = findNodeByPath(rootChildren, '/src');
    expect(srcNode?.type).toBe('directory');
    
    // Within src directory, pages should have highest token files
    const pagesNode = findNodeByPath(result.current.fileTree, '/src/pages');
    if (pagesNode && pagesNode.children) {
      const homePage = pagesNode.children[0];
      expect(homePage.fileData?.tokenCount).toBe(200); // Home.tsx has highest token count
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
    
    // The src and components directories should be visible
    const srcNode = findNodeByPath(visibleTree, '/src');
    expect(srcNode).toBeDefined();
    
    const componentsNode = findNodeByPath(visibleTree, '/src/components');
    expect(componentsNode).toBeDefined();
    
    // The Header.tsx file should be visible
    const headerNode = findNodeByPath(visibleTree, '/src/components/Header.tsx');
    expect(headerNode).toBeDefined();
    
    // The Footer.tsx file should not be visible
    const footerNode = findNodeByPath(visibleTree, '/src/components/Footer.tsx');
    expect(footerNode).toBeUndefined();
  });
}); 