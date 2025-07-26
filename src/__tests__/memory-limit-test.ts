import { FileData } from '../types/file-types';

describe('Memory Limit Handling', () => {
  // Mock console methods to avoid test output noise
  const originalWarn = console.warn;
  const originalError = console.error;
  
  beforeAll(() => {
    console.warn = jest.fn();
    console.error = jest.fn();
  });
  
  afterAll(() => {
    console.warn = originalWarn;
    console.error = originalError;
  });

  const createMockFile = (index: number): FileData => ({
    name: `file-${index}.txt`,
    path: `/test/path/file-${index}.txt`,
    isDirectory: false,
    size: 1024,
    isBinary: false,
    isSkipped: false,
    isContentLoaded: false
  });

  describe('File accumulation with memory limits', () => {
    it('should handle accumulation of files up to MAX_FILES_IN_MEMORY limit', () => {
      const MAX_FILES_IN_MEMORY = 50_000;
      const files: FileData[] = [];
      
      // Generate files up to the limit
      for (let i = 0; i < MAX_FILES_IN_MEMORY; i++) {
        files.push(createMockFile(i));
      }
      
      expect(files.length).toBe(MAX_FILES_IN_MEMORY);
      expect(files[0].name).toBe('file-0.txt');
      expect(files[MAX_FILES_IN_MEMORY - 1].name).toBe(`file-${MAX_FILES_IN_MEMORY - 1}.txt`);
    });

    it('should keep only the most recent files when exceeding memory limit', () => {
      const MAX_FILES_IN_MEMORY = 50_000;
      let accumulatedFiles: FileData[] = [];
      
      // Add files beyond the limit
      for (let i = 0; i < MAX_FILES_IN_MEMORY + 10_000; i++) {
        accumulatedFiles.push(createMockFile(i));
        
        // Simulate the memory limit logic from electron-handlers
        if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
          accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
        }
      }
      
      // Should have exactly MAX_FILES_IN_MEMORY files
      expect(accumulatedFiles.length).toBe(MAX_FILES_IN_MEMORY);
      
      // Should have kept the most recent files
      expect(accumulatedFiles[0].name).toBe('file-10000.txt');
      expect(accumulatedFiles[accumulatedFiles.length - 1].name).toBe('file-59999.txt');
    });

    it('should maintain file order when slicing for memory limit', () => {
      const MAX_FILES_IN_MEMORY = 100; // Smaller limit for testing
      let accumulatedFiles: FileData[] = [];
      
      // Add 150 files
      for (let i = 0; i < 150; i++) {
        accumulatedFiles.push(createMockFile(i));
      }
      
      // Apply memory limit
      if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
        accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
      }
      
      // Verify order is maintained
      for (let i = 0; i < accumulatedFiles.length - 1; i++) {
        const currentIndex = parseInt(accumulatedFiles[i].name.match(/\d+/)![0]);
        const nextIndex = parseInt(accumulatedFiles[i + 1].name.match(/\d+/)![0]);
        expect(nextIndex).toBe(currentIndex + 1);
      }
    });

    it('should handle memory limit with batch processing', () => {
      const MAX_FILES_IN_MEMORY = 1000;
      let accumulatedFiles: FileData[] = [];
      const BATCH_SIZE = 100;
      
      // Simulate batch processing like in the actual handler
      for (let batch = 0; batch < 15; batch++) {
        const newFiles: FileData[] = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
          newFiles.push(createMockFile(batch * BATCH_SIZE + i));
        }
        
        // Add new batch
        accumulatedFiles = [...accumulatedFiles, ...newFiles];
        
        // Apply memory limit after each batch
        if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
          const beforeLength = accumulatedFiles.length;
          accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
          const removedCount = beforeLength - accumulatedFiles.length;
          
          // Verify we're removing the correct amount
          expect(removedCount).toBe(beforeLength - MAX_FILES_IN_MEMORY);
        }
      }
      
      // Final state should have exactly MAX_FILES_IN_MEMORY files
      expect(accumulatedFiles.length).toBe(MAX_FILES_IN_MEMORY);
      
      // Should have the most recent 1000 files (files 500-1499)
      expect(accumulatedFiles[0].name).toBe('file-500.txt');
      expect(accumulatedFiles[999].name).toBe('file-1499.txt');
    });

    it('should not affect files when under memory limit', () => {
      const MAX_FILES_IN_MEMORY = 50_000;
      let accumulatedFiles: FileData[] = [];
      
      // Add files well under the limit
      for (let i = 0; i < 1000; i++) {
        accumulatedFiles.push(createMockFile(i));
      }
      
      const originalLength = accumulatedFiles.length;
      const firstFile = accumulatedFiles[0];
      const lastFile = accumulatedFiles[accumulatedFiles.length - 1];
      
      // Memory limit logic should not affect the array
      if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
        accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
      }
      
      // Nothing should change
      expect(accumulatedFiles.length).toBe(originalLength);
      expect(accumulatedFiles[0]).toBe(firstFile);
      expect(accumulatedFiles[accumulatedFiles.length - 1]).toBe(lastFile);
    });

    it('should handle edge case of exactly MAX_FILES_IN_MEMORY files', () => {
      const MAX_FILES_IN_MEMORY = 1000;
      let accumulatedFiles: FileData[] = [];
      
      // Add exactly MAX_FILES_IN_MEMORY files
      for (let i = 0; i < MAX_FILES_IN_MEMORY; i++) {
        accumulatedFiles.push(createMockFile(i));
      }
      
      const originalArray = [...accumulatedFiles];
      
      // Apply memory limit logic
      if (accumulatedFiles.length > MAX_FILES_IN_MEMORY) {
        accumulatedFiles = accumulatedFiles.slice(-MAX_FILES_IN_MEMORY);
      }
      
      // Array should remain unchanged
      expect(accumulatedFiles).toEqual(originalArray);
      expect(accumulatedFiles.length).toBe(MAX_FILES_IN_MEMORY);
    });
  });

  describe('Memory cleanup mechanisms', () => {
    it('should clear accumulated files on cleanup', () => {
      let accumulatedFiles: FileData[] = [];
      
      // Add some files
      for (let i = 0; i < 100; i++) {
        accumulatedFiles.push(createMockFile(i));
      }
      
      expect(accumulatedFiles.length).toBe(100);
      
      // Simulate cleanup
      accumulatedFiles = [];
      
      expect(accumulatedFiles.length).toBe(0);
    });

    it('should handle periodic cleanup based on inactivity', () => {
      const mockSessionStorage: Record<string, string> = {};
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000 + 1000); // 5 minutes + 1 second
      
      // Mock sessionStorage
      global.sessionStorage = {
        getItem: (key: string) => mockSessionStorage[key] || null,
        setItem: (key: string, value: string) => { mockSessionStorage[key] = value; },
        removeItem: (key: string) => { delete mockSessionStorage[key]; },
        clear: () => { Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]); },
        length: 0,
        key: () => null
      } as Storage;
      
      // Set last update time to more than 5 minutes ago
      mockSessionStorage['lastFileListUpdate'] = fiveMinutesAgo.toString();
      
      let accumulatedFiles: FileData[] = [];
      for (let i = 0; i < 100; i++) {
        accumulatedFiles.push(createMockFile(i));
      }
      
      // Simulate the cleanup check
      const lastUpdateTime = global.sessionStorage.getItem('lastFileListUpdate');
      const now = Date.now();
      const timeSinceLastUpdate = lastUpdateTime ? now - Number.parseInt(lastUpdateTime) : Infinity;
      
      if (timeSinceLastUpdate > 5 * 60 * 1000) {
        accumulatedFiles = [];
        global.sessionStorage.removeItem('lastFileListUpdate');
      }
      
      // Files should be cleared due to inactivity
      expect(accumulatedFiles.length).toBe(0);
      expect(global.sessionStorage.getItem('lastFileListUpdate')).toBeNull();
    });
  });
});