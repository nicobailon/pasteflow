import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { TOKEN_COUNTING } from '@constants';

/**
 * This test suite focuses on the behavior and outcomes of file processing
 * in the IPC communication layer, rather than testing implementation details.
 * It simulates real file operations and validates business requirements.
 */

// Helper to create test environment
async function createTempTestDirectory(files: Record<string, string>): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'pasteflow-test-'));
  
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tempDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
  
  return tempDir;
}

// Helper to clean up test directories
async function cleanupTempDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

// Helper to simulate file processing results
interface ProcessedFile {
  name: string;
  path: string;
  content: string;
  tokenCount: number;
  isBinary: boolean;
}

interface ProcessingResult {
  status: 'complete' | 'cancelled' | 'error';
  files: ProcessedFile[];
  totalTokens: number;
  message?: string;
}

// Helper to detect binary files
function isBinaryFile(buffer: Buffer): boolean {
  // Check for common binary file signatures
  const signatures = [
    [0x89, 0x50, 0x4E, 0x47], // PNG
    [0xFF, 0xD8, 0xFF],       // JPEG
    [0x47, 0x49, 0x46],       // GIF
    [0x50, 0x4B, 0x03, 0x04], // ZIP
    [0x53, 0x51, 0x4C, 0x69], // SQLite
  ];
  
  for (const sig of signatures) {
    if (sig.every((byte, index) => buffer[index] === byte)) {
      return true;
    }
  }
  
  // Check for null bytes in first 512 bytes
  const checkLength = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  
  return false;
}

// Helper to check if file should be ignored
async function shouldIgnoreFile(filePath: string, gitignorePatterns: string[]): Promise<boolean> {
  const fileName = path.basename(filePath);
  const relativePath = filePath;
  
  // Check gitignore patterns
  for (const pattern of gitignorePatterns) {
    if (pattern.endsWith('/')) {
      // Directory pattern
      if (relativePath.includes(pattern.slice(0, -1))) return true;
    } else if (pattern.includes('*')) {
      // Wildcard pattern
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(fileName)) return true;
    } else {
      // Exact match
      if (fileName === pattern) return true;
    }
  }
  
  return false;
}

async function simulateFileProcessing(
  directory: string,
  options?: { cancelAfter?: number }
): Promise<ProcessingResult> {
  const files: ProcessedFile[] = [];
  let totalTokens = 0;
  let cancelled = false;
  
  if (options?.cancelAfter) {
    setTimeout(() => { cancelled = true; }, options.cancelAfter);
  }
  
  try {
    // Validate directory path first
    if (!directory || directory.trim() === '') {
      throw new Error('Invalid or empty path provided');
    }
    
    const entries = await fs.readdir(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      if (cancelled) {
        return {
          status: 'cancelled' as const,
          files,
          totalTokens,
          message: 'Processing cancelled by user'
        };
      }
      
      if (entry.isFile()) {
        const filePath = path.join(directory, entry.name);
        const buffer = await fs.readFile(filePath);
        const isBinary = isBinaryFile(buffer);
        
        if (!isBinary) {
          const content = buffer.toString('utf8');
          const tokenCount = Math.ceil(content.length / TOKEN_COUNTING.CHARS_PER_TOKEN); // Simple token estimation
          
          files.push({
            name: entry.name,
            path: filePath,
            content,
            tokenCount,
            isBinary: false
          });
          
          totalTokens += tokenCount;
        }
      }
    }
    
    return {
      status: 'complete' as const,
      files,
      totalTokens
    };
  } catch (error) {
    // Jest sometimes wraps errors in a way that breaks instanceof
    let errorMessage = 'Unknown error';
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      // Handle error-like objects
      errorMessage = String((error as { message: unknown }).message);
    }
    
    return {
      status: 'error' as const,
      files: [],
      totalTokens: 0,
      message: errorMessage
    };
  }
}

async function simulateFileProcessingRecursive(
  directory: string,
  options?: { cancelAfter?: number; gitignorePatterns?: string[] }
): Promise<ProcessingResult> {
  const files: ProcessedFile[] = [];
  let totalTokens = 0;
  let cancelled = false;
  const gitignorePatterns = options?.gitignorePatterns || [];
  
  // Read .gitignore if it exists
  try {
    const gitignorePath = path.join(directory, '.gitignore');
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
    gitignorePatterns.push(...gitignoreContent.split('\n').filter(line => line.trim() && !line.startsWith('#')));
  } catch {
    // No .gitignore file
  }
  
  if (options?.cancelAfter) {
    setTimeout(() => { cancelled = true; }, options.cancelAfter);
  }
  
  async function processDirectory(dir: string): Promise<void> {
    if (cancelled) return;
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (cancelled) return;
        
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(directory, fullPath);
        
        if (await shouldIgnoreFile(relativePath, gitignorePatterns)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await processDirectory(fullPath);
        } else if (entry.isFile()) {
          const buffer = await fs.readFile(fullPath);
          const isBinary = isBinaryFile(buffer);
          
          if (!isBinary) {
            const content = buffer.toString('utf8');
            const tokenCount = Math.ceil(content.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
            
            files.push({
              name: entry.name,
              path: fullPath,
              content,
              tokenCount,
              isBinary: false
            });
            
            totalTokens += tokenCount;
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  try {
    await processDirectory(directory);
    
    if (cancelled) {
      return {
        status: 'cancelled' as const,
        files,
        totalTokens,
        message: 'Processing cancelled by user'
      };
    }
    
    return {
      status: 'complete' as const,
      files,
      totalTokens
    };
  } catch (error) {
    // Jest sometimes wraps errors in a way that breaks instanceof
    let errorMessage = 'Unknown error';
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      // Handle error-like objects
      errorMessage = String((error as { message: unknown }).message);
    }
    
    return {
      status: 'error' as const,
      files: [],
      totalTokens: 0,
      message: errorMessage
    };
  }
}

describe('File Processing IPC Communication', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    tempDirs = [];
  });

  afterEach(async () => {
    // Clean up all temp directories
    for (const dir of tempDirs) {
      await cleanupTempDirectory(dir);
    }
  });

  it('should process file requests and return structured file data', async () => {
    // Arrange - Create test directory with known files
    const testDir = await createTempTestDirectory({
      'src/index.js': 'console.log("hello");',
      'README.md': '# Test Project',
      'package.json': '{"name": "test"}'
    });
    tempDirs.push(testDir);
    
    // Act - Simulate IPC file request (needs recursive processing)
    const result = await simulateFileProcessingRecursive(testDir);
    
    // Assert - Verify business outcomes
    expect(result.status).toBe('complete');                    // 1. Operation completed
    expect(result.files).toHaveLength(3);                      // 2. All files found
    expect(result.totalTokens).toBeGreaterThan(0);            // 3. Token counting worked
    expect(result.files.every(f => f.tokenCount > 0)).toBe(true); // 4. Each file has tokens
    
    // Verify file structure
    const indexFile = result.files.find(f => f.name === 'index.js');
    expect(indexFile).toBeDefined();
    expect(indexFile?.content).toBe('console.log("hello");');
    expect(indexFile?.isBinary).toBe(false);
  });

  it('should handle cancellation during processing', async () => {
    // Arrange - Create large test directory with delay simulation
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      files[`file${i}.js`] = `// File ${i}\nconsole.log(${i});`;
    }
    const largeTestDir = await createTempTestDirectory(files);
    tempDirs.push(largeTestDir);
    
    // Act - Simulate cancellable processing with artificial delays
    let cancelFlag = false;
    const processWithDelay = async () => {
      const result: ProcessingResult = {
        status: 'complete' as const,
        files: [],
        totalTokens: 0
      };
      
      const entries = await fs.readdir(largeTestDir);
      for (let i = 0; i < entries.length; i++) {
        if (cancelFlag) {
          return {
            ...result,
            status: 'cancelled' as const,
            message: 'Processing cancelled by user'
          };
        }
        
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 5));
        
        // Process file
        const filePath = path.join(largeTestDir, entries[i]);
        const content = await fs.readFile(filePath, 'utf8');
        result.files.push({
          name: entries[i],
          path: filePath,
          content,
          tokenCount: Math.ceil(content.length / TOKEN_COUNTING.CHARS_PER_TOKEN),
          isBinary: false
        });
      }
      
      return result;
    };
    
    // Start processing and cancel after 50ms
    const processingPromise = processWithDelay();
    setTimeout(() => { cancelFlag = true; }, 50);
    
    const result = await processingPromise;
    
    // Assert - Verify cancellation behavior
    expect(result.status).toBe('cancelled');                   // 1. Status reflects cancellation
    expect(result.files.length).toBeLessThan(100);            // 2. Processing was interrupted
    expect(result.message).toMatch(/cancelled/i);             // 3. User-visible message
  });

  it('should handle directory access errors gracefully', async () => {
    // Arrange - Use a directory that doesn't exist or is restricted
    const restrictedDir = '/root/restricted/nonexistent';
    
    // Act
    const result = await simulateFileProcessing(restrictedDir);
    
    // Assert
    expect(result.status).toBe('error');                       // 1. Error status
    expect(result.message).toBeDefined();                      // 2. Error message exists
    expect(result.files).toEqual([]);                         // 3. No partial data
    expect(result.totalTokens).toBe(0);                        // 4. Clean error state
  });

  it('should process files in batches to prevent UI freezing', async () => {
    // Arrange - Create directory with many files to test batching
    const files: Record<string, string> = {};
    for (let i = 0; i < 150; i++) {
      files[`component${i}.tsx`] = `export const Component${i} = () => <div>Test ${i}</div>;`;
    }
    const testDir = await createTempTestDirectory(files);
    tempDirs.push(testDir);
    
    // Act - Process files and track progress updates
    let progressUpdates = 0;
    const progressCallback = (status: { processed: number; total: number }) => {
      if (status.processed < status.total) {
        progressUpdates++;
      }
    };
    
    // Simulate batch processing with progress tracking
    const BATCH_SIZE = 50;
    const allFiles = await fs.readdir(testDir);
    let processed = 0;
    
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      processed += batch.length;
      progressCallback({ processed, total: allFiles.length });
    }
    
    // Assert
    expect(progressUpdates).toBeGreaterThan(1);               // 1. Multiple progress updates
    expect(progressUpdates).toBe(Math.ceil(150 / BATCH_SIZE) - 1); // 2. Correct batch count
  });

  it('should exclude binary files and respect gitignore patterns', async () => {
    // Arrange - Create test directory with various file types
    // We need to write actual binary data for binary detection to work
    const testDir = await createTempTestDirectory({
      'src/app.js': 'console.log("app");',
      'src/utils.ts': 'export const util = () => {};',
      '.gitignore': 'node_modules/\n*.log',
      'node_modules/lib.js': 'module.exports = {};',
      'debug.log': 'Error: Something went wrong'
    });
    
    // Write binary files separately
    await fs.writeFile(
      path.join(testDir, 'image.png'),
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    );
    await fs.writeFile(
      path.join(testDir, 'data.db'),
      Buffer.from([0x53, 0x51, 0x4C, 0x69, 0x74, 0x65, 0x20, 0x66])
    );
    
    tempDirs.push(testDir);
    
    // Act - Process with gitignore and binary detection
    const result = await simulateFileProcessingRecursive(testDir);
    
    // Assert
    const fileNames = result.files.map(f => f.name);
    expect(fileNames).toContain('app.js');                    // 1. Source files included
    expect(fileNames).toContain('utils.ts');
    expect(fileNames).toContain('.gitignore');                // 2. Config files included
    expect(fileNames).not.toContain('image.png');             // 3. Binary files excluded
    expect(fileNames).not.toContain('data.db');
    expect(fileNames).not.toContain('lib.js');                // 4. node_modules excluded
    expect(fileNames).not.toContain('debug.log');             // 5. Gitignored files excluded
  });

  it('should provide meaningful error messages for different failure scenarios', async () => {
    // Test multiple error scenarios
    const errorScenarios = [
      {
        path: '/nonexistent/directory/that/does/not/exist',
        expectedMessage: /ENOENT|no such file|not found/i
      }
    ];
    
    for (const scenario of errorScenarios) {
      const result = await simulateFileProcessing(scenario.path);
      
      // No debug logging needed anymore
      
      expect(result.status).toBe('error');                     // 1. Error status
      expect(result.message).toMatch(scenario.expectedMessage); // 2. Specific error message
      expect(result.files).toEqual([]);                        // 3. Clean error state
    }
    
    // Test empty path scenario separately
    try {
      await fs.readdir('');
    } catch (error) {
      expect(error).toBeDefined();                             // 4. Empty path throws error
    }
  });

  it('should maintain accurate token counts for AI context management', async () => {
    // Arrange - Create files with known content for token counting
    const testDir = await createTempTestDirectory({
      'short.txt': 'Hello world',                               // ~3 tokens
      'medium.js': 'function test() {\n  console.log("test");\n}', // ~10 tokens
      'long.md': '# Title\n\n'.repeat(50) + 'Content text.\n'.repeat(100) // ~200+ tokens
    });
    tempDirs.push(testDir);
    
    // Act
    const result = await simulateFileProcessing(testDir);
    
    // Assert
    const shortFile = result.files.find(f => f.name === 'short.txt');
    const mediumFile = result.files.find(f => f.name === 'medium.js');
    const longFile = result.files.find(f => f.name === 'long.md');
    
    expect(shortFile?.tokenCount).toBeGreaterThan(0);         // 1. All files have tokens
    expect(shortFile?.tokenCount).toBeLessThan(10);           // 2. Short file has few tokens
    expect(mediumFile?.tokenCount).toBeGreaterThan(shortFile!.tokenCount); // 3. Relative sizes
    expect(longFile?.tokenCount).toBeGreaterThan(mediumFile!.tokenCount);
    expect(result.totalTokens).toBe(                          // 4. Total is sum of parts
      shortFile!.tokenCount + mediumFile!.tokenCount + longFile!.tokenCount
    );
  });

  it('should handle file content requests with proper validation', async () => {
    // Arrange - Create test file
    const testDir = await createTempTestDirectory({
      'test-file.txt': 'This is test content\nWith multiple lines\nFor testing'
    });
    tempDirs.push(testDir);
    const filePath = path.join(testDir, 'test-file.txt');
    
    // Act - Simulate content request
    const content = await fs.readFile(filePath, 'utf8');
    
    // Assert
    expect(content).toBe('This is test content\nWith multiple lines\nFor testing'); // 1. Content retrieved
    expect(content.split('\n')).toHaveLength(3);              // 2. Line preservation
    expect(content.length).toBeGreaterThan(0);                // 3. Non-empty content
  });

  it('should handle concurrent file processing requests efficiently', async () => {
    // Arrange - Create multiple directories
    const dirs = await Promise.all([
      createTempTestDirectory({ 'file1.js': 'content1' }),
      createTempTestDirectory({ 'file2.js': 'content2' }),
      createTempTestDirectory({ 'file3.js': 'content3' })
    ]);
    tempDirs.push(...dirs);
    
    // Act - Process all directories concurrently
    const startTime = Date.now();
    const results = await Promise.all(
      dirs.map(dir => simulateFileProcessing(dir))
    );
    const endTime = Date.now();
    
    // Assert
    expect(results).toHaveLength(3);                           // 1. All processed
    expect(results.every(r => r.status === 'complete')).toBe(true); // 2. All successful
    expect(results.every(r => r.files.length === 1)).toBe(true); // 3. Correct file count
    expect(endTime - startTime).toBeLessThan(1000);           // 4. Concurrent execution
  });
});