import { WorkspaceState, SelectedFileWithLines, LineRange , 
  LineSelectionValidationResult, 
  FileData,
  LineSelectionChangeEvent,
  ValidationSummary
} from '../types/file-types';

export const serializeWorkspace = (state: WorkspaceState): string => {
  // Create a deep copy to ensure nested objects are properly serialized
  const workspaceCopy = {
    ...state,
    selectedFiles: state.selectedFiles.map(file => ({
      ...file,
      lines: file.lines ? [...file.lines] : undefined
    }))
  };
  return JSON.stringify(workspaceCopy);
};

export const deserializeWorkspace = (data: string): WorkspaceState => {
  const parsed = JSON.parse(data);
  
  // Ensure line ranges are properly reconstructed
  const workspaceState: WorkspaceState = {
    ...parsed,
    selectedFiles: parsed.selectedFiles.map((file: SelectedFileWithLines) => ({
      ...file,
      lines: file.lines?.map((range: LineRange) => ({
        start: range.start,
        end: range.end
      }))
    }))
  };
  
  return workspaceState;
};

export function validateLineSelections(
  fileContent: string | undefined,
  selectedFile: SelectedFileWithLines
): LineSelectionValidationResult {
  if (!fileContent) {
    return {
      isValid: true,
      validatedLines: selectedFile.lines,
      removedLines: [],
      contentAvailable: false
    };
  }

  if (!selectedFile.lines || selectedFile.isFullFile) {
    return {
      isValid: true,
      validatedLines: selectedFile.lines,
      removedLines: [],
      contentAvailable: true
    };
  }

  const totalLines = fileContent.split('\n').length;
  const validatedLines: LineRange[] = [];
  const removedLines: LineRange[] = [];

  for (const range of selectedFile.lines) {
    if (range.start <= 0 || range.end > totalLines || range.start > range.end) {
      removedLines.push(range);
    } else {
      validatedLines.push(range);
    }
  }

  return {
    isValid: removedLines.length === 0,
    validatedLines: validatedLines.length > 0 ? validatedLines : undefined,
    removedLines,
    contentAvailable: true
  };
}

export function extractContentForLines(
  fileContent: string,
  lines: LineRange[]
): string {
  const contentLines = fileContent.split('\n');
  const selectedContent: string[] = [];
  
  for (const range of lines) {
    for (let i = range.start - 1; i < range.end; i++) {
      if (i >= 0 && i < contentLines.length) {
        selectedContent.push(contentLines[i]);
      }
    }
  }
  
  return selectedContent.join('\n');
}

export function validateWorkspaceSelections(
  workspaceData: WorkspaceState,
  allFiles: FileData[]
): {
  validatedWorkspace: WorkspaceState;
  changes: LineSelectionChangeEvent[];
  summary: ValidationSummary;
} {
  const changes: LineSelectionChangeEvent[] = [];
  const summary: ValidationSummary = {
    validatedFiles: [],
    skippedFiles: [],
    deletedFiles: [],
    renamedFiles: []
  };

  
  const validatedFiles = workspaceData.selectedFiles.map(selectedFile => {
    const fileData = allFiles.find(f => f.path === selectedFile.path);
    
    if (!fileData) {
      summary.deletedFiles.push(selectedFile.path);
      changes.push({
        filePath: selectedFile.path,
        previousLines: selectedFile.lines,
        currentLines: undefined,
        removedLines: selectedFile.lines || [],
        reason: 'File no longer exists in workspace'
      });
      return null;
    }

    if (!fileData.content) {
      summary.skippedFiles.push(selectedFile.path);
      changes.push({
        filePath: selectedFile.path,
        previousLines: selectedFile.lines,
        currentLines: selectedFile.lines,
        removedLines: [],
        validationSkipped: true,
        reason: 'File content not available'
      });
      return selectedFile;
    }

    const validation = validateLineSelections(fileData.content, selectedFile);
    
    if (!validation.isValid) {
      changes.push({
        filePath: selectedFile.path,
        previousLines: selectedFile.lines,
        currentLines: validation.validatedLines,
        removedLines: validation.removedLines
      });
    }

    summary.validatedFiles.push(selectedFile.path);

    return {
      ...selectedFile,
      lines: validation.validatedLines,
      content: validation.validatedLines 
        ? extractContentForLines(fileData.content, validation.validatedLines)
        : fileData.content,
      tokenCount: calculateTokenCount(fileData.content)
    };
  }).filter(Boolean) as SelectedFileWithLines[];

  return {
    validatedWorkspace: {
      ...workspaceData,
      selectedFiles: validatedFiles
    },
    changes,
    summary
  };
}

// Helper function to calculate token count (implement based on your tokenization needs)
function calculateTokenCount(content: string): number {
  // Implement your token counting logic here
  // This is a simple example - replace with your actual tokenization logic
  return content.split(/\s+/).length;
}

export function generateUniqueWorkspaceName(existingNames: string[], basePath?: string): string {
  // If basePath is provided, extract the folder name
  const baseWorkspaceName = basePath 
    ? basePath.split(/[/\\]/).pop() || 'Untitled'
    : 'Untitled';
  
  // If the base name doesn't exist, use it
  if (!existingNames.includes(baseWorkspaceName)) {
    return baseWorkspaceName;
  }
  
  // Otherwise, append a number to make it unique
  let counter = 2;
  let candidateName = `${baseWorkspaceName} ${counter}`;
  
  while (existingNames.includes(candidateName)) {
    counter++;
    candidateName = `${baseWorkspaceName} ${counter}`;
  }
  
  return candidateName;
}