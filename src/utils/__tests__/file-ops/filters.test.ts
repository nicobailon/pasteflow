import {
  shouldExcludeByDefault,
  BINARY_EXTENSIONS,
  isBinaryExtension,
  isLikelyBinaryContent,
  MAX_FILE_SIZE_BYTES
} from '@file-ops/filters';

// Mock the ignore-utils module
jest.mock('../../ignore-utils', () => ({
  loadGitignore: jest.fn(() => ({
    ignores: jest.fn((path: string) => {
      // Mock some common gitignore patterns
      return path.includes('node_modules') || 
             path.includes('.git') || 
             path.endsWith('.log') ||
             path.startsWith('dist/');
    })
  }))
}));

describe('filters utilities', () => {
  describe('BINARY_EXTENSIONS', () => {
    it('should contain common binary extensions', () => {
      expect(BINARY_EXTENSIONS.has('.jpg')).toBe(true);
      expect(BINARY_EXTENSIONS.has('.png')).toBe(true);
      expect(BINARY_EXTENSIONS.has('.pdf')).toBe(true);
      expect(BINARY_EXTENSIONS.has('.exe')).toBe(true);
      expect(BINARY_EXTENSIONS.has('.zip')).toBe(true);
    });

    it('should be readonly', () => {
      // Verify it's a Set
      expect(BINARY_EXTENSIONS).toBeInstanceOf(Set);
      // Verify it contains expected values
      expect(BINARY_EXTENSIONS.size).toBeGreaterThan(0);
      // The readonly nature is enforced at compile time by TypeScript
      // No runtime test needed for readonly constraint
    });
  });

  describe('isBinaryExtension', () => {
    it('should detect binary extensions', () => {
      expect(isBinaryExtension('.jpg')).toBe(true);
      expect(isBinaryExtension('jpg')).toBe(true);
      expect(isBinaryExtension('.PNG')).toBe(true);
      expect(isBinaryExtension('PDF')).toBe(true);
    });

    it('should reject non-binary extensions', () => {
      expect(isBinaryExtension('.txt')).toBe(false);
      expect(isBinaryExtension('.js')).toBe(false);
      expect(isBinaryExtension('.ts')).toBe(false);
      expect(isBinaryExtension('.json')).toBe(false);
    });
  });

  describe('isLikelyBinaryContent', () => {
    it('should detect binary content by control characters', () => {
      // String with many control characters
      const binaryContent = '\x00\x01\x02\x03'.repeat(20);
      expect(isLikelyBinaryContent(binaryContent, 'file.dat')).toBe(true);
    });

    it('should not flag JavaScript files as binary', () => {
      const jsContent = '\x00\x01\x02\x03'.repeat(20);
      expect(isLikelyBinaryContent(jsContent, 'file.js')).toBe(false);
      expect(isLikelyBinaryContent(jsContent, '/path/to/script.js')).toBe(false);
    });

    it('should handle normal text content', () => {
      const textContent = 'This is normal text content\nwith multiple lines\nand no binary data';
      expect(isLikelyBinaryContent(textContent, 'file.txt')).toBe(false);
    });

    it('should detect high-density non-ASCII characters', () => {
      // Create string with 50+ consecutive non-ASCII chars
      const nonAscii = '\x80\x81\x82\x83\x84'.repeat(15);
      expect(isLikelyBinaryContent(nonAscii, 'file.bin')).toBe(true);
    });
  });

  describe('shouldExcludeByDefault', () => {
    it('should exclude gitignored patterns', () => {
      expect(shouldExcludeByDefault('/root/node_modules/package.json', '/root')).toBe(true);
      expect(shouldExcludeByDefault('/root/.git/config', '/root')).toBe(true);
      expect(shouldExcludeByDefault('/root/app.log', '/root')).toBe(true);
      expect(shouldExcludeByDefault('/root/dist/bundle.js', '/root')).toBe(true);
    });

    it('should not exclude regular files', () => {
      expect(shouldExcludeByDefault('/root/src/index.js', '/root')).toBe(false);
      expect(shouldExcludeByDefault('/root/README.md', '/root')).toBe(false);
    });

    it('should handle Windows paths', () => {
      // The function should normalize backslashes
      expect(shouldExcludeByDefault('C:\\root\\node_modules\\file.js', 'C:\\root')).toBe(true);
    });
  });

  describe('MAX_FILE_SIZE_BYTES', () => {
    it('should be 5MB', () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
    });
  });
});