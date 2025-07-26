import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { processBatch, shouldExcludeByDefault } from '../../utils/file-processing';
import { loadGitignore } from '../../utils/ignore-utils';

jest.mock('../../utils/ignore-utils');

describe('File Scanning Logic', () => {
  let tempDir: string;
  const mockLoadGitignore = loadGitignore as jest.MockedFunction<typeof loadGitignore>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'pasteflow-scan-test-'));
    
    mockLoadGitignore.mockReturnValue({
      add: jest.fn(),
      ignores: jest.fn().mockReturnValue(false)
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  it('should process files in a simple directory structure', async () => {
    const files = ['file1.txt', 'file2.js', 'file3.md'];
    files.forEach(fileName => {
      fs.writeFileSync(path.join(tempDir, fileName), `Content of ${fileName}`);
    });

    const allFiles: any[] = [];
    const directoryQueue = [{ path: tempDir, depth: 0 }];
    const processedDirs = new Set<string>();
    const ignoreFilter = { ignores: () => false };

    const result = await processBatch(
      directoryQueue,
      processedDirs,
      allFiles,
      tempDir,
      ignoreFilter,
      10, // MAX_DIRS_PER_BATCH
      50, // BATCH_SIZE
      10  // MAX_DEPTH
    );

    expect(allFiles).toHaveLength(3);
    expect(allFiles.map(f => f.name).sort()).toEqual(['file1.txt', 'file2.js', 'file3.md']);
    expect(result.processedDirsCount).toBe(1);
    expect(result.filesInBatch).toBe(3);
  });

  it('should handle nested directory structures', async () => {
    const nestedDir = path.join(tempDir, 'nested');
    const deepDir = path.join(nestedDir, 'deep');
    fs.mkdirSync(nestedDir);
    fs.mkdirSync(deepDir);

    fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root content');
    fs.writeFileSync(path.join(nestedDir, 'nested.txt'), 'nested content');
    fs.writeFileSync(path.join(deepDir, 'deep.txt'), 'deep content');

    const allFiles: any[] = [];
    const directoryQueue = [{ path: tempDir, depth: 0 }];
    const processedDirs = new Set<string>();
    const ignoreFilter = { ignores: () => false };

    let batchCount = 0;
    while (directoryQueue.length > 0 && batchCount < 10) {
      await processBatch(
        directoryQueue,
        processedDirs,
        allFiles,
        tempDir,
        ignoreFilter,
        10, // MAX_DIRS_PER_BATCH
        50, // BATCH_SIZE
        10  // MAX_DEPTH
      );
      batchCount++;
    }

    expect(allFiles).toHaveLength(3);
    expect(allFiles.map(f => f.name).sort()).toEqual(['deep.txt', 'nested.txt', 'root.txt']);
    expect(processedDirs.size).toBe(3); // root, nested, deep
  });

  it('should respect batch size limits', async () => {
    const fileCount = 25;
    for (let i = 0; i < fileCount; i++) {
      fs.writeFileSync(path.join(tempDir, `file${i}.txt`), `Content ${i}`);
    }

    const allFiles: any[] = [];
    const directoryQueue = [{ path: tempDir, depth: 0 }];
    const processedDirs = new Set<string>();
    const ignoreFilter = { ignores: () => false };

    const result = await processBatch(
      directoryQueue,
      processedDirs,
      allFiles,
      tempDir,
      ignoreFilter,
      10, // MAX_DIRS_PER_BATCH
      10, // BATCH_SIZE (smaller than file count)
      10  // MAX_DEPTH
    );

    expect(result.filesInBatch).toBe(10);
    expect(allFiles).toHaveLength(10);
    expect(result.processedDirsCount).toBe(1);
  });

  it('should respect depth limits', async () => {
    let currentDir = tempDir;
    for (let depth = 0; depth < 5; depth++) {
      const nextDir = path.join(currentDir, `level${depth}`);
      fs.mkdirSync(nextDir);
      fs.writeFileSync(path.join(nextDir, `file-depth${depth}.txt`), `Depth ${depth}`);
      currentDir = nextDir;
    }

    const allFiles: any[] = [];
    const directoryQueue = [{ path: tempDir, depth: 0 }];
    const processedDirs = new Set<string>();
    const ignoreFilter = { ignores: () => false };

    let batchCount = 0;
    while (directoryQueue.length > 0 && batchCount < 10) {
      await processBatch(
        directoryQueue,
        processedDirs,
        allFiles,
        tempDir,
        ignoreFilter,
        10, // MAX_DIRS_PER_BATCH
        50, // BATCH_SIZE
        2   // MAX_DEPTH (limit to 2 levels deep)
      );
      batchCount++;
    }

    expect(allFiles.length).toBeLessThan(5);
    expect(allFiles.every(f => !f.path.includes('level3'))).toBe(true);
    expect(allFiles.some(f => f.path.includes('level0'))).toBe(true);
    expect(allFiles.some(f => f.path.includes('level1'))).toBe(true);
  });

  it('should exclude files based on gitignore patterns', async () => {
    mockLoadGitignore.mockReturnValue({
      add: jest.fn(),
      ignores: (filePath: string) => filePath.includes('ignored') || filePath.endsWith('.log')
    });

    const files = ['normal.txt', 'ignored.txt', 'debug.log', 'keep.js'];
    files.forEach(fileName => {
      fs.writeFileSync(path.join(tempDir, fileName), `Content of ${fileName}`);
    });

    const allFiles: any[] = [];
    const directoryQueue = [{ path: tempDir, depth: 0 }];
    const processedDirs = new Set<string>();
    const ignoreFilter = loadGitignore(tempDir);

    await processBatch(
      directoryQueue,
      processedDirs,
      allFiles,
      tempDir,
      ignoreFilter,
      10, // MAX_DIRS_PER_BATCH
      50, // BATCH_SIZE
      10  // MAX_DEPTH
    );

    expect(allFiles).toHaveLength(2);
    expect(allFiles.map(f => f.name).sort()).toEqual(['keep.js', 'normal.txt']);
    expect(allFiles.every(f => !f.name.includes('ignored'))).toBe(true);
    expect(allFiles.every(f => !f.name.endsWith('.log'))).toBe(true);
  });

  it('should handle directory read errors gracefully', async () => {
    const readableDir = path.join(tempDir, 'readable');
    fs.mkdirSync(readableDir);
    fs.writeFileSync(path.join(readableDir, 'good.txt'), 'content');

    const nonExistentDir = path.join(tempDir, 'nonexistent');

    const allFiles: any[] = [];
    const directoryQueue = [
      { path: readableDir, depth: 0 },
      { path: nonExistentDir, depth: 0 }
    ];
    const processedDirs = new Set<string>();
    const ignoreFilter = { ignores: () => false };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await processBatch(
      directoryQueue,
      processedDirs,
      allFiles,
      tempDir,
      ignoreFilter,
      10, // MAX_DIRS_PER_BATCH
      50, // BATCH_SIZE
      10  // MAX_DEPTH
    );

    expect(allFiles).toHaveLength(1);
    expect(allFiles[0].name).toBe('good.txt');
    expect(result.processedDirsCount).toBe(2);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Error reading directory ${nonExistentDir}:`),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  describe('shouldExcludeByDefault', () => {
    it('should correctly identify files for exclusion', () => {
      const testFilePath = path.join(tempDir, 'test.txt');
      
      mockLoadGitignore.mockReturnValue({
        add: jest.fn(),
        ignores: (relativePath: string) => relativePath === 'test.txt'
      });

      const result = shouldExcludeByDefault(testFilePath, tempDir);

      expect(result).toBe(true);
      expect(mockLoadGitignore).toHaveBeenCalledWith(tempDir);
    });

    it('should handle files that should not be excluded', () => {
      const testFilePath = path.join(tempDir, 'keep.txt');
      
      mockLoadGitignore.mockReturnValue({
        add: jest.fn(),
        ignores: () => false
      });

      const result = shouldExcludeByDefault(testFilePath, tempDir);

      expect(result).toBe(false);
      expect(mockLoadGitignore).toHaveBeenCalledWith(tempDir);
    });
  });
});