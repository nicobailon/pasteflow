import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { processFile } from '../../utils/file-processing';

describe('File Size Limits and Error Handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'pasteflow-limits-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should skip files larger than 5MB', async () => {
    const largePath = path.join(tempDir, 'large.txt');
    const largeContent = 'A'.repeat(6 * 1024 * 1024); // 6MB
    fs.writeFileSync(largePath, largeContent);

    const result = await processFile(largePath, tempDir);

    expect(result.isSkipped).toBe(true);
    expect(result.error).toBe('File too large to process');
    expect(result.tokenCount).toBe(0);
    expect(result.content).toBe('');
    expect(result.size).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('should process files exactly at the 5MB limit', async () => {
    const limitPath = path.join(tempDir, 'limit.txt');
    const limitContent = 'B'.repeat(5 * 1024 * 1024); // Exactly 5MB
    fs.writeFileSync(limitPath, limitContent);

    const result = await processFile(limitPath, tempDir);

    expect(result.isSkipped).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.isBinary).toBe(false);
    expect(result.size).toBe(5 * 1024 * 1024);
  });

  it('should process small files normally', async () => {
    const smallPath = path.join(tempDir, 'small.txt');
    const smallContent = 'Small file content';
    fs.writeFileSync(smallPath, smallContent);

    const result = await processFile(smallPath, tempDir);

    expect(result.isSkipped).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.isBinary).toBe(false);
    expect(result.size).toBe(smallContent.length);
    expect(result.fileType).toBe('TXT');
  });

  it('should handle file read errors gracefully', async () => {
    const testPath = path.join(tempDir, 'test.txt');
    
    // Mock fs.statSync to throw ENOENT error for this specific file
    const originalStatSync = fs.statSync;
    const mockStatSync = jest.spyOn(fs, 'statSync').mockImplementation((filePath) => {
      if (filePath === testPath) {
        const error = new Error('ENOENT: no such file or directory');
        (error as any).code = 'ENOENT';
        throw error;
      }
      return originalStatSync(filePath);
    });

    // Since the error is thrown in statSync, the function won't reach the read part
    // We need to test this differently - the error will propagate up
    await expect(processFile(testPath, tempDir)).rejects.toThrow('ENOENT');

    mockStatSync.mockRestore();
  });

  it('should handle permission errors', async () => {
    const restrictedPath = path.join(tempDir, 'restricted.txt');
    fs.writeFileSync(restrictedPath, 'content');
    
    // Mock fs.readFileSync to throw permission error
    const originalReadFileSync = fs.readFileSync;
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, options) => {
      if (filePath === restrictedPath) {
        const error = new Error('Permission denied');
        (error as any).code = 'EACCES';
        throw error;
      }
      return originalReadFileSync(filePath, options);
    });

    const result = await processFile(restrictedPath, tempDir);

    expect(result.isSkipped).toBe(true);
    expect(result.error).toBe('Could not read file');
    expect(result.tokenCount).toBe(0);
    expect(result.content).toBe('');

    mockReadFileSync.mockRestore();
  });

  it('should handle various file sizes correctly', async () => {
    const testCases = [
      { size: 1024, name: '1KB.txt', shouldSkip: false },
      { size: 1024 * 1024, name: '1MB.txt', shouldSkip: false },
      { size: 3 * 1024 * 1024, name: '3MB.txt', shouldSkip: false },
      { size: 10 * 1024 * 1024, name: '10MB.txt', shouldSkip: true }
    ];

    const results = await Promise.all(
      testCases.map(async ({ size, name, shouldSkip }) => {
        const filePath = path.join(tempDir, name);
        const content = 'X'.repeat(size);
        fs.writeFileSync(filePath, content);
        
        const result = await processFile(filePath, tempDir);
        
        return {
          name,
          size: result.size,
          isSkipped: result.isSkipped,
          expectedSkip: shouldSkip
        };
      })
    );

    results.forEach(({ size, isSkipped, expectedSkip }) => {
      expect(isSkipped).toBe(expectedSkip);
      expect(size).toBeGreaterThan(0);
    });
    expect(results).toHaveLength(4);
    expect(results.filter(r => r.isSkipped)).toHaveLength(1);
  });

  it('should preserve file metadata for skipped files', async () => {
    const largePath = path.join(tempDir, 'metadata-test.log');
    const largeContent = 'L'.repeat(7 * 1024 * 1024); // 7MB
    fs.writeFileSync(largePath, largeContent);

    const result = await processFile(largePath, tempDir);

    expect(result.name).toBe('metadata-test.log');
    expect(result.path).toBe(largePath);
    expect(result.isDirectory).toBe(false);
    expect(result.isSkipped).toBe(true);
    expect(result.isBinary).toBe(false);
    expect(result.size).toBe(7 * 1024 * 1024);
  });
});