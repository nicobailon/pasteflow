import { createLineSelectionChangeNotification } from '../utils/notification-utils';
import { 
  LineSelectionChangeEvent,
  ValidationSummary,
  LineRange 
} from '../types/file-types';

describe('Line Selection Change Notifications', () => {
  const mockLineRange: LineRange = { start: 1, end: 3 };
  
  test('creates notification for deleted files', () => {
    const changes: LineSelectionChangeEvent[] = [
      {
        filePath: 'deleted.txt',
        previousLines: [mockLineRange],
        currentLines: undefined,
        removedLines: [mockLineRange],
        reason: 'File no longer exists in workspace'
      }
    ];

    const summary: ValidationSummary = {
      validatedFiles: [],
      skippedFiles: [],
      deletedFiles: ['deleted.txt'],
      renamedFiles: []
    };

    const notification = createLineSelectionChangeNotification(changes, summary);
    
    expect(notification.type).toBe('warning');
    expect(notification.title).toBe('Workspace Line Selections Updated');
    expect(notification.message).toContain('1 file(s) no longer exist');
    expect(notification.details?.summary.totalFiles).toBe(1);
    expect(notification.details?.summary.totalRemovedLines).toBe(1);
    expect(notification.details?.changes[0].file).toBe('deleted.txt');
    expect(notification.details?.changes[0].status).toBe('validated');
  });

  test('creates notification for skipped files', () => {
    const changes: LineSelectionChangeEvent[] = [
      {
        filePath: 'pending.txt',
        previousLines: [mockLineRange],
        currentLines: [mockLineRange],
        removedLines: [],
        validationSkipped: true,
        reason: 'File content not available'
      }
    ];

    const summary: ValidationSummary = {
      validatedFiles: [],
      skippedFiles: ['pending.txt'],
      deletedFiles: [],
      renamedFiles: []
    };

    const notification = createLineSelectionChangeNotification(changes, summary);
    
    expect(notification.message).toContain('1 file(s) pending validation');
    expect(notification.details?.changes[0].status).toBe('pending');
  });

  test('creates notification for invalid selections', () => {
    const changes: LineSelectionChangeEvent[] = [
      {
        filePath: 'file.txt',
        previousLines: [mockLineRange, { start: 10, end: 20 }],
        currentLines: [mockLineRange],
        removedLines: [{ start: 10, end: 20 }]
      }
    ];

    const summary: ValidationSummary = {
      validatedFiles: ['file.txt'],
      skippedFiles: [],
      deletedFiles: [],
      renamedFiles: []
    };

    const notification = createLineSelectionChangeNotification(changes, summary);
    
    expect(notification.message).toContain('1 file(s) had invalid selections removed');
    expect(notification.details?.changes[0].removedLines).toEqual([{ start: 10, end: 20 }]);
  });

  test('combines multiple change types', () => {
    const changes: LineSelectionChangeEvent[] = [
      {
        filePath: 'deleted.txt',
        previousLines: [mockLineRange],
        currentLines: undefined,
        removedLines: [mockLineRange],
        reason: 'File no longer exists in workspace'
      },
      {
        filePath: 'pending.txt',
        previousLines: [mockLineRange],
        currentLines: [mockLineRange],
        removedLines: [],
        validationSkipped: true,
        reason: 'File content not available'
      },
      {
        filePath: 'file.txt',
        previousLines: [mockLineRange, { start: 10, end: 20 }],
        currentLines: [mockLineRange],
        removedLines: [{ start: 10, end: 20 }]
      }
    ];

    const summary: ValidationSummary = {
      validatedFiles: ['file.txt'],
      skippedFiles: ['pending.txt'],
      deletedFiles: ['deleted.txt'],
      renamedFiles: []
    };

    const notification = createLineSelectionChangeNotification(changes, summary);
    
    expect(notification.message).toContain('1 file(s) no longer exist');
    expect(notification.message).toContain('1 file(s) pending validation');
    expect(notification.message).toContain('1 file(s) had invalid selections removed');
    expect(notification.details?.summary.totalFiles).toBe(3);
    expect(notification.details?.changes.length).toBe(3);
  });
}); 