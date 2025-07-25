import { 
  validateLineSelections,
  validateWorkspaceSelections
} from '../utils/workspace-utils';
import { processFileContent } from '../utils/content-formatter';
import { createLineSelectionChangeNotification } from '../utils/notification-utils';
import { 
  FileData,
  WorkspaceState,
  LineSelectionValidationResult,
  LineSelectionChangeEvent,
  ValidationSummary,
  FileTreeMode 
} from '../types/file-types';

describe('Workspace Line Selection Integration', () => {
  // Mock data setup
  const mockFiles: FileData[] = [
    { 
      name: 'file1.txt',
      path: 'file1.txt',
      content: 'line1\nline2\nline3\nline4\nline5',
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
      size: 50,
      isBinary: false,
      isSkipped: false,
      fileType: 'text'
    }
  ];

  const mockWorkspace: WorkspaceState = {
    selectedFiles: [
      {
        path: 'file1.txt',
        lines: [{ start: 1, end: 3 }, { start: 4, end: 10 }] // Second range is invalid
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

  test('complete workflow from workspace loading to notification', () => {
    // Step 1: Validate workspace selections
    const { validatedWorkspace, changes, summary } = validateWorkspaceSelections(mockWorkspace, mockFiles);

    // Verify workspace validation results
    expect(validatedWorkspace.selectedFiles.length).toBe(1);
    expect(validatedWorkspace.selectedFiles[0].path).toBe('file1.txt');
    expect(validatedWorkspace.selectedFiles[0].lines?.length).toBe(1);
    expect(summary.deletedFiles).toContain('deleted.txt');

    // Step 2: Process content for validated files
    const originalFile = mockWorkspace.selectedFiles[0];
    const fileData = mockFiles.find(f => f.path === originalFile.path);
    
    const validationResults: LineSelectionValidationResult[] = [];
    const validationCallback = (result: LineSelectionValidationResult) => {
      validationResults.push(result);
    };

    const { content, partial } = processFileContent(
      fileData?.content,
      originalFile,
      validationCallback
    );

    // Verify content processing
    expect(partial).toBe(true);
    expect(content).toBe('line1\nline2\nline3');
    expect(validationResults.length).toBe(1);
    expect(validationResults[0].removedLines).toEqual([{ start: 4, end: 10 }]);

    // Step 3: Create notification
    const notification = createLineSelectionChangeNotification(changes, summary);

    // Verify notification
    expect(notification.type).toBe('warning');
    expect(notification.message).toContain('1 file(s) no longer exist');
    expect(notification.message).toContain('1 file(s) had invalid selections removed');
    expect(notification.details?.summary.totalFiles).toBe(2);
    expect(notification.details?.changes.length).toBe(2);
  });

  test('real-time content changes and validation', () => {
    const selectedFile = mockWorkspace.selectedFiles[0];
    const originalContent = mockFiles[0].content;
    const updatedContent = 'line1\nline2\nline3'; // Simulating file content change

    // Initial validation
    const initialValidation = validateLineSelections(originalContent, selectedFile);
    expect(initialValidation.isValid).toBe(false);
    expect(initialValidation.removedLines).toEqual([{ start: 4, end: 10 }]);

    // Validation after content change
    const updatedValidation = validateLineSelections(updatedContent, selectedFile);
    expect(updatedValidation.isValid).toBe(false);
    expect(updatedValidation.removedLines).toEqual([{ start: 4, end: 10 }]);

    // Process content with validation callback
    const validationResults: LineSelectionValidationResult[] = [];
    const validationCallback = (result: LineSelectionValidationResult) => {
      validationResults.push(result);
    };

    const { content, partial } = processFileContent(
      updatedContent,
      selectedFile,
      validationCallback
    );

    expect(partial).toBe(true);
    expect(content).toBe('line1\nline2\nline3');
    expect(validationResults.length).toBe(1);
    expect(validationResults[0].removedLines).toEqual([{ start: 4, end: 10 }]);
  });

  test('notification system integration', () => {
    // Simulate multiple types of changes
    const changes: LineSelectionChangeEvent[] = [
      {
        filePath: 'file1.txt',
        previousLines: [{ start: 1, end: 3 }, { start: 4, end: 10 }],
        currentLines: [{ start: 1, end: 3 }],
        removedLines: [{ start: 4, end: 10 }]
      },
      {
        filePath: 'deleted.txt',
        previousLines: [{ start: 1, end: 2 }],
        currentLines: undefined,
        removedLines: [{ start: 1, end: 2 }],
        reason: 'File no longer exists in workspace'
      },
      {
        filePath: 'pending.txt',
        previousLines: [{ start: 1, end: 2 }],
        currentLines: [{ start: 1, end: 2 }],
        removedLines: [],
        validationSkipped: true,
        reason: 'File content not available'
      }
    ];

    const summary: ValidationSummary = {
      validatedFiles: ['file1.txt'],
      skippedFiles: ['pending.txt'],
      deletedFiles: ['deleted.txt'],
      renamedFiles: []
    };

    const notification = createLineSelectionChangeNotification(changes, summary);

    // Verify comprehensive notification
    expect(notification.type).toBe('warning');
    expect(notification.message).toContain('1 file(s) no longer exist');
    expect(notification.message).toContain('1 file(s) pending validation');
    expect(notification.message).toContain('1 file(s) had invalid selections removed');
    expect(notification.details?.summary.totalFiles).toBe(3);
    expect(notification.details?.changes.length).toBe(3);

    // Verify change details
    const changeDetails = notification.details?.changes;
    expect(changeDetails?.find(c => c.file === 'file1.txt')?.status).toBe('validated');
    expect(changeDetails?.find(c => c.file === 'deleted.txt')?.status).toBe('validated');
    expect(changeDetails?.find(c => c.file === 'pending.txt')?.status).toBe('pending');
  });
}); 