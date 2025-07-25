import { 
  LineSelectionChangeEvent, 
  ValidationSummary,
  NotificationConfig 
} from '../types/file-types';

export function createLineSelectionChangeNotification(
  changes: LineSelectionChangeEvent[],
  summary: ValidationSummary
): NotificationConfig {
  const affectedFiles = changes.length;
  const totalRemovedLines = changes.reduce(
    (sum, change) => sum + change.removedLines.length,
    0
  );

  const messageParts = [];
  
  if (summary.deletedFiles.length > 0) {
    messageParts.push(`${summary.deletedFiles.length} file(s) no longer exist`);
  }
  
  if (summary.skippedFiles.length > 0) {
    messageParts.push(`${summary.skippedFiles.length} file(s) pending validation`);
  }

  const validatedWithChanges = changes.filter(c => 
    !c.validationSkipped && 
    c.removedLines.length > 0 && 
    !summary.deletedFiles.includes(c.filePath)
  );
  if (validatedWithChanges.length > 0) {
    messageParts.push(`${validatedWithChanges.length} file(s) had invalid selections removed`);
  }

  return {
    type: 'warning',
    title: 'Workspace Line Selections Updated',
    message: messageParts.join(', '),
    details: {
      summary: {
        totalFiles: affectedFiles,
        totalRemovedLines,
        ...summary
      },
      changes: changes.map(change => ({
        file: change.filePath,
        removedLines: change.removedLines,
        status: change.validationSkipped ? 'pending' : 'validated',
        reason: change.reason
      }))
    }
  };
} 