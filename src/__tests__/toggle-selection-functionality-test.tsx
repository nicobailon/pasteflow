import * as React from 'react';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FileData, SelectedFileWithLines } from '../types/file-types';
import { STORAGE_KEYS } from '../constants';
import { setupMockLocalStorage, renderWithProviders } from './test-helpers';
import FileCard from '../components/file-card';
import useFileSelectionState from '../hooks/use-file-selection-state';

// Test component that uses the file selection hook
const FileSelectionTestComponent = ({ 
  allFiles,
  onSelectionChange 
}: { 
  allFiles: FileData[];
  onSelectionChange?: (files: SelectedFileWithLines[]) => void;
}) => {
  const fileSelection = useFileSelectionState(allFiles, '/project');
  
  React.useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(fileSelection.selectedFiles);
    }
  }, [fileSelection.selectedFiles, onSelectionChange]);
  
  return (
    <div>
      <div data-testid="selected-files-count">
        {fileSelection.selectedFiles.length}
      </div>
      <div data-testid="total-tokens">
        {fileSelection.selectedFiles.reduce((sum, file) => sum + (file.tokenCount || 0), 0)}
      </div>
      {allFiles.map(file => (
        <button
          key={file.path}
          data-testid={`select-${file.name}`}
          onClick={() => fileSelection.toggleFileSelection(file.path)}
        >
          {file.name}
        </button>
      ))}
      {fileSelection.selectedFiles.map(file => (
        <div key={file.path} data-testid={`selected-${file.path}`}>
          {file.path}
          <button
            data-testid={`deselect-${file.path}`}
            onClick={() => fileSelection.toggleFileSelection(file.path)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
};

describe('File Selection Business Logic', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Realistic test data with multiple files
  const createTestFiles = (): FileData[] => [
    {
      name: 'api-handler.js',
      path: '/project/src/api-handler.js',
      isDirectory: false,
      content: 'export async function handleRequest(req, res) {\n  const data = await fetchData(req.params.id);\n  res.json(data);\n}',
      size: 150,
      tokenCount: 25,
      isBinary: false,
      isSkipped: false,
      isContentLoaded: true,
    },
    {
      name: 'user-service.js',
      path: '/project/src/user-service.js',
      isDirectory: false,
      content: 'class UserService {\n  async getUser(id) {\n    return db.users.find(id);\n  }\n}\nexport default UserService;',
      size: 200,
      tokenCount: 30,
      isBinary: false,
      isSkipped: false,
      isContentLoaded: true,
    },
    {
      name: 'large-file.js',
      path: '/project/src/large-file.js',
      isDirectory: false,
      content: 'x'.repeat(100000), // Simulate large file
      size: 100000,
      tokenCount: 150000, // Over typical LLM limit
      isBinary: false,
      isSkipped: false,
      isContentLoaded: true,
    },
    {
      name: 'image.png',
      path: '/project/assets/image.png',
      isDirectory: false,
      content: undefined,
      size: 50000,
      tokenCount: undefined,
      isBinary: true,
      isSkipped: false,
      isContentLoaded: false,
    },
  ];
  
  it('should calculate correct token count when selecting files', async () => {
    const testFiles = createTestFiles();
    
    renderWithProviders(
      <FileSelectionTestComponent allFiles={testFiles} />
    );
    
    // Initially no files selected
    expect(screen.getByTestId('total-tokens')).toHaveTextContent('0');
    expect(screen.getByTestId('selected-files-count')).toHaveTextContent('0');
    
    // Select first file (25 tokens)
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-api-handler.js'));
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('selected-files-count')).toHaveTextContent('1');
      expect(screen.getByTestId('total-tokens')).toHaveTextContent('25');
    });
    
    // Select second file (30 tokens)
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-user-service.js'));
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('selected-files-count')).toHaveTextContent('2');
      expect(screen.getByTestId('total-tokens')).toHaveTextContent('55'); // 25 + 30
    });
    
    // Verify localStorage is updated
    const storedFiles = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.SELECTED_FILES) || '[]'
    );
    expect(storedFiles).toHaveLength(2);
    expect(storedFiles[0].path).toBe('/project/src/api-handler.js');
    expect(storedFiles[1].path).toBe('/project/src/user-service.js');
  });

  it('should exclude binary files from token counting', async () => {
    const testFiles = createTestFiles();
    
    renderWithProviders(
      <div>
        <FileCard
          file={testFiles[3]} // binary file
          selectedFile={undefined}
          toggleSelection={jest.fn()}
          onViewFile={jest.fn()}
          loadFileContent={jest.fn()}
        />
        <FileCard
          file={testFiles[0]} // text file
          selectedFile={{ path: testFiles[0].path, isFullFile: true, tokenCount: 25 }}
          toggleSelection={jest.fn()}
          onViewFile={jest.fn()}
          loadFileContent={jest.fn()}
        />
      </div>
    );
    
    // Verify binary file shows no token count
    const binaryCard = screen.getByText('image.png').closest('.file-card');
    expect(binaryCard).toBeInTheDocument();
    expect(binaryCard?.textContent).toMatch(/Loading|N\/A/);
    
    // Verify text file shows token count  
    const textCard = screen.getByText('api-handler.js').closest('.file-card');
    expect(textCard).toBeInTheDocument();
    expect(textCard?.textContent).toMatch(/25/);  
    expect(textCard?.textContent).toMatch(/tokens/i);
    
    // Binary files should not contribute to token count
    renderWithProviders(
      <FileSelectionTestComponent allFiles={testFiles} />
    );
    
    // Select text file first to get some tokens
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-api-handler.js'));
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('total-tokens')).toHaveTextContent('25');
    });
    
    // Now select binary file
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-image.png'));
    });
    
    // Token count should still be 25 since binary files have no tokens
    expect(screen.getByTestId('total-tokens')).toHaveTextContent('25');
  });
  
  it('should handle file deselection and maintain state consistency', async () => {
    const testFiles = createTestFiles();
    
    renderWithProviders(
      <FileSelectionTestComponent allFiles={testFiles} />
    );
    
    // Select two files
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-api-handler.js'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-user-service.js'));
    });
    
    // Wait for selection
    await waitFor(() => {
      expect(screen.getByTestId('selected-files-count')).toHaveTextContent('2');
    });
    
    // Deselect first file
    await act(async () => {
      fireEvent.click(screen.getByTestId('deselect-/project/src/api-handler.js'));
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('selected-files-count')).toHaveTextContent('1');
      expect(screen.queryByTestId('selected-/project/src/api-handler.js')).not.toBeInTheDocument();
      expect(screen.getByTestId('selected-/project/src/user-service.js')).toBeInTheDocument();
    });
    
    // Verify localStorage reflects the change
    const storedFiles = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.SELECTED_FILES) || '[]'
    );
    expect(storedFiles).toHaveLength(1);
    expect(storedFiles[0].path).toBe('/project/src/user-service.js');
    
    // Verify token count updated
    expect(screen.getByTestId('total-tokens')).toHaveTextContent('30'); // Only user-service.js
  });
});

describe('Line Range Selection Business Logic', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    jest.clearAllMocks();
  });

  it('should calculate tokens only for selected line ranges', async () => {
    const fileWithLineInfo: FileData = {
      name: 'multiline-file.js',
      path: '/project/src/multiline-file.js',
      isDirectory: false,
      content: `function line1() { return 1; }\nfunction line2() { return 2; }\nfunction line3() { return 3; }\nfunction line4() { return 4; }\nfunction line5() { return 5; }`,
      size: 200,
      tokenCount: 50, // Total for all lines
      isBinary: false,
      isSkipped: false,
      isContentLoaded: true,
    };

    const selectedWithRange: SelectedFileWithLines = {
      path: fileWithLineInfo.path,
      isFullFile: false,
      lines: [{ start: 2, end: 3 }], // Only lines 2-3
      content: 'function line2() { return 2; }\nfunction line3() { return 3; }',
      tokenCount: 20, // Token count for selected lines only
      isContentLoaded: true,
    };

    renderWithProviders(
      <FileCard
        file={fileWithLineInfo}
        selectedFile={selectedWithRange}
        toggleSelection={jest.fn()}
        onViewFile={jest.fn()}
        loadFileContent={jest.fn()}
      />
    );

    // Verify line range is displayed
    expect(screen.getByText(/Lines 2-3/)).toBeInTheDocument();
    
    // Verify token count is for selected lines only
    const card = screen.getByText('multiline-file.js').closest('.file-card');
    expect(card?.textContent).toMatch(/20/);
    expect(card?.textContent).toMatch(/tokens/i);
    
    // Verify partial selection indicator
    expect(card?.textContent).toContain('Lines 2-3');
    expect(card?.textContent).not.toContain('Entire file');
  });

  it('should handle multiple line ranges in a single file', async () => {
    // Test component that displays line ranges
    const LineRangeDisplay = ({ file }: { file: SelectedFileWithLines }) => (
      <div data-testid="file-with-ranges">
        <div data-testid="file-path">{file.path}</div>
        <div data-testid="line-count">
          {file.lines ? file.lines.length : 0} ranges
        </div>
        {file.lines?.map((range, idx) => (
          <div key={idx} data-testid={`range-${idx}`}>
            Lines {range.start}-{range.end}
          </div>
        ))}
      </div>
    );

    const selectedWithMultipleRanges: SelectedFileWithLines = {
      path: '/project/src/complex-file.js',
      isFullFile: false,
      lines: [
        { start: 1, end: 5 },
        { start: 10, end: 15 },
        { start: 20, end: 22 }
      ],
      tokenCount: 45,
      isContentLoaded: true,
    };

    renderWithProviders(
      <LineRangeDisplay file={selectedWithMultipleRanges} />
    );

    expect(screen.getByTestId('file-path')).toHaveTextContent('/project/src/complex-file.js');
    expect(screen.getByTestId('line-count')).toHaveTextContent('3 ranges');
    expect(screen.getByTestId('range-0')).toHaveTextContent('Lines 1-5');
    expect(screen.getByTestId('range-1')).toHaveTextContent('Lines 10-15');
    expect(screen.getByTestId('range-2')).toHaveTextContent('Lines 20-22');
  });
});

describe('Toggle Selection Integration with Workspace', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    jest.clearAllMocks();
  });

  // Realistic test data with multiple files
  const createTestFiles = (): FileData[] => [
    {
      name: 'api-handler.js',
      path: '/project/src/api-handler.js',
      isDirectory: false,
      content: 'export async function handleRequest(req, res) {\n  const data = await fetchData(req.params.id);\n  res.json(data);\n}',
      size: 150,
      tokenCount: 25,
      isBinary: false,
      isSkipped: false,
      isContentLoaded: true,
    },
    {
      name: 'user-service.js',
      path: '/project/src/user-service.js',
      isDirectory: false,
      content: 'class UserService {\n  async getUser(id) {\n    return db.users.find(id);\n  }\n}\nexport default UserService;',
      size: 200,
      tokenCount: 30,
      isBinary: false,
      isSkipped: false,
      isContentLoaded: true,
    },
  ];

  it('should persist selection state across localStorage operations', async () => {
    const testFiles = createTestFiles();
    
    const { unmount } = renderWithProviders(
      <FileSelectionTestComponent 
        allFiles={testFiles}
      />
    );
    
    // Select files
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-api-handler.js'));
      fireEvent.click(screen.getByTestId('select-user-service.js'));
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('selected-files-count')).toHaveTextContent('2');
    });
    
    // Verify selection state was persisted to localStorage
    const savedSelection = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.SELECTED_FILES) || '[]'
    );
    expect(savedSelection).toHaveLength(2);
    expect(savedSelection[0].path).toBe('/project/src/api-handler.js');
    expect(savedSelection[1].path).toBe('/project/src/user-service.js');
    
    // Unmount and remount to simulate app restart
    unmount();
    
    renderWithProviders(
      <FileSelectionTestComponent allFiles={testFiles} />
    );
    
    // Selection should be restored from localStorage
    await waitFor(() => {
      expect(screen.getByTestId('selected-files-count')).toHaveTextContent('2');
      expect(screen.getByTestId('total-tokens')).toHaveTextContent('55'); // 25 + 30
    });
  });
}); 