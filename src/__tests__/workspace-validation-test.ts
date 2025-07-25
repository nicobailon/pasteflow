import { 
  validateLineSelections, 
  extractContentForLines,
  validateWorkspaceSelections 
} from '../utils/workspace-utils';
import { 
  LineRange,
  SelectedFileWithLines,
  FileData,
  WorkspaceState,
  FileTreeMode 
} from '../types/file-types';

describe('Line Selection Validation', () => {
  const mockFileContent = 'line1\nline2\nline3\nline4\nline5';
  
  test('validates line selections within bounds', () => {
    const selectedFile: SelectedFileWithLines = {
      path: 'test.txt',
      lines: [{ start: 1, end: 3 }]
    };

    const result = validateLineSelections(mockFileContent, selectedFile);
    expect(result.isValid).toBe(true);
    expect(result.validatedLines).toEqual([{ start: 1, end: 3 }]);
    expect(result.removedLines).toEqual([]);
  });

  test('identifies invalid line selections', () => {
    const selectedFile: SelectedFileWithLines = {
      path: 'test.txt',
      lines: [
        { start: 1, end: 3 },
        { start: 4, end: 10 } // Invalid - beyond file length
      ]
    };

    const result = validateLineSelections(mockFileContent, selectedFile);
    expect(result.isValid).toBe(false);
    expect(result.validatedLines).toEqual([{ start: 1, end: 3 }]);
    expect(result.removedLines).toEqual([{ start: 4, end: 10 }]);
  });

  test('handles undefined file content', () => {
    const selectedFile: SelectedFileWithLines = {
      path: 'test.txt',
      lines: [{ start: 1, end: 3 }]
    };

    const result = validateLineSelections(undefined, selectedFile);
    expect(result.isValid).toBe(true);
    expect(result.contentAvailable).toBe(false);
  });
});

describe('Content Extraction', () => {
  const mockFileContent = 'line1\nline2\nline3\nline4\nline5';

  test('extracts content for valid line ranges', () => {
    const lines: LineRange[] = [{ start: 1, end: 3 }];
    const content = extractContentForLines(mockFileContent, lines);
    expect(content).toBe('line1\nline2\nline3');
  });

  test('handles multiple line ranges', () => {
    const lines: LineRange[] = [
      { start: 1, end: 2 },
      { start: 4, end: 5 }
    ];
    const content = extractContentForLines(mockFileContent, lines);
    expect(content).toBe('line1\nline2\nline4\nline5');
  });
});

describe('Workspace Validation', () => {
  const mockFiles: FileData[] = [
    { 
      name: 'file1.txt',
      path: 'file1.txt',
      content: 'line1\nline2\nline3',
      isDirectory: false,
      size: 100,
      isBinary: false,
      isSkipped: false,
      fileType: 'text'
    },
    { 
      name: 'file2.txt',
      path: 'file2.txt',
      content: 'line1\nline2',
      isDirectory: false,
      size: 100,
      isBinary: false,
      isSkipped: false,
      fileType: 'text'
    }
  ];

  const mockWorkspace: WorkspaceState = {
    selectedFiles: [
      {
        path: 'file1.txt',
        lines: [{ start: 1, end: 2 }]
      },
      {
        path: 'deleted.txt',
        lines: [{ start: 1, end: 2 }]
      }
    ],
    selectedFolder: null,
    allFiles: mockFiles,
    expandedNodes: {},
    sortOrder: 'name',
    searchTerm: '',
    fileTreeMode: 'selected' as FileTreeMode,
    exclusionPatterns: [],
    userInstructions: '',
    tokenCounts: {},
    customPrompts: {
      systemPrompts: [],
      rolePrompts: []
    },
    savedAt: new Date().getTime()
  };

  test('validates workspace selections', () => {
    const { validatedWorkspace, changes, summary } = validateWorkspaceSelections(mockWorkspace, mockFiles);

    expect(validatedWorkspace.selectedFiles.length).toBe(1);
    expect(summary.deletedFiles).toContain('deleted.txt');
    expect(changes.length).toBe(1);
    expect(changes[0].filePath).toBe('deleted.txt');
    expect(summary.validatedFiles).toContain('file1.txt');
  });
}); 