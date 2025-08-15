import {
  getAllDirectoryNodeIds,
  getCollapsedDirectoryNodeIds,
  areAllDirectoriesExpanded,
  hasAnyExpandedFolders
} from '../utils/tree-node-utils';
import { TreeNode } from '../types/file-types';

describe('tree-node-utils', () => {
  describe('getAllDirectoryNodeIds', () => {
    it('should return empty array when given empty nodes', () => {
      const result = getAllDirectoryNodeIds([]);
      
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should extract all directory node IDs from flat structure', () => {
      const nodes: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'file1', name: 'file1.ts', type: 'file', path: '/file1.ts', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 },
        { id: 'file2', name: 'file2.ts', type: 'file', path: '/file2.ts', level: 0 }
      ];
      
      const result = getAllDirectoryNodeIds(nodes);
      
      expect(result).toEqual(['dir1', 'dir2']);
      expect(result).toHaveLength(2);
      expect(result).not.toContain('file1');
      expect(result).not.toContain('file2');
    });

    it('should recursively extract directory IDs from nested structures', () => {
      const nodes: TreeNode[] = [
        {
          id: 'root',
          name: 'root',
          type: 'directory',
          path: '/root',
          level: 0,
          children: [
            { id: 'file1', name: 'file1.ts', type: 'file', path: '/root/file1.ts', level: 1 },
            {
              id: 'subdir',
              name: 'subdir',
              type: 'directory',
              path: '/root/subdir',
              level: 1,
              children: [
                { id: 'file2', name: 'file2.ts', type: 'file', path: '/root/subdir/file2.ts', level: 2 },
                {
                  id: 'deepdir',
                  name: 'deepdir',
                  type: 'directory',
                  path: '/root/subdir/deepdir',
                  level: 2,
                  children: []
                }
              ]
            }
          ]
        }
      ];
      
      const result = getAllDirectoryNodeIds(nodes);
      
      expect(result).toEqual(['root', 'subdir', 'deepdir']);
      expect(result).toHaveLength(3);
      expect(result.every(id => id.includes('dir') || id === 'root')).toBe(true);
    });

    it('should handle nodes with undefined children property', () => {
      const nodes: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0, children: undefined }
      ];
      
      const result = getAllDirectoryNodeIds(nodes);
      
      expect(result).toEqual(['dir1', 'dir2']);
      expect(result).toHaveLength(2);
    });

    it('should handle deeply nested directory structures', () => {
      const createNestedStructure = (depth: number, prefix = ''): TreeNode => {
        if (depth === 0) {
          return {
            id: `${prefix}leaf`,
            name: `${prefix}leaf`,
            type: 'directory',
            path: `/${prefix}leaf`,
            level: depth,
            children: []
          };
        }
        return {
          id: `${prefix}dir${depth}`,
          name: `${prefix}dir${depth}`,
          type: 'directory',
          path: `/${prefix}dir${depth}`,
          level: 5 - depth,
          children: [createNestedStructure(depth - 1, `${prefix}${depth}-`)]
        };
      };

      const nodes = [createNestedStructure(5)];
      const result = getAllDirectoryNodeIds(nodes);
      
      expect(result).toHaveLength(6);
      expect(result[0]).toBe('dir5');
      expect(result[result.length - 1]).toBe('5-4-3-2-1-leaf');
    });
  });

  describe('getCollapsedDirectoryNodeIds', () => {
    it('should return empty array when no directories exist', () => {
      const nodes: TreeNode[] = [
        { id: 'file1', name: 'file1.ts', type: 'file', path: '/file1.ts', level: 0 },
        { id: 'file2', name: 'file2.ts', type: 'file', path: '/file2.ts', level: 0 }
      ];
      const expandedNodes = {};
      
      const result = getCollapsedDirectoryNodeIds(nodes, expandedNodes);
      
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should return all directories when none are expanded', () => {
      const nodes: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 }
      ];
      const expandedNodes = {};
      
      const result = getCollapsedDirectoryNodeIds(nodes, expandedNodes);
      
      expect(result).toEqual(['dir1', 'dir2']);
      expect(result).toHaveLength(2);
    });

    it('should exclude expanded directories from results', () => {
      const nodes: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 },
        { id: 'dir3', name: 'folder3', type: 'directory', path: '/folder3', level: 0 }
      ];
      const expandedNodes = { 'dir1': true, 'dir3': true };
      
      const result = getCollapsedDirectoryNodeIds(nodes, expandedNodes);
      
      expect(result).toEqual(['dir2']);
      expect(result).toHaveLength(1);
      expect(result).not.toContain('dir1');
      expect(result).not.toContain('dir3');
    });

    it('should handle nested directories with mixed expansion states', () => {
      const nodes: TreeNode[] = [
        {
          id: 'root',
          name: 'root',
          type: 'directory',
          path: '/root',
          level: 0,
          children: [
            {
              id: 'subdir1',
              name: 'subdir1',
              type: 'directory',
              path: '/root/subdir1',
              level: 1,
              children: [
                {
                  id: 'deepdir1',
                  name: 'deepdir1',
                  type: 'directory',
                  path: '/root/subdir1/deepdir1',
                  level: 2
                }
              ]
            },
            {
              id: 'subdir2',
              name: 'subdir2',
              type: 'directory',
              path: '/root/subdir2',
              level: 1
            }
          ]
        }
      ];
      const expandedNodes = { 'root': true, 'subdir1': false, 'subdir2': true };
      
      const result = getCollapsedDirectoryNodeIds(nodes, expandedNodes);
      
      expect(result).toContain('subdir1');
      expect(result).toContain('deepdir1');
      expect(result).not.toContain('root');
      expect(result).not.toContain('subdir2');
      expect(result).toHaveLength(2);
    });

    it('should handle false values in expandedNodes explicitly', () => {
      const nodes: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 }
      ];
      const expandedNodes = { 'dir1': false, 'dir2': true };
      
      const result = getCollapsedDirectoryNodeIds(nodes, expandedNodes);
      
      expect(result).toEqual(['dir1']);
      expect(result).toHaveLength(1);
    });
  });

  describe('areAllDirectoriesExpanded', () => {
    it('should return true when no directories exist in tree', () => {
      const fileTree: TreeNode[] = [
        { id: 'file1', name: 'file1.ts', type: 'file', path: '/file1.ts', level: 0 },
        { id: 'file2', name: 'file2.ts', type: 'file', path: '/file2.ts', level: 0 }
      ];
      const expandedNodes = {};
      
      const result = areAllDirectoriesExpanded(fileTree, expandedNodes);
      
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should return true when all directories are expanded', () => {
      const fileTree: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 }
      ];
      const expandedNodes = { 'dir1': true, 'dir2': true };
      
      const result = areAllDirectoriesExpanded(fileTree, expandedNodes);
      
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should return false when at least one directory is collapsed', () => {
      const fileTree: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 },
        { id: 'dir3', name: 'folder3', type: 'directory', path: '/folder3', level: 0 }
      ];
      const expandedNodes = { 'dir1': true, 'dir2': false, 'dir3': true };
      
      const result = areAllDirectoriesExpanded(fileTree, expandedNodes);
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should check nested directories recursively', () => {
      const fileTree: TreeNode[] = [
        {
          id: 'root',
          name: 'root',
          type: 'directory',
          path: '/root',
          level: 0,
          children: [
            {
              id: 'nested',
              name: 'nested',
              type: 'directory',
              path: '/root/nested',
              level: 1
            }
          ]
        }
      ];
      
      const allExpanded = { 'root': true, 'nested': true };
      const partiallyExpanded = { 'root': true, 'nested': false };
      
      expect(areAllDirectoriesExpanded(fileTree, allExpanded)).toBe(true);
      expect(areAllDirectoriesExpanded(fileTree, partiallyExpanded)).toBe(false);
    });

    it('should handle missing entries in expandedNodes as collapsed', () => {
      const fileTree: TreeNode[] = [
        { id: 'dir1', name: 'folder1', type: 'directory', path: '/folder1', level: 0 },
        { id: 'dir2', name: 'folder2', type: 'directory', path: '/folder2', level: 0 }
      ];
      const expandedNodes = { 'dir1': true };
      
      const result = areAllDirectoriesExpanded(fileTree, expandedNodes);
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('hasAnyExpandedFolders', () => {
    it('should return false when expandedNodes is empty', () => {
      const expandedNodes = {};
      
      const result = hasAnyExpandedFolders(expandedNodes);
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should return false when all values are false', () => {
      const expandedNodes = {
        'dir1': false,
        'dir2': false,
        'dir3': false
      };
      
      const result = hasAnyExpandedFolders(expandedNodes);
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should return true when at least one value is true', () => {
      const expandedNodes = {
        'dir1': false,
        'dir2': true,
        'dir3': false
      };
      
      const result = hasAnyExpandedFolders(expandedNodes);
      
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should return true when all values are true', () => {
      const expandedNodes = {
        'dir1': true,
        'dir2': true,
        'dir3': true
      };
      
      const result = hasAnyExpandedFolders(expandedNodes);
      
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should handle mixed boolean types correctly', () => {
      const expandedNodes = {
        'dir1': true,
        'dir2': false,
        'dir3': true,
        'dir4': false,
        'dir5': true
      };
      
      const result = hasAnyExpandedFolders(expandedNodes);
      
      expect(result).toBe(true);
      expect(expandedNodes['dir1']).toBe(true);
      expect(Object.values(expandedNodes).filter(Boolean).length).toBe(3);
    });
  });
});