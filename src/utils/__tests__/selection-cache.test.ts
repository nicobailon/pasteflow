import { createDirectorySelectionCache, updateSelectionCacheForFolder } from '../selection-cache';
import type { SelectionState } from '../selection-cache';
import type { FileData, SelectedFileReference, LineRange } from '../../types/file-types';

describe('selection-cache', () => {
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

  const createSelectedRef = (path: string, lines?: LineRange[]): SelectedFileReference => ({
    path,
    lines,
  });

  describe('createDirectorySelectionCache', () => {
    it('should mark directories as full when all files are selected', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/file1.ts'),
        createMockFile('/src/file2.ts'),
        createMockFile('/src/components/button.tsx'),
        createMockFile('/src/components/input.tsx'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/src/file1.ts'),
        createSelectedRef('/src/file2.ts'),
        createSelectedRef('/src/components/button.tsx'),
        createSelectedRef('/src/components/input.tsx'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('src')).toBe('full');
      expect(cache.get('/src')).toBe('full');
      expect(cache.get('src/components')).toBe('full');
      expect(cache.get('/src/components')).toBe('full');
    });

    it('should mark directories as partial when some files are selected', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/file1.ts'),
        createMockFile('/src/file2.ts'),
        createMockFile('/src/file3.ts'),
        createMockFile('/test/test1.ts'),
        createMockFile('/test/test2.ts'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/src/file1.ts'),
        createSelectedRef('/src/file2.ts'),
        createSelectedRef('/test/test1.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('src')).toBe('partial');
      expect(cache.get('/src')).toBe('partial');
      expect(cache.get('test')).toBe('partial');
      expect(cache.get('/test')).toBe('partial');
    });

    it('should mark directories as none when no files are selected', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/file1.ts'),
        createMockFile('/src/file2.ts'),
        createMockFile('/test/test1.ts'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/test/test1.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('src')).toBe('none');
      expect(cache.get('/src')).toBe('none');
      expect(cache.get('test')).toBe('full');
    });

    it('should skip binary and skipped files when calculating selection state', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/code.ts'),
        createMockFile('/src/image.png', { isBinary: true }),
        createMockFile('/src/hidden.ts', { isSkipped: true }),
        createMockFile('/src/valid.ts'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/src/code.ts'),
        createSelectedRef('/src/valid.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('src')).toBe('full');
      expect(cache.get('/src')).toBe('full');
    });

    it('should handle root files correctly', () => {
      const allFiles: FileData[] = [
        createMockFile('/README.md'),
        createMockFile('/LICENSE'),
        createMockFile('/package.json'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/README.md'),
        createSelectedRef('/LICENSE'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('/')).toBe('partial');
      expect(cache.get('')).toBe('none');
    });

    it('should handle deeply nested directories', () => {
      const allFiles: FileData[] = [
        createMockFile('/a/b/c/d/e/file1.ts'),
        createMockFile('/a/b/c/d/e/file2.ts'),
        createMockFile('/a/b/other.ts'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/a/b/c/d/e/file1.ts'),
        createSelectedRef('/a/b/c/d/e/file2.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('a/b/c/d/e')).toBe('full');
      expect(cache.get('a/b/c/d')).toBe('full');
      expect(cache.get('a/b/c')).toBe('full');
      expect(cache.get('a/b')).toBe('partial');
      expect(cache.get('a')).toBe('partial');
    });

    it('should handle empty directories', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/utils/helpers.ts'),
        createMockFile('/docs/readme.md'),
      ];

      const selectedFiles: SelectedFileReference[] = [];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('src')).toBe('none');
      expect(cache.get('src/utils')).toBe('none');
      expect(cache.get('docs')).toBe('none');
    });

    it('should return none for non-existent directories', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/file.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, []);

      expect(cache.get('/non-existent')).toBe('none');
      expect(cache.get('non-existent')).toBe('none');
      expect(cache.get('/deeply/nested/non-existent')).toBe('none');
    });
  });

  describe('DirectorySelectionCache methods', () => {
    it('should allow setting and getting states', () => {
      const cache = createDirectorySelectionCache([], []);

      cache.set('/test', 'full');
      expect(cache.get('/test')).toBe('full');
      expect(cache.get('test')).toBe('full');

      cache.set('another', 'partial');
      expect(cache.get('another')).toBe('partial');
      expect(cache.get('/another')).toBe('partial');
    });

    it('should handle bulk updates', () => {
      const cache = createDirectorySelectionCache([], []);

      const updates = new Map<string, SelectionState>([
        ['/src', 'full'],
        ['/test', 'partial'],
        ['/docs', 'none'],
      ]);

      cache.bulkUpdate(updates);

      expect(cache.get('/src')).toBe('full');
      expect(cache.get('/test')).toBe('partial');
      expect(cache.get('/docs')).toBe('none');
    });

    it('should clear all entries', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/file1.ts'),
        createMockFile('/test/test1.ts'),
      ];

      const selectedFiles: SelectedFileReference[] = [
        createSelectedRef('/src/file1.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, selectedFiles);

      expect(cache.get('src')).toBe('full');
      expect(cache.get('test')).toBe('none');

      cache.clear();

      expect(cache.get('src')).toBe('none');
      expect(cache.get('test')).toBe('none');
    });

    it('should normalize paths when setting', () => {
      const cache = createDirectorySelectionCache([], []);

      cache.set('src/components', 'full');

      expect(cache.get('src/components')).toBe('full');
      expect(cache.get('/src/components')).toBe('full');
    });
  });

  describe('updateSelectionCacheForFolder', () => {
    it('should update specific folder state', () => {
      const allFiles: FileData[] = [
        createMockFile('/src/file1.ts'),
        createMockFile('/src/file2.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, []);

      expect(cache.get('src')).toBe('none');

      updateSelectionCacheForFolder(cache, 'src', 'full', allFiles);

      expect(cache.get('src')).toBe('full');
      expect(cache.get('/src')).toBe('full');
    });

    it('should not update parent directories', () => {
      const allFiles: FileData[] = [
        createMockFile('/a/b/c/file.ts'),
        createMockFile('/a/other.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, []);

      updateSelectionCacheForFolder(cache, 'a/b/c', 'full', allFiles);

      expect(cache.get('a/b/c')).toBe('full');
      expect(cache.get('a/b')).toBe('none');
      expect(cache.get('a')).toBe('none');
    });

    it('should handle root path updates', () => {
      const allFiles: FileData[] = [
        createMockFile('/file1.ts'),
        createMockFile('/file2.ts'),
      ];

      const cache = createDirectorySelectionCache(allFiles, []);

      updateSelectionCacheForFolder(cache, '/', 'partial', allFiles);

      expect(cache.get('/')).toBe('partial');
    });
  });
});