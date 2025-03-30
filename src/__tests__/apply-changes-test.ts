import { promises as fs } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { applyFileChanges } from '../../lib/apply-changes';

describe('applyFileChanges', () => {
  // Create a temporary directory for testing
  let tempDir: string;
  
  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tempDir = join(os.tmpdir(), `apply-changes-test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Clean up the temporary directory after each test
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Error cleaning up temp directory ${tempDir}:`, error);
    }
  });
  
  it('should CREATE a new file with content', async () => {
    // Arrange
    const testFilePath = 'test-file.txt';
    const testContent = 'This is test content';
    const fileChange = {
      file_operation: 'CREATE',
      file_path: testFilePath,
      file_code: testContent
    };
    
    // Act
    await applyFileChanges(fileChange, tempDir);
    
    // Assert
    const fullPath = join(tempDir, testFilePath);
    const exists = await fileExists(fullPath);
    expect(exists).toBe(true);
    
    const content = await fs.readFile(fullPath, 'utf8');
    expect(content).toBe(testContent);
  });
  
  it('should CREATE a new file in a nested directory', async () => {
    // Arrange
    const testFilePath = 'nested/directory/test-file.txt';
    const testContent = 'This is test content in a nested directory';
    const fileChange = {
      file_operation: 'CREATE',
      file_path: testFilePath,
      file_code: testContent
    };
    
    // Act
    await applyFileChanges(fileChange, tempDir);
    
    // Assert
    const fullPath = join(tempDir, testFilePath);
    const exists = await fileExists(fullPath);
    expect(exists).toBe(true);
    
    const content = await fs.readFile(fullPath, 'utf8');
    expect(content).toBe(testContent);
  });
  
  it('should UPDATE an existing file with new content', async () => {
    // Arrange
    const testFilePath = 'update-test-file.txt';
    const initialContent = 'Initial content';
    const updatedContent = 'Updated content';
    const fullPath = join(tempDir, testFilePath);
    
    // Create the file first
    await fs.writeFile(fullPath, initialContent, 'utf8');
    
    const fileChange = {
      file_operation: 'UPDATE',
      file_path: testFilePath,
      file_code: updatedContent
    };
    
    // Act
    await applyFileChanges(fileChange, tempDir);
    
    // Assert
    const exists = await fileExists(fullPath);
    expect(exists).toBe(true);
    
    const content = await fs.readFile(fullPath, 'utf8');
    expect(content).toBe(updatedContent);
  });
  
  it('should DELETE an existing file', async () => {
    // Arrange
    const testFilePath = 'delete-test-file.txt';
    const fullPath = join(tempDir, testFilePath);
    
    // Create the file first
    await fs.writeFile(fullPath, 'File to be deleted', 'utf8');
    
    const fileChange = {
      file_operation: 'DELETE',
      file_path: testFilePath
    };
    
    // Act
    await applyFileChanges(fileChange, tempDir);
    
    // Assert
    const exists = await fileExists(fullPath);
    expect(exists).toBe(false);
  });
  
  it('should throw an error when trying to UPDATE a non-existent file', async () => {
    // Arrange
    const nonExistentFilePath = 'non-existent-file.txt';
    const fileChange = {
      file_operation: 'UPDATE',
      file_path: nonExistentFilePath,
      file_code: 'This should fail'
    };
    
    // Act & Assert
    await expect(applyFileChanges(fileChange, tempDir))
      .rejects
      .toThrow(`File not found: ${nonExistentFilePath}`);
  });
  
  it('should throw an error when trying to DELETE a non-existent file', async () => {
    // Arrange
    const nonExistentFilePath = 'non-existent-file.txt';
    const fileChange = {
      file_operation: 'DELETE',
      file_path: nonExistentFilePath
    };
    
    // Act & Assert
    await expect(applyFileChanges(fileChange, tempDir))
      .rejects
      .toThrow(`File not found: ${nonExistentFilePath}`);
  });
  
  it('should throw an error when CREATE operation has no file_code', async () => {
    // Arrange
    const testFilePath = 'test-file-no-content.txt';
    const fileChange = {
      file_operation: 'CREATE',
      file_path: testFilePath
      // Intentionally missing file_code
    };
    
    // Act & Assert
    await expect(applyFileChanges(fileChange, tempDir))
      .rejects
      .toThrow(`No file_code provided for CREATE operation on ${testFilePath}`);
  });
  
  it('should throw an error when UPDATE operation has no file_code', async () => {
    // Arrange
    const testFilePath = 'test-file-update-no-content.txt';
    const fullPath = join(tempDir, testFilePath);
    
    // Create the file first
    await fs.writeFile(fullPath, 'Initial content', 'utf8');
    
    const fileChange = {
      file_operation: 'UPDATE',
      file_path: testFilePath
      // Intentionally missing file_code
    };
    
    // Act & Assert
    await expect(applyFileChanges(fileChange, tempDir))
      .rejects
      .toThrow(`No file_code provided for UPDATE operation on ${testFilePath}`);
  });
  
  it('should handle an unknown file operation gracefully', async () => {
    // Arrange
    const testFilePath = 'test-file-unknown-op.txt';
    const fileChange = {
      file_operation: 'UNKNOWN_OPERATION',
      file_path: testFilePath,
      file_code: 'Some content'
    } as any;
    
    // Create a spy on console.warn
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    // Act
    await applyFileChanges(fileChange, tempDir);
    
    // Assert
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Unknown file_operation: ${fileChange.file_operation}`)
    );
    
    // Clean up
    consoleWarnSpy.mockRestore();
  });
});

// Helper function to check if a file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
} 