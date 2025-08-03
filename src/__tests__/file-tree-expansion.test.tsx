import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TreeItem from '../components/tree-item';
import { TreeNode, TreeItemProps } from '../types/file-types';

describe('File Tree Expansion Behavior', () => {
  // Mock functions
  const mockToggleFileSelection = jest.fn();
  const mockToggleFolderSelection = jest.fn();
  const mockToggleExpanded = jest.fn();
  const mockOnViewFile = jest.fn();
  const mockLoadFileContent = jest.fn();

  // Helper to create a test folder node
  const createFolderNode = (path: string, isExpanded: boolean = false): TreeNode => ({
    id: path,
    name: path.split('/').pop() || 'folder',
    path,
    type: 'directory',
    level: 0,
    isExpanded,
    children: [
      {
        id: `${path}/test-file.js`,
        name: 'test-file.js',
        path: `${path}/test-file.js`,
        type: 'file',
        level: 1,
        fileData: {
          name: 'test-file.js',
          path: `${path}/test-file.js`,
          isDirectory: false,
          size: 1000,
          isBinary: false,
          content: 'test content',
          tokenCount: 10,
          isContentLoaded: true,
          isSkipped: false
        }
      }
    ]
  });

  // Helper to create default props
  const createDefaultProps = (node: TreeNode): TreeItemProps => ({
    node,
    selectedFiles: [],
    toggleFileSelection: mockToggleFileSelection,
    toggleFolderSelection: mockToggleFolderSelection,
    toggleExpanded: mockToggleExpanded,
    onViewFile: mockOnViewFile,
    loadFileContent: mockLoadFileContent
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Folder Expansion on First Click', () => {
    it('should expand a collapsed folder on first click', async () => {
      // Setup: Folder starts collapsed
      const folderNode = createFolderNode('/test/folder', false);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      
      // Find the toggle button (chevron) for the folder
      const toggleButton = container.querySelector('.tree-item-toggle');
      expect(toggleButton).toBeInTheDocument();
      
      // Action: Click to expand
      fireEvent.click(toggleButton!);
      
      // Assertion: toggleExpanded should be called with path and current state (false)
      expect(mockToggleExpanded).toHaveBeenCalledTimes(1);
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', false);
    });

    it('should collapse an expanded folder on first click', async () => {
      // Setup: Folder starts expanded
      const folderNode = createFolderNode('/test/folder', true);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      
      // Find the toggle button (chevron) for the folder
      const toggleButton = container.querySelector('.tree-item-toggle');
      expect(toggleButton).toBeInTheDocument();
      
      // Action: Click to collapse
      fireEvent.click(toggleButton!);
      
      // Assertion: toggleExpanded should be called with path and current state (true)
      expect(mockToggleExpanded).toHaveBeenCalledTimes(1);
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', true);
    });
  });

  describe('Multiple Folder Toggle Behavior', () => {
    it('should handle multiple folders being toggled independently', async () => {
      // Setup: Create two separate folder components
      const folder1 = createFolderNode('/folder1', false);
      const folder2 = createFolderNode('/folder2', true);
      
      const props1 = createDefaultProps(folder1);
      const props2 = createDefaultProps(folder2);

      const { container: container1 } = render(<TreeItem {...props1} />);
      const { container: container2 } = render(<TreeItem {...props2} />);
      
      const toggle1 = container1.querySelector('.tree-item-toggle');
      const toggle2 = container2.querySelector('.tree-item-toggle');
      
      // Action: Toggle both folders
      fireEvent.click(toggle1!);
      fireEvent.click(toggle2!);
      
      // Assertions: Each folder should toggle with its own state
      expect(mockToggleExpanded).toHaveBeenCalledTimes(2);
      expect(mockToggleExpanded).toHaveBeenNthCalledWith(1, '/folder1', false);
      expect(mockToggleExpanded).toHaveBeenNthCalledWith(2, '/folder2', true);
    });
  });

  describe('Folder Click vs Chevron Click', () => {
    it('should expand folder when clicking on folder name', async () => {
      const folderNode = createFolderNode('/test/folder', false);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      
      // Find and click the folder item itself (not the chevron)
      const folderItem = container.querySelector('.tree-item');
      expect(folderItem).toBeInTheDocument();
      
      // Click on the folder item area (not on interactive elements)
      fireEvent.click(folderItem!);
      
      // Should trigger expansion with current state
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', false);
    });

    it('should not double-toggle when clicking chevron', async () => {
      const folderNode = createFolderNode('/test/folder', false);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      
      const toggleButton = container.querySelector('.tree-item-toggle');
      
      // Click chevron should only trigger once
      fireEvent.click(toggleButton!);
      
      expect(mockToggleExpanded).toHaveBeenCalledTimes(1);
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', false);
    });
  });

  describe('Auto-expansion on Selection', () => {
    it('should auto-expand folder when selecting it via checkbox', async () => {
      const folderNode = createFolderNode('/test/folder', false);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      
      // Find and check the folder checkbox
      const checkbox = container.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeInTheDocument();
      
      // Check the checkbox to select the folder
      fireEvent.click(checkbox!);
      
      // Should call toggleFolderSelection and auto-expand
      expect(mockToggleFolderSelection).toHaveBeenCalledWith(
        '/test/folder', 
        true, 
        { optimistic: true }
      );
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', false);
    });

    it('should not auto-expand if folder is already expanded', async () => {
      const folderNode = createFolderNode('/test/folder', true);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      
      const checkbox = container.querySelector('input[type="checkbox"]');
      
      // Check the checkbox
      fireEvent.click(checkbox!);
      
      // Should call toggleFolderSelection but NOT toggleExpanded
      expect(mockToggleFolderSelection).toHaveBeenCalled();
      expect(mockToggleExpanded).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid consecutive clicks gracefully', async () => {
      const folderNode = createFolderNode('/test/folder', false);
      const props = createDefaultProps(folderNode);

      const { container } = render(<TreeItem {...props} />);
      const toggleButton = container.querySelector('.tree-item-toggle');
      
      // Rapid clicks
      fireEvent.click(toggleButton!);
      fireEvent.click(toggleButton!);
      fireEvent.click(toggleButton!);
      
      // All clicks should be processed with correct state
      expect(mockToggleExpanded).toHaveBeenCalledTimes(3);
      // Each call should pass the initial state since we're not re-rendering
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', false);
    });

    it('should maintain correct state after re-render', async () => {
      const folderNode = createFolderNode('/test/folder', false);
      const props = createDefaultProps(folderNode);

      const { container, rerender } = render(<TreeItem {...props} />);
      
      // First click
      const toggleButton = container.querySelector('.tree-item-toggle');
      fireEvent.click(toggleButton!);
      
      expect(mockToggleExpanded).toHaveBeenCalledWith('/test/folder', false);
      
      // Simulate state update and re-render with expanded state
      const expandedNode = createFolderNode('/test/folder', true);
      const newProps = createDefaultProps(expandedNode);
      rerender(<TreeItem {...newProps} />);
      
      // Click again after re-render
      fireEvent.click(toggleButton!);
      
      // Should now pass true as current state
      expect(mockToggleExpanded).toHaveBeenLastCalledWith('/test/folder', true);
    });
  });

  describe('File vs Folder Behavior', () => {
    it('should not call toggleExpanded for file items', async () => {
      const fileNode: TreeNode = {
        id: '/test.js',
        name: 'test.js',
        path: '/test.js',
        type: 'file',
        level: 0,
        fileData: {
          name: 'test.js',
          path: '/test.js',
          isDirectory: false,
          size: 100,
          isBinary: false,
          content: 'test',
          tokenCount: 1,
          isContentLoaded: true,
          isSkipped: false
        }
      };
      
      const props = createDefaultProps(fileNode);
      const { container } = render(<TreeItem {...props} />);
      
      // Click on file item
      const fileItem = container.querySelector('.tree-item');
      fireEvent.click(fileItem!);
      
      // Should not trigger expansion for files
      expect(mockToggleExpanded).not.toHaveBeenCalled();
    });
  });
});