import { buildFolderIndex, getFilesInFolder, updateFolderIndex } from '../folder-selection-index';
import type { FileData } from '../../types/file-types';

// Test constants
const TEST_FILE1_PATH = '/src/file1.ts';
const TEST_FILE2_PATH = '/src/file2.ts';
const TEST_VALID_PATH = '/src/valid.ts';
const TEST_DEEP_FILE_PATH = '/a/b/c/d/e/file.ts';

// Helper function to create mock file data
const createMockFile = (path: string, options: Partial<FileData> = {}): FileData => ({
  name: path.split('/').pop() || '',
  path,
  isDirectory: false,
  size: 100,
  isBinary: false,
  isSkipped: false,
  isContentLoaded: false,
  tokenCount: 0,
  ...options,
});

describe('folder-selection-index', () => {

  describe('buildFolderIndex', () => {
    it('should build index with files in nested folders', () => {
      const files: FileData[] = [
        createMockFile('/src/components/button.tsx'),
        createMockFile('/src/components/input.tsx'),
        createMockFile('/src/hooks/use-state.ts'),
        createMockFile('/src/utils/helpers.ts'),
        createMockFile('/README.md'),
      ];

      const index = buildFolderIndex(files);

      expect(index.size).toBe(4);
      expect(index.get('/src/components')).toEqual([
        '/src/components/button.tsx',
        '/src/components/input.tsx',
      ]);
      expect(index.get('/src/hooks')).toEqual(['/src/hooks/use-state.ts']);
      expect(index.get('/src/utils')).toEqual(['/src/utils/helpers.ts']);
      expect(index.get('/')).toEqual(['/README.md']);
    });

    it('should skip binary and skipped files', () => {
      const files: FileData[] = [
        createMockFile('/src/code.ts'),
        createMockFile('/src/image.png', { isBinary: true }),
        createMockFile('/src/hidden.ts', { isSkipped: true }),
        createMockFile(TEST_VALID_PATH),
      ];

      const index = buildFolderIndex(files);

      expect(index.get('/src')).toEqual(['/src/code.ts', TEST_VALID_PATH]);
      expect(index.get('/src')).not.toContain('/src/image.png');
      expect(index.get('/src')).not.toContain('/src/hidden.ts');
    });

    it('should handle deeply nested folder structures', () => {
      const files: FileData[] = [
        createMockFile(TEST_DEEP_FILE_PATH),
        createMockFile('/a/b/c/other.ts'),
        createMockFile('/a/root.ts'),
      ];

      const index = buildFolderIndex(files);

      expect(index.get('/a')).toContain(TEST_DEEP_FILE_PATH);
      expect(index.get('/a')).toContain('/a/b/c/other.ts');
      expect(index.get('/a')).toContain('/a/root.ts');
      expect(index.get('/a/b')).toContain(TEST_DEEP_FILE_PATH);
      expect(index.get('/a/b')).toContain('/a/b/c/other.ts');
      expect(index.get('/a/b/c')).toContain(TEST_DEEP_FILE_PATH);
      expect(index.get('/a/b/c')).toContain('/a/b/c/other.ts');
      expect(index.get('/a/b/c/d')).toEqual([TEST_DEEP_FILE_PATH]);
      expect(index.get('/a/b/c/d/e')).toEqual([TEST_DEEP_FILE_PATH]);
    });

    it('should handle files with no path gracefully', () => {
      const files: FileData[] = [
        createMockFile('/valid/file.ts'),
        createMockFile('', { path: '' }),
        createMockFile('/another/file.ts'),
      ];

      const index = buildFolderIndex(files);

      expect(index.get('/valid')).toEqual(['/valid/file.ts']);
      expect(index.get('/another')).toEqual(['/another/file.ts']);
      expect([...index.values()].flat()).not.toContain('');
    });

    it('should handle empty file array', () => {
      const index = buildFolderIndex([]);

      expect(index.size).toBe(0);
      expect([...index.keys()]).toEqual([]);
    });

    it('should deduplicate files in the same folder', () => {
      const files: FileData[] = [
        createMockFile(TEST_FILE1_PATH),
        createMockFile(TEST_FILE2_PATH),
        createMockFile('/src/sub/file3.ts'),
      ];

      const index = buildFolderIndex(files);

      expect(index.get('/src')).toHaveLength(3);
      expect(index.get('/src/sub')).toHaveLength(1);
      expect(new Set(index.get('/src')).size).toBe(3);
    });
  });

  describe('getFilesInFolder', () => {
    it('should return files for existing folder', () => {
      const index = new Map([
        ['/src', [TEST_FILE1_PATH, TEST_FILE2_PATH]],
        ['/test', ['/test/test1.ts']],
      ]);

      const files = getFilesInFolder(index, '/src');

      expect(files).toEqual([TEST_FILE1_PATH, TEST_FILE2_PATH]);
      expect(files).toHaveLength(2);
    });

    it('should return empty array for non-existent folder', () => {
      const index = new Map([
        ['/src', [TEST_FILE1_PATH]],
      ]);

      const files = getFilesInFolder(index, '/non-existent');

      expect(files).toEqual([]);
      expect(files).toHaveLength(0);
    });

    it('should handle edge cases', () => {
      const index = new Map();

      expect(getFilesInFolder(index, '/')).toEqual([]);
      expect(getFilesInFolder(index, '')).toEqual([]);
      expect(getFilesInFolder(index, '/any/path')).toEqual([]);
    });
  });

  describe('updateFolderIndex', () => {
    it('should add new files to existing index', () => {
      const index = new Map([
        ['/src', ['/src/existing.ts']],
      ]);

      const addedFiles = [
        createMockFile('/src/new1.ts'),
        createMockFile('/src/components/new2.tsx'),
        createMockFile('/test/new3.ts'),
      ];

      updateFolderIndex(index, addedFiles, []);

      expect(index.get('/src')).toContain('/src/existing.ts');
      expect(index.get('/src')).toContain('/src/new1.ts');
      expect(index.get('/src')).toContain('/src/components/new2.tsx');
      expect(index.get('/src/components')).toEqual(['/src/components/new2.tsx']);
      expect(index.get('/test')).toEqual(['/test/new3.ts']);
    });

    it('should remove files and clean up empty folders', () => {
      const index = new Map([
        ['/src', [TEST_FILE1_PATH, TEST_FILE2_PATH, '/src/components/comp.tsx']],
        ['/src/components', ['/src/components/comp.tsx']],
        ['/test', ['/test/test.ts']],
      ]);

      const removedFiles = [
        createMockFile('/src/components/comp.tsx'),
        createMockFile('/test/test.ts'),
      ];

      updateFolderIndex(index, [], removedFiles);

      expect(index.get('/src')).toEqual([TEST_FILE1_PATH, TEST_FILE2_PATH]);
      expect(index.has('/src/components')).toBe(false);
      expect(index.has('/test')).toBe(false);
      expect(index.size).toBe(1);
    });

    it('should handle simultaneous adds and removes', () => {
      const index = new Map([
        ['/src', ['/src/old1.ts', '/src/old2.ts']],
        ['/test', ['/test/old3.ts']],
      ]);

      const addedFiles = [
        createMockFile('/src/new1.ts'),
        createMockFile('/docs/new2.md'),
      ];

      const removedFiles = [
        createMockFile('/src/old1.ts'),
        createMockFile('/test/old3.ts'),
      ];

      updateFolderIndex(index, addedFiles, removedFiles);

      expect(index.get('/src')).toEqual(['/src/old2.ts', '/src/new1.ts']);
      expect(index.has('/test')).toBe(false);
      expect(index.get('/docs')).toEqual(['/docs/new2.md']);
    });

    it('should skip binary and skipped files during updates', () => {
      const index = new Map();

      const addedFiles = [
        createMockFile(TEST_VALID_PATH),
        createMockFile('/src/binary.png', { isBinary: true }),
        createMockFile('/src/skipped.ts', { isSkipped: true }),
      ];

      updateFolderIndex(index, addedFiles, []);

      expect(index.get('/src')).toEqual([TEST_VALID_PATH]);
      expect(index.get('/src')).not.toContain('/src/binary.png');
      expect(index.get('/src')).not.toContain('/src/skipped.ts');
    });

    it('should handle root files correctly', () => {
      const index = new Map([
        ['/', ['/existing.md']],
      ]);

      const addedFiles = [createMockFile('/new.txt')];
      const removedFiles = [createMockFile('/existing.md')];

      updateFolderIndex(index, addedFiles, removedFiles);

      expect(index.get('/')).toEqual(['/new.txt']);
      expect(index.get('/')).not.toContain('/existing.md');
    });

    it('should handle files with missing paths gracefully', () => {
      const index = new Map([
        ['/src', ['/src/file.ts']],
      ]);

      const addedFiles = [
        createMockFile('', { path: '' }),
        createMockFile(TEST_VALID_PATH),
      ];

      const removedFiles = [
        createMockFile('', { path: '' }),
      ];

      updateFolderIndex(index, addedFiles, removedFiles);

      expect(index.get('/src')).toContain(TEST_VALID_PATH);
      expect(index.get('/src')).toHaveLength(2);
    });
  });
});