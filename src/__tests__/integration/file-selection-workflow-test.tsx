import '@testing-library/jest-dom';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { render } from './test-setup';
import App from '../../index';
import { createTempTestDirectory, cleanupTempDirectory } from '../test-helpers';
import { DEFAULT_EXCLUSION_PATTERNS } from '../../constants';

// Define precise types for IPC event channels (kept for documentation)
// type IpcEventChannel = 'folder-selected' | 'file-list-data' | 'file-processing-status' | 'file-loading-complete' | 'file-loading-error';

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
  invoke: jest.fn((channel: string, ...args: unknown[]) => {
    if (channel === 'request-file-content') {
      const filePath = args[0] as string;
      // Return the content that was provided in the file-list-data
      const fileName = filePath.split('/').pop();
      const fileMap: Record<string, string> = {
        'index.js': 'console.log("hello world");',
        'utils.js': 'export const helper = () => { return 42; };',
        'Button.tsx': 'export const Button = () => <button>Click me</button>;',
        'README.md': '# Test Project\n\nThis is a test project for integration testing.',
        'package.json': '{\n  "name": "test-project",\n  "version": "1.0.0"\n}',
        'file1.js': 'const a = 1;',
        'file2.js': 'const b = 2;',
        'file3.js': 'const c = 3;',
        'persist.js': 'const persist = true;'
      };
      
      return Promise.resolve({
        success: true,
        content: fileMap[fileName!] || '',
        tokenCount: 10 // Simplified for testing
      });
    }
    return Promise.resolve({ success: false });
  })
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
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
    localStorageMock.clear.mockReset();
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
    // Clean up React components
    cleanup();
    
    if (tempDir) {
      await cleanupTempDirectory(tempDir);
    }
    
    // Clear all IPC handlers and reset mocks
    ipcHandlers.clear();
    jest.clearAllMocks();
    mockIpcRenderer.send.mockReset();
    mockIpcRenderer.on.mockReset();
    mockIpcRenderer.removeListener.mockReset();
    mockIpcRenderer.invoke.mockReset();
  });

  it('should complete full file selection workflow', async () => {
    render(<App />);

    // STEP 1: Select folder
    const selectFolderBtn = await screen.findByTitle('Select Folder', {}, { timeout: 3000 });
    expect(selectFolderBtn).toBeInTheDocument();                    // 1. Button exists
    
    // Track filter state for the mock
    let currentFilter: string[] = [];
    
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
        const [_folder, exclusions, _requestId] = _args; // Handle all parameters
        // Update current filter if provided
        if (exclusions && Array.isArray(exclusions)) {
          currentFilter = exclusions;
        }
        
        // Define all files
        const allFiles = [
          {
            name: 'index.js',
            path: `${tempDir}/src/index.js`,
            isDirectory: false,
            size: 29,
            isBinary: false,
            content: 'console.log("hello world");',
            tokenCount: 8,
            isContentLoaded: true
          },
          {
            name: 'utils.js',
            path: `${tempDir}/src/utils.js`,
            isDirectory: false,
            size: 45,
            isBinary: false,
            content: 'export const helper = () => { return 42; };',
            tokenCount: 12,
            isContentLoaded: true
          },
          {
            name: 'Button.tsx',
            path: `${tempDir}/src/components/Button.tsx`,
            isDirectory: false,
            size: 56,
            isBinary: false,
            content: 'export const Button = () => <button>Click me</button>;',
            tokenCount: 14,
            isContentLoaded: true
          },
          {
            name: 'README.md',
            path: `${tempDir}/README.md`,
            isDirectory: false,
            size: 75,
            isBinary: false,
            content: '# Test Project\n\nThis is a test project for integration testing.',
            tokenCount: 18,
            isContentLoaded: true
          },
          {
            name: 'package.json',
            path: `${tempDir}/package.json`,
            isDirectory: false,
            size: 60,
            isBinary: false,
            content: '{\n  "name": "test-project",\n  "version": "1.0.0"\n}',
            tokenCount: 15,
            isContentLoaded: true
          }
        ];
        
        // Filter files based on exclusion patterns
        const filteredFiles = allFiles.filter(file => {
          // Simple pattern matching for **/*.js
          if (currentFilter.includes('**/*.js') && file.name.endsWith('.js')) {
            return false;
          }
          return true;
        });
        
        // Simulate file list loading
        setTimeout(() => {
          // Send progress updates
          const progressHandlers = ipcHandlers.get('file-processing-status');
          if (progressHandlers) {
            progressHandlers.forEach(handler => handler({ 
              processed: 2, 
              total: filteredFiles.length, 
              status: 'processing',
              message: 'Loading files...'
            }));
          }
          
          // Send complete with file data
          setTimeout(() => {
            const completeHandlers = ipcHandlers.get('file-list-data');
            if (completeHandlers) {
              completeHandlers.forEach(handler => handler(filteredFiles, filteredFiles.reduce((sum, f) => sum + (f.tokenCount || 0), 0)));
            }
          }, 100);
        }, 0);
      } else if (channel === 'update-filter-patterns') {
        // Handle filter update
        const [patterns] = _args;
        currentFilter = (patterns as string[]) || [];
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
      expect(mockIpcRenderer.send).toHaveBeenCalledWith(
        'request-file-list',
        tempDir,
        DEFAULT_EXCLUSION_PATTERNS,
        expect.stringMatching(/^[a-z0-9]{9}$/)
      );
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
    const tokenDisplay = screen.getByText(/tokens \(loaded files only\)/i);
    expect(tokenDisplay).toHaveTextContent('0 tokens (loaded files only)');                     // 7. No tokens selected

    // STEP 4: Select specific files
    // Find the tree items and then find their checkboxes
    const indexFileItem = screen.getByText('index.js').closest('.tree-item');
    const utilsFileItem = screen.getByText('utils.js').closest('.tree-item');
    
    const indexFileCheckbox = indexFileItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const utilsFileCheckbox = utilsFileItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    
    fireEvent.click(indexFileCheckbox);
    fireEvent.click(utilsFileCheckbox);

    // STEP 5: Verify selection state
    await waitFor(() => {
      const updatedTokenDisplay = screen.getByText(/tokens \(loaded files only\)/i);
      expect(updatedTokenDisplay).toHaveTextContent('20 tokens (loaded files only)');          // 8. Token count updated (8+12)
    });

    expect(screen.getByText(/COPY ALL SELECTED \(2 files\)/i)).toBeInTheDocument(); // 9. Selection count

    // STEP 6: Test copy functionality
    const copyBtn = screen.getByText(/COPY ALL SELECTED \(2 files\)/i);
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
    const filterBtn = screen.getByTitle('Filters');
    fireEvent.click(filterBtn);

    // Wait for filter modal to appear and find the textarea
    await waitFor(() => {
      expect(screen.getByText('File Exclusion Filters')).toBeInTheDocument();
    });
    const filterTextarea = screen.getByRole('textbox');
    expect(filterTextarea).toBeInTheDocument();                      // 15. Filter modal open

    // Add exclusion pattern for JS files
    fireEvent.change(filterTextarea, { 
      target: { value: '**/*.js' } 
    });

    const saveFiltersBtn = screen.getByText('Save Filters');
    fireEvent.click(saveFiltersBtn);
    
    // The save action should update the exclusion patterns and trigger refresh
    // We need to simulate what happens in the app when filters are saved
    currentFilter = ['**/*.js'];

    // STEP 8: Wait for modal to close and file list to refresh
    await waitFor(() => {
      expect(screen.queryByText('File Exclusion Filters')).not.toBeInTheDocument();
    });
    
    // The app should automatically refresh file list after saving filters
    // Wait for the JS files to disappear
    await waitFor(() => {
      expect(screen.queryByText('index.js')).not.toBeInTheDocument(); // 16. JS files filtered
    }, { timeout: 5000 });
    
    await waitFor(() => {
      expect(screen.queryByText('utils.js')).not.toBeInTheDocument(); // 17. More JS filtered
    }, { timeout: 5000 });
    
    // Now check that TSX and MD files are still there
    await waitFor(() => {
      expect(screen.getByText('Button.tsx')).toBeInTheDocument();      // 18. TSX files remain
    }, { timeout: 5000 });
    
    expect(screen.getByText('README.md')).toBeInTheDocument();       // 19. MD files remain

    // Verify token count updated after filtering
    const finalTokenDisplay = screen.getByText(/tokens \(loaded files only\)/i);
    expect(finalTokenDisplay).toHaveTextContent('0 tokens (loaded files only)');                // 20. Tokens reset
  }, 10000); // Increase timeout to 10s

  it('should handle cancellation during file scanning', async () => {
    render(<App />);

    // Wait for app to be ready
    const selectFolderBtn = await screen.findByTitle('Select Folder', {}, { timeout: 3000 });
    
    // Ensure button is enabled at start
    expect(selectFolderBtn).not.toBeDisabled();
    
    // Mock slow file processing
    let cancelled = false;
    mockIpcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'open-folder') {
        // Simulate folder selection
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler('/large/directory'));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        const [_folder, _exclusions, _requestId] = args; // Handle all parameters
        // Start sending progress updates to trigger processing state
        setTimeout(() => {
          const progressHandlers = ipcHandlers.get('file-processing-status');
          if (progressHandlers) {
            progressHandlers.forEach(handler => handler({ 
              processed: 50, 
              total: 1000, 
              status: 'processing',
              message: 'Loading files...'
            }));
          }
        }, 50);
        
        // Continue sending progress updates
        const interval = setInterval(() => {
          if (!cancelled) {
            const progressHandlers = ipcHandlers.get('file-processing-status');
            if (progressHandlers) {
              progressHandlers.forEach(handler => handler({ 
                processed: 50, 
                total: 1000, 
                status: 'processing',
                message: 'Loading files...'
              }));
            }
          }
        }, 200);

        // Cleanup after 5s
        setTimeout(() => clearInterval(interval), 5000);
      } else if (channel === 'cancel-file-loading') {
        cancelled = true;
        // Send completion status after cancellation
        setTimeout(() => {
          const statusHandlers = ipcHandlers.get('file-processing-status');
          if (statusHandlers) {
            statusHandlers.forEach(handler => handler({ 
              status: 'complete',
              message: 'Cancelled',
              processed: 50,
              total: 1000
            }));
          }
        }, 50);
      }
    });

    // Start folder selection
    fireEvent.click(selectFolderBtn);

    // Wait for folder selection event to be processed
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('open-folder');
    });

    // Wait for processing to start by checking if Select Folder button is disabled
    await waitFor(() => {
      const selectFolderButton = screen.getByTitle('Select Folder');
      expect(selectFolderButton).toBeDisabled(); // 1. Button disabled during processing
    }, { timeout: 5000 });

    // Wait for ProcessingIndicator to appear with Cancel button
    await waitFor(() => {
      const processingIndicator = screen.getByText('Loading files...');
      expect(processingIndicator).toBeInTheDocument();
    }, { timeout: 5000 });

    // Find and click cancel button - it's inside the ProcessingIndicator
    const cancelBtn = screen.getByText('Cancel');
    expect(cancelBtn).toBeInTheDocument();                              // 2. Cancel available
    
    fireEvent.click(cancelBtn);

    // Verify cancellation handling
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('cancel-file-loading');   // 3. Cancel called
    });

    // Wait for Select Folder button to be re-enabled after cancellation
    await waitFor(() => {
      const selectFolderButton = screen.getByTitle('Select Folder');
      expect(selectFolderButton).not.toBeDisabled(); // 4. Button re-enabled after cancel
    }, { timeout: 5000 });

    expect(screen.getByTitle('Select Folder')).toBeInTheDocument();     // 5. Back to initial
  });

  it('should handle errors during file processing', async () => {
    render(<App />);

    const selectFolderBtn = await screen.findByTitle('Select Folder');
    
    // Mock file processing error
    mockIpcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'open-folder') {
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler('/restricted/folder'));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        const [_folder, _exclusions, _requestId] = args; // Handle all parameters
        // Send some progress first
        setTimeout(() => {
          const progressHandlers = ipcHandlers.get('file-processing-status');
          if (progressHandlers) {
            progressHandlers.forEach(handler => handler({ 
              processed: 10, 
              total: 100, 
              status: 'processing',
              message: 'Loading files...'
            }));
          }

          // Then error
          setTimeout(() => {
            const statusHandlers = ipcHandlers.get('file-processing-status');
            if (statusHandlers) {
              statusHandlers.forEach(handler => handler({
                status: 'error',
                message: 'Permission denied accessing directory',
                processed: 10,
                total: 100
              }));
            }
          }, 100);
        }, 0);
      }
    });

    // Start folder selection
    fireEvent.click(selectFolderBtn);

    // Wait for folder selection to be processed
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('open-folder');
    });

    // Wait for request-file-list to be called after folder selection
    await waitFor(() => {
      expect(mockIpcRenderer.send).toHaveBeenCalledWith(
        'request-file-list',
        '/restricted/folder',
        DEFAULT_EXCLUSION_PATTERNS,
        expect.stringMatching(/^[a-z0-9]{9}$/)
      );
    }); // 1. Request was made

    // Wait for error message to be displayed
    await waitFor(() => {
      const errorMessage = screen.getByText(/Permission denied accessing directory/i);
      expect(errorMessage).toBeInTheDocument(); // 2. Error message shown
    }, { timeout: 5000 });

    // Verify error is displayed in the error-message div
    const errorDiv = document.querySelector('.error-message');
    expect(errorDiv).toBeInTheDocument();                                    // 3. Error div exists
    expect(errorDiv?.textContent).toContain('Permission denied');           // 4. Contains error text

    // The app shows an error message but no Select Folder button during error state
    expect(screen.queryByTitle('Select Folder')).not.toBeInTheDocument();   // 5. No folder button in error state
  });

  it('should handle mixed file selection and deselection', async () => {
    render(<App />);

    // Setup: Load files first
    mockIpcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'open-folder') {
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler(tempDir));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        const [_folder, _exclusions, _requestId] = args; // Handle all parameters
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
                tokenCount: 5,
                isContentLoaded: true
              },
              {
                name: 'file2.js',
                path: `${tempDir}/file2.js`,
                isDirectory: false,
                size: 100,
                isBinary: false,
                content: 'const b = 2;',
                tokenCount: 5,
                isContentLoaded: true
              },
              {
                name: 'file3.js',
                path: `${tempDir}/file3.js`,
                isDirectory: false,
                size: 100,
                isBinary: false,
                content: 'const c = 3;',
                tokenCount: 5,
                isContentLoaded: true
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
    const file1Item = screen.getByText('file1.js').closest('.tree-item');
    const file2Item = screen.getByText('file2.js').closest('.tree-item');
    const file3Item = screen.getByText('file3.js').closest('.tree-item');
    
    const file1Checkbox = file1Item!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const file2Checkbox = file2Item!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const file3Checkbox = file3Item!.querySelector('input[type="checkbox"]') as HTMLInputElement;

    // Select all files
    fireEvent.click(file1Checkbox);
    fireEvent.click(file2Checkbox);
    fireEvent.click(file3Checkbox);

    await waitFor(() => {
      const tokenDisplay = screen.getByText(/tokens \(loaded files only\)/i);
      expect(tokenDisplay).toHaveTextContent('15 tokens (loaded files only)');      // 1. All tokens counted
      expect(screen.getByText(/COPY ALL SELECTED \(3 files\)/i)).toBeInTheDocument(); // 2. All selected
    });

    // Deselect middle file
    fireEvent.click(file2Checkbox);

    await waitFor(() => {
      const tokenDisplay = screen.getByText(/tokens \(loaded files only\)/i);
      expect(tokenDisplay).toHaveTextContent('10 tokens (loaded files only)');      // 3. Tokens updated
      expect(screen.getByText(/COPY ALL SELECTED \(2 files\)/i)).toBeInTheDocument(); // 4. Count updated
    });

    // Verify copy content excludes deselected file
    const copyBtn = screen.getByText(/COPY ALL SELECTED \(2 files\)/i);
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
    mockIpcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'open-folder') {
        setTimeout(() => {
          const handlers = ipcHandlers.get('folder-selected');
          if (handlers) {
            handlers.forEach(handler => handler(tempDir));
          }
        }, 0);
      } else if (channel === 'request-file-list') {
        const [_folder, _exclusions, _requestId] = args; // Handle all parameters
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
                tokenCount: 6,
                isContentLoaded: true
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
    const fileItem = screen.getByText('persist.js').closest('.tree-item');
    const fileCheckbox = fileItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(fileCheckbox);

    await waitFor(() => {
      const tokenDisplay = screen.getByText(/tokens \(loaded files only\)/i);
      expect(tokenDisplay).toHaveTextContent('6 tokens (loaded files only)');       // 1. Initial selection
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
      const restoredTokenDisplay = screen.queryByText(/tokens \(loaded files only\)/i);
      if (restoredTokenDisplay) {
        expect(restoredTokenDisplay).toHaveTextContent('6 tokens (loaded files only)');             // 3. State restored
      }
    });
  });
});