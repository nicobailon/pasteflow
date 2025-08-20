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
      // Windows path would need normalization first
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

  describe.skip('Windows path handling (Node.js only)', () => {
    it('should normalize Windows paths with drive letters', () => {
      expect(normalizePath('C:\\root\\dir\\')).toBe('C:/root/dir');
      expect(normalizePath('C:\\root\\dir\\file.txt')).toBe('C:/root/dir/file.txt');
      expect(normalizePath('D:\\')).toBe('D:/');
    });

    it('should handle relative paths on Windows', () => {
      expect(getRelativePath('C:\\root\\dir\\file.txt', 'C:\\root')).toBe('dir/file.txt');
      expect(getRelativePath('C:\\root\\dir\\subdir\\file.txt', 'C:\\root\\dir')).toBe('subdir/file.txt');
      expect(getRelativePath('C:\\root\\file.txt', 'C:\\root')).toBe('file.txt');
    });

    it('should handle UNC paths', () => {
      expect(normalizePath('\\\\server\\share\\root\\dir\\')).toBe('//server/share/root/dir');
      expect(normalizePath('\\\\server\\share\\root\\file.txt')).toBe('//server/share/root/file.txt');
    });

    it('should handle UNC relative paths', () => {
      expect(getRelativePath('\\\\server\\share\\root\\dir\\file.txt', '\\\\server\\share\\root'))
        .toBe('dir/file.txt');
      expect(getRelativePath('\\\\server\\share\\root\\dir\\subdir\\file.txt', '\\\\server\\share\\root\\dir'))
        .toBe('subdir/file.txt');
    });

    it('should handle mixed path separators', () => {
      expect(normalizePath('C:/root\\dir/file.txt')).toBe('C:/root/dir/file.txt');
      expect(normalizePath('\\\\server/share\\dir/file.txt')).toBe('//server/share/dir/file.txt');
    });

    it('should handle Windows path edge cases', () => {
      expect(normalizePath('C:')).toBe('C:');
      expect(normalizePath('C:\\')).toBe('C:/');
      expect(normalizePath('C:\\.')).toBe('C:/');
      expect(normalizePath('C:\\..')).toBe('C:/');
    });

    it('should handle drive letter changes in relative paths', () => {
      // Different drives should return the absolute path
      expect(getRelativePath('D:\\file.txt', 'C:\\root')).toBe('D:/file.txt');
      expect(getRelativePath('C:\\file.txt', 'D:\\root')).toBe('C:/file.txt');
    });
  });
});