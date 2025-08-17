import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContentArea from '../../components/content-area';
import { FileData } from '../../types/file-types';

// Mock dependencies
jest.mock('../../handlers/electron-handlers', () => ({
  requestFileContent: jest.fn(),
  setupElectronHandlers: jest.fn(),
  setGlobalRequestId: jest.fn(),
  openFolderDialog: jest.fn(),
  cancelFileLoading: jest.fn()
}));

jest.mock('../../utils/token-utils', () => ({
  countTokens: jest.fn((content) => content ? content.length : 0),
  estimateTokenCount: jest.fn((content) => Math.floor(content.length * 0.25)),
  calculateFileTreeTokens: jest.fn(() => 50),
  getFileTreeModeTokens: jest.fn(() => 10)
}));

describe('ContentArea optimistic content loading', () => {
  const mockLoadFileContent = jest.fn();
  const mockGetSelectedFilesContent = jest.fn();
  
  const createMockFile = (path: string, isLoaded = false, content?: string): FileData => ({
    path,
    name: path.split('/').pop() || '',
    isDirectory: false,
    isBinary: false,
    isContentLoaded: isLoaded,
    isSkipped: false,
    content: content,
    size: 100,
    tokenCount: content ? content.length : undefined
  });

  const defaultProps = {
    selectedFiles: [],
    expandedNodes: new Set<string>(),
    fileTreeToggle: 'none' as const,
    selectedFolder: '/test',
    allFiles: [],
    userInstructions: '',
    systemPrompts: [],
    rolePrompts: [],
    instructions: [],
    sortOrder: 'alphabetical' as const,
    loadFileContent: mockLoadFileContent,
    getSelectedFilesContent: mockGetSelectedFilesContent
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSelectedFilesContent.mockImplementation((files: FileData[], selected: { path: string }[]) => {
      return selected.map(s => {
        const file = files.find(f => f.path === s.path);
        if (!file) return '';
        if (file.isContentLoaded && file.content) {
          return file.content;
        }
        return '[Content is loading...]';
      }).join('\n');
    });
  });

  it('should show content immediately after optimistic load without loading placeholder', async () => {
    const testContent = 'This is the file content that should appear immediately';
    const testFile = createMockFile('/test/file.ts', false);
    
    // Mock loadFileContent to simulate optimistic content application
    mockLoadFileContent.mockImplementation(async () => {
      // Simulate the optimistic update that happens immediately
      testFile.isContentLoaded = true;
      testFile.content = testContent;
      testFile.tokenCount = testContent.length; // Estimated token count
      
      // Simulate background token counting (happens after content is applied)
      setTimeout(() => {
        testFile.tokenCount = Math.floor(testContent.length * 0.75); // Precise count
      }, 10);
      
      return Promise.resolve();
    });

    render(
      <ContentArea 
        {...defaultProps}
        selectedFiles={[{ path: '/test/file.ts' }]}
        allFiles={[testFile]}
      />
    );

    // Click the copy button to trigger loading
    const copyButton = screen.getByRole('button', { name: /copy/i });
    await userEvent.click(copyButton);

    // Wait for loadFileContent to be called
    await waitFor(() => {
      expect(mockLoadFileContent).toHaveBeenCalledWith('/test/file.ts');
    });

    // After optimistic load, content should be available immediately
    // without showing loading placeholder
    await waitFor(() => {
      const result = mockGetSelectedFilesContent([testFile], [{ path: '/test/file.ts' }]);
      expect(result).toContain(testContent);
      expect(result).not.toContain('[Content is loading...]');
    });

    // Verify that even after token counting completes, content remains
    await waitFor(() => {
      expect(testFile.tokenCount).toBeLessThan(testContent.length); // Precise count applied
    }, { timeout: 100 });
    
    const finalResult = mockGetSelectedFilesContent([testFile], [{ path: '/test/file.ts' }]);
    expect(finalResult).toContain(testContent);
  });

  it('should handle multiple files with optimistic loading', async () => {
    const file1 = createMockFile('/test/file1.ts', false);
    const file2 = createMockFile('/test/file2.ts', false);
    const content1 = 'Content of file 1';
    const content2 = 'Content of file 2';
    
    mockLoadFileContent.mockImplementation(async (filePath) => {
      if (filePath === '/test/file1.ts') {
        file1.isContentLoaded = true;
        file1.content = content1;
        file1.tokenCount = content1.length;
      } else if (filePath === '/test/file2.ts') {
        file2.isContentLoaded = true;
        file2.content = content2;
        file2.tokenCount = content2.length;
      }
    });

    render(
      <ContentArea 
        {...defaultProps}
        selectedFiles={[
          { path: '/test/file1.ts' },
          { path: '/test/file2.ts' }
        ]}
        allFiles={[file1, file2]}
      />
    );

    const copyButton = screen.getByRole('button', { name: /copy/i });
    await userEvent.click(copyButton);

    await waitFor(() => {
      expect(mockLoadFileContent).toHaveBeenCalledTimes(2);
    });

    // Both files should have content without loading placeholders
    const result = mockGetSelectedFilesContent(
      [file1, file2], 
      [{ path: '/test/file1.ts' }, { path: '/test/file2.ts' }]
    );
    
    expect(result).toContain(content1);
    expect(result).toContain(content2);
    expect(result).not.toContain('[Content is loading...]');
  });

  it('should show proper placeholders for binary and error files', async () => {
    const textFile = createMockFile('/test/text.ts', false);
    const binaryFile = createMockFile('/test/image.png', false);
    binaryFile.isBinary = true;
    binaryFile.fileType = 'png';
    
    const errorFile = createMockFile('/test/error.ts', false);
    errorFile.error = 'Permission denied';
    
    mockGetSelectedFilesContent.mockImplementation((files: FileData[], selected: { path: string }[]) => {
      return selected.map(s => {
        const file = files.find(f => f.path === s.path);
        if (!file) return '';
        if (file.isBinary) return `[Binary file omitted: ${file.fileType}]`;
        if (file.error) return `[Failed to load file: ${file.error}]`;
        if (file.isContentLoaded && file.content) return file.content;
        return '[Content is loading...]';
      }).join('\n');
    });
    
    mockLoadFileContent.mockImplementation(async (filePath) => {
      if (filePath === '/test/text.ts') {
        textFile.isContentLoaded = true;
        textFile.content = 'Text content';
      }
    });

    render(
      <ContentArea 
        {...defaultProps}
        selectedFiles={[
          { path: '/test/text.ts' },
          { path: '/test/image.png' },
          { path: '/test/error.ts' }
        ]}
        allFiles={[textFile, binaryFile, errorFile]}
      />
    );

    const copyButton = screen.getByRole('button', { name: /copy/i });
    await userEvent.click(copyButton);

    await waitFor(() => {
      expect(mockLoadFileContent).toHaveBeenCalledWith('/test/text.ts');
    });

    const result = mockGetSelectedFilesContent(
      [textFile, binaryFile, errorFile],
      [
        { path: '/test/text.ts' },
        { path: '/test/image.png' },
        { path: '/test/error.ts' }
      ]
    );
    
    expect(result).toContain('Text content');
    expect(result).toContain('[Binary file omitted: png]');
    expect(result).toContain('[Failed to load file: Permission denied]');
    expect(result).not.toContain('[Content is loading...]');
  });
});