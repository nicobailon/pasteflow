import { WorkspaceState, SelectedFileWithLines, LineRange } from '../types/file-types';

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