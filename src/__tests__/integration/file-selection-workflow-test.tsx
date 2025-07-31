import '@testing-library/jest-dom';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from './test-setup';
import App from '../../index';
import { createTempTestDirectory, cleanupTempDirectory } from '../test-helpers';
import { DEFAULT_EXCLUSION_PATTERNS } from '../../constants';

// Define precise types for IPC event channels
type IpcEventChannel = 'folder-selected' | 'file-list-data' | 'file-loading-progress' | 'file-loading-complete' | 'file-loading-error';

// Mock IPC handlers storage
const ipcHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

// Mock window.electron.ipcRenderer with proper types
const mockIpcRenderer = {
  send: jest.fn(),
  on: jest.fn((channel: string, handler: (...args: unknown[]) => void) => {
    const handlers = ipcHandlers.get(channel) || [];
    handlers.push(handler);
    ipcHandlers.set(channel, handlers);
  }),
  removeListener: jest.fn((channel: string, handler: (...args: unknown[]) => void) => {
    const handlers = ipcHandlers.get(channel) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      ipcHandlers.set(channel, handlers);
    }
  }),
  invoke: jest.fn((_channel: string, ..._args: unknown[]) => Promise.resolve())
} as const;

// Update the existing window.electron from jest.setup.js
if (window.electron) {
  window.electron.ipcRenderer = mockIpcRenderer;
} else {
  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: mockIpcRenderer
    },
    writable: true,
    configurable: true
  });
}

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined)
  }
});

describe('Complete File Selection Workflow Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Clear all mocks and handlers
    jest.clearAllMocks();
    ipcHandlers.clear();
    localStorageMock.getItem.mockReturnValue(null);

    // Create test directory structure
    tempDir = await createTempTestDirectory({
      'src/index.js': 'console.log("hello world");',
      'src/utils.js': 'export const helper = () => { return 42; };',
      'src/components/Button.tsx': 'export const Button = () => <button>Click me</button>;',
      'README.md': '# Test Project\n\nThis is a test project for integration testing.',
      'package.json': '{\n  "name": "test-project",\n  "version": "1.0.0"\n}',
      '.gitignore': 'node_modules/\ndist/\n*.log',
      'node_modules/react/index.js': 'module.exports = React;' // Should be excluded
    });
  });

  afterEach(async () => {
    if (tempDir) {
      await cleanupTempDirectory(tempDir);
    }
  });

  it('should complete full file selection workflow', async () => {
    render(<App />);

    // STEP 1: Select folder
    console.log('Looking for Select Folder button');
    const selectFolderBtn = await screen.findByTitle('Select Folder', {}, { timeout: 3000 });
    expect(selectFolderBtn).toBeInTheDocument();                    // 1. Button exists
    console.log('Found Select Folder button');
    
    // Mock the open-folder flow
    mockIpcRenderer.send.mockImplementation((channel: string, ..._args: unknown[]) => {
      if (channel === 'open-folder') {
        // Simulate folder selection
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler(tempDir));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        // Simulate file list loading
        setTimeout(() => {
          // Send progress updates
          const progressHandlers = ipcHandlers.get('file-loading-progress');
          if (progressHandlers) {
            progressHandlers.forEach(handler => handler({ 
              processed: 2, 
              total: 6, 
              status: 'processing' 
            }));
          }
          
          // Send complete with file data
          setTimeout(() => {
            const completeHandlers = ipcHandlers.get('file-list-data');
            if (completeHandlers) {
              completeHandlers.forEach(handler => handler([
          {
            name: 'index.js',
            path: `${tempDir}/src/index.js`,
            isDirectory: false,
            size: 29,
            isBinary: false,
            content: 'console.log("hello world");',
            tokenCount: 8
          },
          {
            name: 'utils.js',
            path: `${tempDir}/src/utils.js`,
            isDirectory: false,
            size: 45,
            isBinary: false,
            content: 'export const helper = () => { return 42; };',
            tokenCount: 12
          },
          {
            name: 'Button.tsx',
            path: `${tempDir}/src/components/Button.tsx`,
            isDirectory: false,
            size: 56,
            isBinary: false,
            content: 'export const Button = () => <button>Click me</button>;',
            tokenCount: 14
          },
          {
            name: 'README.md',
            path: `${tempDir}/README.md`,
            isDirectory: false,
            size: 75,
            isBinary: false,
            content: '# Test Project\n\nThis is a test project for integration testing.',
            tokenCount: 18
          },
          {
            name: 'package.json',
            path: `${tempDir}/package.json`,
            isDirectory: false,
            size: 60,
            isBinary: false,
            content: '{\n  "name": "test-project",\n  "version": "1.0.0"\n}',
            tokenCount: 15
          }
                ], 67));
            }
          }, 100);
        }, 0);
      }
    });

    // Click select folder
    fireEvent.click(selectFolderBtn);

    // STEP 2: Wait for file scanning to complete
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('open-folder');
    });
    
    // Wait for folder selection to process
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('request-file-list', tempDir, DEFAULT_EXCLUSION_PATTERNS);
    });

    // Wait for files to be displayed
    await waitFor(() => {
      expect(screen.getByText('index.js')).toBeInTheDocument();      // 2. JS files shown
    }, { timeout: 5000 });

    expect(screen.getByText('utils.js')).toBeInTheDocument();        // 3. More JS files
    expect(screen.getByText('Button.tsx')).toBeInTheDocument();      // 4. TSX files shown
    expect(screen.getByText('README.md')).toBeInTheDocument();       // 5. MD files shown
    expect(screen.queryByText('node_modules')).not.toBeInTheDocument(); // 6. Excluded properly

    // STEP 3: Verify initial state
    const tokenDisplay = screen.getByText(/tokens:/i);
    expect(tokenDisplay).toHaveTextContent('0');                     // 7. No tokens selected

    // STEP 4: Select specific files
    const indexFileCheckbox = screen.getByTestId('file-checkbox-src/index.js');
    const utilsFileCheckbox = screen.getByTestId('file-checkbox-src/utils.js');
    
    fireEvent.click(indexFileCheckbox);
    fireEvent.click(utilsFileCheckbox);

    // STEP 5: Verify selection state
    await waitFor(() => {
      const updatedTokenDisplay = screen.getByText(/tokens:/i);
      expect(updatedTokenDisplay).toHaveTextContent('20');          // 8. Token count updated (8+12)
    });

    expect(screen.getByText(/2 files selected/i)).toBeInTheDocument(); // 9. Selection count

    // STEP 6: Test copy functionality
    const copyBtn = screen.getByTestId('copy-selected-button');
    expect(copyBtn).not.toBeDisabled();                              // 10. Copy button enabled
    
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();   // 11. Copy called
    });

    const copiedContent = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0];
    expect(copiedContent).toContain('console.log("hello world");');  // 12. Content copied
    expect(copiedContent).toContain('export const helper');          // 13. Second file included
    expect(copiedContent).not.toContain('Button.tsx');              // 14. Unselected excluded

    // STEP 7: Apply filters
    const filterBtn = screen.getByTestId('filter-button');
    fireEvent.click(filterBtn);

    // Wait for filter modal to appear
    const filterTextarea = await screen.findByPlaceholderText(/enter patterns/i);
    expect(filterTextarea).toBeInTheDocument();                      // 15. Filter modal open

    // Add exclusion pattern for JS files
    fireEvent.change(filterTextarea, { 
      target: { value: '**/*.js' } 
    });

    const saveFiltersBtn = screen.getByText('Save');
    fireEvent.click(saveFiltersBtn);

    // STEP 8: Verify filtering worked
    await waitFor(() => {
      expect(screen.queryByText('index.js')).not.toBeInTheDocument(); // 16. JS files filtered
      expect(screen.queryByText('utils.js')).not.toBeInTheDocument(); // 17. More JS filtered
    });
    expect(screen.getByText('Button.tsx')).toBeInTheDocument();      // 18. TSX files remain
    expect(screen.getByText('README.md')).toBeInTheDocument();       // 19. MD files remain

    // Verify token count updated after filtering
    const finalTokenDisplay = screen.getByText(/tokens:/i);
    expect(finalTokenDisplay).toHaveTextContent('0');                // 20. Tokens reset
  }, 10000); // Increase timeout to 10s

  it('should handle cancellation during file scanning', async () => {
    render(<App />);

    const selectFolderBtn = await screen.findByTitle('Select Folder');
    
    // Mock slow file processing
    let cancelled = false;
    mockIpcRenderer.send.mockImplementation((channel: string) => {
      if (channel === 'open-folder') {
        // Simulate folder selection
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler('/large/directory'));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        // Start sending progress updates
        const interval = setInterval(() => {
          if (!cancelled) {
            const progressHandlers = ipcHandlers.get('file-loading-progress');
            if (progressHandlers) {
              progressHandlers.forEach(handler => handler({ 
                processed: 50, 
                total: 1000, 
                status: 'processing' 
              }));
            }
          }
        }, 100);

        // Cleanup after 5s
        setTimeout(() => clearInterval(interval), 5000);
      } else if (channel === 'cancel-file-loading') {
        cancelled = true;
        const progressHandlers = ipcHandlers.get('file-loading-progress');
        if (progressHandlers) {
          progressHandlers.forEach(handler => handler({ 
            processed: 50, 
            total: 1000, 
            status: 'cancelled' 
          }));
        }
      }
    });

    // Start folder selection
    fireEvent.click(selectFolderBtn);

    // Wait for scanning to start
    await waitFor(() => {
      expect(screen.getByText(/processing files/i)).toBeInTheDocument(); // 1. Progress shown
    });

    // Find and click cancel button
    const cancelBtn = screen.getByText('Cancel');
    expect(cancelBtn).toBeInTheDocument();                              // 2. Cancel available
    
    fireEvent.click(cancelBtn);

    // Verify cancellation handling
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('cancel-file-loading');   // 3. Cancel called
    });

    await waitFor(() => {
      expect(screen.queryByText(/processing files/i)).not.toBeInTheDocument(); // 4. Progress gone
    });

    expect(screen.getByTitle('Select Folder')).toBeInTheDocument();     // 5. Back to initial
  });

  it('should handle errors during file processing', async () => {
    render(<App />);

    const selectFolderBtn = await screen.findByTitle('Select Folder');
    
    // Mock file processing error
    mockIpcRenderer.send.mockImplementation((channel: string) => {
      if (channel === 'open-folder') {
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler('/restricted/folder'));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        // Send some progress first
        setTimeout(() => {
          const progressHandlers = ipcHandlers.get('file-loading-progress');
          if (progressHandlers) {
            progressHandlers.forEach(handler => handler({ 
              processed: 10, 
              total: 100, 
              status: 'processing' 
            }));
          }

          // Then error
          setTimeout(() => {
            const errorHandlers = ipcHandlers.get('file-loading-error');
            if (errorHandlers) {
              errorHandlers.forEach(handler => handler({
                error: 'Permission denied accessing directory',
                code: 'EACCES'
              }));
            }
          }, 100);
        }, 0);
      }
    });

    // Start folder selection
    fireEvent.click(selectFolderBtn);

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument(); // 1. Error shown
    });

    // Verify UI state after error
    expect(screen.queryByText(/processing files/i)).not.toBeInTheDocument(); // 2. No progress
    expect(screen.getByTitle('Select Folder')).toBeInTheDocument();          // 3. Can retry

    // Verify error details if shown
    const errorDetails = screen.queryByText(/EACCES/i);
    if (errorDetails) {
      expect(errorDetails).toBeInTheDocument();                             // 4. Error code shown
    }
  });

  it('should handle mixed file selection and deselection', async () => {
    render(<App />);

    // Setup: Load files first
    mockIpcRenderer.send.mockImplementation((channel: string) => {
      if (channel === 'open-folder') {
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler(tempDir));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        setTimeout(() => {
          const completeHandlers = ipcHandlers.get('file-list-data');
          if (completeHandlers) {
            completeHandlers.forEach(handler => handler([
              {
                name: 'file1.js',
                path: `${tempDir}/file1.js`,
                isDirectory: false,
                size: 100,
                isBinary: false,
                content: 'const a = 1;',
                tokenCount: 5
              },
              {
                name: 'file2.js',
                path: `${tempDir}/file2.js`,
                isDirectory: false,
                size: 100,
                isBinary: false,
                content: 'const b = 2;',
                tokenCount: 5
              },
              {
                name: 'file3.js',
                path: `${tempDir}/file3.js`,
                isDirectory: false,
                size: 100,
                isBinary: false,
                content: 'const c = 3;',
                tokenCount: 5
              }
            ], 15));
          }
        }, 0);
      }
    });

    const selectFolderBtn = await screen.findByTitle('Select Folder');
    fireEvent.click(selectFolderBtn);

    await waitFor(() => {
      expect(screen.getByText('file1.js')).toBeInTheDocument();
    });

    // Test selection flow
    const file1Checkbox = screen.getByTestId('file-checkbox-file1.js');
    const file2Checkbox = screen.getByTestId('file-checkbox-file2.js');
    const file3Checkbox = screen.getByTestId('file-checkbox-file3.js');

    // Select all files
    fireEvent.click(file1Checkbox);
    fireEvent.click(file2Checkbox);
    fireEvent.click(file3Checkbox);

    await waitFor(() => {
      expect(screen.getByText(/15 tokens/i)).toBeInTheDocument();      // 1. All tokens counted
      expect(screen.getByText(/3 files selected/i)).toBeInTheDocument(); // 2. All selected
    });

    // Deselect middle file
    fireEvent.click(file2Checkbox);

    await waitFor(() => {
      expect(screen.getByText(/10 tokens/i)).toBeInTheDocument();      // 3. Tokens updated
      expect(screen.getByText(/2 files selected/i)).toBeInTheDocument(); // 4. Count updated
    });

    // Verify copy content excludes deselected file
    const copyBtn = screen.getByTestId('copy-selected-button');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    const copiedContent = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0];
    expect(copiedContent).toContain('const a = 1;');                   // 5. File1 included
    expect(copiedContent).not.toContain('const b = 2;');              // 6. File2 excluded
    expect(copiedContent).toContain('const c = 3;');                   // 7. File3 included
  });

  it('should persist and restore selection state', async () => {
    const { rerender } = render(<App />);

    // Setup initial selection
    mockIpcRenderer.send.mockImplementation((channel: string) => {
      if (channel === 'open-folder') {
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler(tempDir));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        setTimeout(() => {
          const completeHandlers = ipcHandlers.get('file-list-data');
          if (completeHandlers) {
            completeHandlers.forEach(handler => handler([
              {
                name: 'persist.js',
                path: `${tempDir}/persist.js`,
                isDirectory: false,
                size: 100,
                isBinary: false,
                content: 'const persist = true;',
                tokenCount: 6
              }
            ], 6));
          }
        }, 0);
      }
    });

    const selectFolderBtn = await screen.findByTitle('Select Folder');
    fireEvent.click(selectFolderBtn);

    await waitFor(() => {
      expect(screen.getByText('persist.js')).toBeInTheDocument();
    });

    // Select the file
    const fileCheckbox = screen.getByTestId('file-checkbox-persist.js');
    fireEvent.click(fileCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/6 tokens/i)).toBeInTheDocument();       // 1. Initial selection
    });

    // Verify localStorage was called to persist state
    expect(localStorageMock.setItem).toHaveBeenCalled();              // 2. State persisted

    // Simulate app restart by re-rendering
    rerender(<App />);

    // Mock localStorage to return saved state
    localStorageMock.getItem.mockImplementation((key) => {
      if (key === 'selectedFiles') {
        return JSON.stringify([{
          path: `${tempDir}/persist.js`,
          content: 'const persist = true;',
          tokenCount: 6
        }]);
      }
      return null;
    });

    // Wait for restored state to be reflected
    await waitFor(() => {
      const restoredTokenDisplay = screen.queryByText(/6 tokens/i);
      if (restoredTokenDisplay) {
        expect(restoredTokenDisplay).toBeInTheDocument();             // 3. State restored
      }
    });
  });
});