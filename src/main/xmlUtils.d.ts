// Type definitions for xmlUtils module
export interface FileChange {
  file_summary: string;
  file_operation: string;
  file_path: string;
  file_code?: string;
}

export function parseXmlString(xmlString: string): Promise<FileChange[]>;
export function applyFileChanges(change: FileChange, projectDirectory: string): Promise<void>;
export function prepareXmlWithCdata(xmlString: string): string;
