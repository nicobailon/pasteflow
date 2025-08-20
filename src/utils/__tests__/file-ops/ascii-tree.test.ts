import { generateAsciiFileTree } from '@file-ops/ascii-tree';

describe('ascii-tree utilities', () => {
  describe('generateAsciiFileTree', () => {
    it('should handle empty input', () => {
      expect(generateAsciiFileTree([], '/root')).toBe('No files selected.');
    });

    it('should generate tree for simple files', () => {
      const items = [
        { path: '/root/file1.txt', isFile: true },
        { path: '/root/file2.txt', isFile: true }
      ];
      
      const result = generateAsciiFileTree(items, '/root');
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
      expect(result).toContain('├──');
      expect(result).toContain('└──');
    });

    it('should handle mixed files and directories', () => {
      const items = [
        { path: '/root/dir1/file1.txt', isFile: true },
        { path: '/root/dir1', isFile: false },
        { path: '/root/file2.txt', isFile: true }
      ];
      
      const result = generateAsciiFileTree(items, '/root');
      expect(result).toContain('dir1');
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
    });

    it('should sort directories first, then alphabetically', () => {
      const items = [
        { path: '/root/zebra.txt', isFile: true },
        { path: '/root/apple.txt', isFile: true },
        { path: '/root/banana-dir', isFile: false }
      ];
      
      const result = generateAsciiFileTree(items, '/root');
      const lines = result.split('\n').filter(l => l.trim());
      
      // Directory should come first
      expect(lines[0]).toContain('banana-dir');
      // Then files alphabetically
      expect(lines[1]).toContain('apple.txt');
      expect(lines[2]).toContain('zebra.txt');
    });

    it('should handle deeply nested structures', () => {
      const items = [
        { path: '/root/a/b/c/d/file.txt', isFile: true }
      ];
      
      const result = generateAsciiFileTree(items, '/root');
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).toContain('d');
      expect(result).toContain('file.txt');
      
      // Check for proper indentation
      expect(result).toMatch(/│\s+/);
    });

    it('should handle files with same names in different directories', () => {
      const items = [
        { path: '/root/dir1/index.js', isFile: true },
        { path: '/root/dir2/index.js', isFile: true }
      ];
      
      const result = generateAsciiFileTree(items, '/root');
      expect(result).toContain('dir1');
      expect(result).toContain('dir2');
      expect(result.match(/index\.js/g)?.length).toBe(2);
    });

    it('should use proper tree characters', () => {
      const items = [
        { path: '/root/first.txt', isFile: true },
        { path: '/root/middle.txt', isFile: true },
        { path: '/root/last.txt', isFile: true }
      ];
      
      const result = generateAsciiFileTree(items, '/root');
      expect(result).toContain('├──'); // Middle items
      expect(result).toContain('└──'); // Last item
    });
  });
});