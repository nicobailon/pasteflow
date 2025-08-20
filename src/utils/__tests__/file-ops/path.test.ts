import {
  basename,
  dirname,
  join,
  extname,
  normalizePath,
  getRelativePath,
  getTopLevelDirectories,
  getAllDirectories
} from '@file-ops/path';

describe('path utilities', () => {
  describe('basename', () => {
    it('should extract basename from path', () => {
      expect(basename('/path/to/file.txt')).toBe('file.txt');
      expect(basename('\\windows\\path\\file.txt')).toBe('file.txt');
      expect(basename('file.txt')).toBe('file.txt');
    });

    it('should handle edge cases', () => {
      expect(basename('')).toBe('');
      expect(basename(null)).toBe('');
      expect(basename(undefined)).toBe('');
      expect(basename('/')).toBe('');
      expect(basename('/path/to/dir/')).toBe('dir');
    });
  });

  describe('dirname', () => {
    it('should extract directory from path', () => {
      expect(dirname('/path/to/file.txt')).toBe('/path/to');
      expect(dirname('file.txt')).toBe('.');
      expect(dirname('/file.txt')).toBe('/');
    });

    it('should handle edge cases', () => {
      expect(dirname('')).toBe('.');
      expect(dirname(null)).toBe('.');
      expect(dirname(undefined)).toBe('.');
      expect(dirname('/')).toBe('/');
    });
  });

  describe('join', () => {
    it('should join path segments', () => {
      expect(join('path', 'to', 'file.txt')).toBe('path/to/file.txt');
      expect(join('/path', 'to', 'file.txt')).toBe('/path/to/file.txt');
    });

    it('should handle null/undefined segments', () => {
      expect(join('path', null, 'file.txt')).toBe('path/file.txt');
      expect(join('path', undefined, 'file.txt')).toBe('path/file.txt');
    });
  });

  describe('extname', () => {
    it('should extract file extension', () => {
      expect(extname('file.txt')).toBe('.txt');
      expect(extname('file.with.many.dots.js')).toBe('.js');
      expect(extname('/path/to/file.tsx')).toBe('.tsx');
    });

    it('should handle special cases', () => {
      expect(extname('.gitignore')).toBe('');
      expect(extname('.bashrc')).toBe('');
      expect(extname('file')).toBe('');
      expect(extname('')).toBe('');
      expect(extname(null)).toBe('');
      expect(extname(undefined)).toBe('');
    });
  });

  describe('normalizePath', () => {
    it('should normalize paths', () => {
      expect(normalizePath('/path/to/file')).toBe('/path/to/file');
      expect(normalizePath('\\windows\\path\\file')).toBe('/windows/path/file');
      expect(normalizePath('/path/to/dir/')).toBe('/path/to/dir');
      expect(normalizePath('/')).toBe('/');
    });

    it('should handle edge cases', () => {
      expect(normalizePath('')).toBe('');
      expect(normalizePath(null)).toBe('');
      expect(normalizePath(undefined)).toBe('');
    });
  });

  describe('getRelativePath', () => {
    it('should compute relative paths', () => {
      expect(getRelativePath('/root/path/file.txt', '/root')).toBe('path/file.txt');
      expect(getRelativePath('/root/file.txt', '/root')).toBe('file.txt');
      expect(getRelativePath('/root/path/file.txt', '/root/path')).toBe('file.txt');
    });

    it('should handle edge cases', () => {
      expect(getRelativePath('', '/root')).toBe('');
      expect(getRelativePath('/file.txt', null)).toBe('/file.txt');
      expect(getRelativePath('/file.txt', undefined)).toBe('/file.txt');
      expect(getRelativePath('/other/file.txt', '/root')).toMatch(/file.txt/);
    });
  });

  describe('getTopLevelDirectories', () => {
    it('should extract top-level directories', () => {
      const files = [
        { path: '/root/dir1/file1.txt' },
        { path: '/root/dir1/subdir/file2.txt' },
        { path: '/root/dir2/file3.txt' }
      ];
      
      const result = getTopLevelDirectories(files, '/root');
      expect(result).toContain('/root/dir1');
      expect(result).toContain('/root/dir2');
      expect(result).toHaveLength(2);
    });

    it('should handle empty input', () => {
      expect(getTopLevelDirectories([], '/root')).toEqual([]);
    });
  });

  describe('getAllDirectories', () => {
    it('should extract all directories', () => {
      const files = [
        { path: '/root/dir1/file1.txt' },
        { path: '/root/dir1/subdir/file2.txt' },
        { path: '/root/dir2/file3.txt' }
      ];
      
      const result = getAllDirectories(files, '/root');
      expect(result).toContain('/root/dir1');
      expect(result).toContain('/root/dir1/subdir');
      expect(result).toContain('/root/dir2');
    });

    it('should handle empty input', () => {
      expect(getAllDirectories([], '/root')).toEqual([]);
    });

    it('should skip paths outside root', () => {
      const files = [
        { path: '/root/dir1/file1.txt' },
        { path: '/other/dir2/file2.txt' }
      ];
      
      const result = getAllDirectories(files, '/root');
      expect(result).toContain('/root/dir1');
      expect(result).not.toContain('/other/dir2');
    });
  });
});