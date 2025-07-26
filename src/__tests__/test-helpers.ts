// Shared test helpers and mocks
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// Mock localStorage functionality
export const setupMockLocalStorage = () => {
  const mockLocalStorage = (function() {
    let store: Record<string, string> = {};
    
    return {
      getItem: (key: string) => {
        return store[key] || null;
      },
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      }
    };
  })();

  Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage
  });

  // Initialize with empty values
  window.localStorage.clear();
};

// Safely mock Date.now() with automatic cleanup
export const mockDateNow = (mockValue: number) => {
  const originalDateNow = Date.now;
  jest.spyOn(Date, 'now').mockImplementation(() => mockValue);
  
  // Return cleanup function
  return () => {
    (Date.now as jest.Mock).mockRestore();
  };
};

// Create a temporary test directory with given file structure
export const createTempTestDirectory = async (files: Record<string, string>): Promise<string> => {
  const tempDir = join(tmpdir(), `pasteflow-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  
  // Create the temp directory
  await fs.mkdir(tempDir, { recursive: true });
  
  // Create all files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(tempDir, ...filePath.split('/'));
    const dir = dirname(fullPath);
    
    // Create parent directories if needed
    if (dir && dir !== tempDir) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    // Write file content
    await fs.writeFile(fullPath, content, 'utf8');
  }
  
  return tempDir;
};

// Clean up temporary test directory
export const cleanupTempDirectory = async (tempDir: string): Promise<void> => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors during cleanup
    console.warn(`Failed to cleanup temp directory ${tempDir}:`, error);
  }
}; 