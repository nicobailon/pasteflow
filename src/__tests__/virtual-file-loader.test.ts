import { VirtualFileLoader } from '../utils/virtual-file-loader';
import { FileData } from '../types/file-types';

describe('VirtualFileLoader', () => {
  const mockLoadContent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('file creation and caching', () => {
    it('should create virtual files from FileData', () => {
      const loader = new VirtualFileLoader(mockLoadContent);
      
      const fileData: FileData = {
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false,
        content: 'test content',
        tokenCount: 10
      };
      
      const virtualFile = loader.createVirtualFile(fileData);
      
      expect(virtualFile.metadata.name).toBe('test.js');
      expect(virtualFile.metadata.path).toBe('/test/test.js');
      expect(virtualFile.content).toBe('test content');
      expect(virtualFile.tokenCount).toBe(10);
      expect(virtualFile.isContentLoaded).toBe(true);
    });

    it('should reuse existing virtual files', () => {
      const loader = new VirtualFileLoader(mockLoadContent);
      
      const fileData: FileData = {
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false
      };
      
      const virtualFile1 = loader.createVirtualFile(fileData);
      const virtualFile2 = loader.createVirtualFile(fileData);
      
      expect(virtualFile1).toBe(virtualFile2);
    });
  });

  describe('lazy loading', () => {
    it('should load file content on demand', async () => {
      mockLoadContent.mockResolvedValueOnce({
        content: 'loaded content',
        tokenCount: 50
      });
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      const fileData: FileData = {
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false
      };
      
      loader.createVirtualFile(fileData);
      const loaded = await loader.loadFileContent('/test/test.js');
      
      expect(mockLoadContent).toHaveBeenCalledWith('/test/test.js');
      expect(loaded.content).toBe('loaded content');
      expect(loaded.tokenCount).toBe(50);
      expect(loaded.isContentLoaded).toBe(true);
    });

    it('should deduplicate concurrent load requests', async () => {
      let resolveLoad: (value: { content: string; tokenCount: number }) => void;
      const loadPromise = new Promise<{ content: string; tokenCount: number }>(resolve => {
        resolveLoad = resolve;
      });
      
      mockLoadContent.mockReturnValue(loadPromise);
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      const fileData: FileData = {
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false
      };
      
      loader.createVirtualFile(fileData);
      
      // Start multiple concurrent loads
      const load1 = loader.loadFileContent('/test/test.js');
      const load2 = loader.loadFileContent('/test/test.js');
      const load3 = loader.loadFileContent('/test/test.js');
      
      // Should only call load function once
      expect(mockLoadContent).toHaveBeenCalledTimes(1);
      
      // Resolve the load
      resolveLoad!({ content: 'loaded', tokenCount: 10 });
      
      const [result1, result2, result3] = await Promise.all([load1, load2, load3]);
      
      // All should get the same result
      expect(result1.content).toBe('loaded');
      expect(result2.content).toBe('loaded');
      expect(result3.content).toBe('loaded');
      
      // Still only called once
      expect(mockLoadContent).toHaveBeenCalledTimes(1);
    });

    it('should handle load errors gracefully', async () => {
      mockLoadContent.mockRejectedValueOnce(new Error('Load failed'));
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      const fileData: FileData = {
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false
      };
      
      loader.createVirtualFile(fileData);
      
      await expect(loader.loadFileContent('/test/test.js')).rejects.toThrow('Load failed');
    });
  });

  describe('memory management', () => {
    it('should track memory usage correctly', async () => {
      mockLoadContent.mockImplementation(async (_path: string) => ({
        content: 'A'.repeat(1000), // 1000 bytes in UTF-16
        tokenCount: 100
      }));
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      const stats1 = loader.getCacheStats();
      expect(stats1.cacheSize).toBe(0);
      
      // Create files without content
      for (let i = 0; i < 3; i++) {
        loader.createVirtualFile({
          name: `file${i}.js`,
          path: `/test/file${i}.js`,
          isDirectory: false,
          size: 1000,
          isBinary: false,
          isSkipped: false
        });
      }
      
      // Load content for files
      await loader.loadFileContent('/test/file0.js');
      await loader.loadFileContent('/test/file1.js');
      
      const stats2 = loader.getCacheStats();
      expect(stats2.loadedFiles).toBe(2);
      expect(stats2.cacheSize).toBeGreaterThan(0);
    });

    it('should evict files when memory limit is reached', async () => {
      // Create a loader with very small memory limit
      const smallLoader = new VirtualFileLoader(mockLoadContent);
      
      // Override the max cache size for testing
      Object.defineProperty(smallLoader, 'maxCacheSize', {
        value: 3000,
        writable: true,
        configurable: true
      });
      
      mockLoadContent.mockImplementation(async (_path: string) => ({
        content: 'A'.repeat(2000), // ~2KB per file
        tokenCount: 100
      }));
      
      // Create and load multiple files
      for (let i = 0; i < 3; i++) {
        smallLoader.createVirtualFile({
          name: `file${i}.js`,
          path: `/test/file${i}.js`,
          isDirectory: false,
          size: 2000,
          isBinary: false,
          isSkipped: false
        });
      }
      
      await smallLoader.loadFileContent('/test/file0.js');
      const file0 = smallLoader.getVirtualFile('/test/file0.js');
      expect(file0?.isContentLoaded).toBe(true);
      
      await smallLoader.loadFileContent('/test/file1.js');
      
      // Loading file1 should evict file0 due to memory limit
      const file0After = smallLoader.getVirtualFile('/test/file0.js');
      expect(file0After?.isContentLoaded).toBe(false);
      expect(file0After?.content).toBeUndefined();
    });
  });

  describe('batch loading', () => {
    it('should load multiple files with concurrency limit', async () => {
      let activeLoads = 0;
      let maxActiveLoads = 0;
      
      mockLoadContent.mockImplementation(async (path: string) => {
        activeLoads++;
        maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        activeLoads--;
        return {
          content: `content for ${path}`,
          tokenCount: 10
        };
      });
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      // Create files
      const paths = [];
      for (let i = 0; i < 10; i++) {
        const path = `/test/file${i}.js`;
        paths.push(path);
        loader.createVirtualFile({
          name: `file${i}.js`,
          path,
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false
        });
      }
      
      const results = await loader.loadMultipleFiles(paths);
      
      expect(results.size).toBe(10);
      expect(maxActiveLoads).toBeLessThanOrEqual(5); // Concurrency limit
      
      for (const path of paths) {
        const file = results.get(path);
        expect(file?.content).toBe(`content for ${path}`);
      }
    });

    it('should handle partial failures in batch loading', async () => {
      mockLoadContent.mockImplementation(async (path: string) => {
        if (path.includes('file2')) {
          throw new Error('Failed to load file2');
        }
        return {
          content: `content for ${path}`,
          tokenCount: 10
        };
      });
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      // Create files
      const paths = ['/test/file1.js', '/test/file2.js', '/test/file3.js'];
      for (const path of paths) {
        loader.createVirtualFile({
          name: path.split('/').pop()!,
          path,
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false
        });
      }
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const results = await loader.loadMultipleFiles(paths);
      
      expect(results.size).toBe(2); // Only successful loads
      expect(results.has('/test/file1.js')).toBe(true);
      expect(results.has('/test/file2.js')).toBe(false);
      expect(results.has('/test/file3.js')).toBe(true);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load /test/file2.js'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('manual content management', () => {
    it('should unload file content on demand', async () => {
      mockLoadContent.mockResolvedValueOnce({
        content: 'test content',
        tokenCount: 10
      });
      
      const loader = new VirtualFileLoader(mockLoadContent);
      
      loader.createVirtualFile({
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false
      });
      
      await loader.loadFileContent('/test/test.js');
      
      let file = loader.getVirtualFile('/test/test.js');
      expect(file?.isContentLoaded).toBe(true);
      expect(file?.content).toBe('test content');
      
      loader.unloadFileContent('/test/test.js');
      
      file = loader.getVirtualFile('/test/test.js');
      expect(file?.isContentLoaded).toBe(false);
      expect(file?.content).toBeUndefined();
    });

    it('should clear all cached data', () => {
      const loader = new VirtualFileLoader(mockLoadContent);
      
      // Create multiple files
      for (let i = 0; i < 5; i++) {
        loader.createVirtualFile({
          name: `file${i}.js`,
          path: `/test/file${i}.js`,
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false,
          content: 'test',
          tokenCount: 4
        });
      }
      
      const statsBefore = loader.getCacheStats();
      expect(statsBefore.totalFiles).toBe(5);
      
      loader.clear();
      
      const statsAfter = loader.getCacheStats();
      expect(statsAfter.totalFiles).toBe(0);
      expect(statsAfter.cacheSize).toBe(0);
      
      // Files should be gone
      expect(loader.getVirtualFile('/test/file0.js')).toBeUndefined();
    });
  });

  describe('metadata operations', () => {
    it('should return all virtual files', () => {
      const loader = new VirtualFileLoader(mockLoadContent);
      
      for (let i = 0; i < 3; i++) {
        loader.createVirtualFile({
          name: `file${i}.js`,
          path: `/test/file${i}.js`,
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false
        });
      }
      
      const allFiles = loader.getAllVirtualFiles();
      expect(allFiles).toHaveLength(3);
      expect(allFiles[0].metadata.name).toBe('file0.js');
    });

    it('should return metadata only', () => {
      const loader = new VirtualFileLoader(mockLoadContent);
      
      loader.createVirtualFile({
        name: 'test.js',
        path: '/test/test.js',
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false,
        content: 'secret content',
        tokenCount: 10
      });
      
      const metadata = loader.getMetadataOnly();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe('test.js');
      expect(metadata[0].path).toBe('/test/test.js');
      // Should not include content
      expect('content' in metadata[0]).toBe(false);
    });
  });
});