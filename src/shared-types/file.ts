export interface FileData {
  name: string;
  path: string;
  isDirectory: boolean;
  isContentLoaded?: boolean;
  tokenCount?: number;
  children?: FileData[];
  content?: string;
  size: number;
  mtimeMs?: number;
  isBinary: boolean;
  isSkipped: boolean;
  error?: string;
  fileType?: string;
  excludedByDefault?: boolean;
  isCountingTokens?: boolean;
  tokenCountError?: string;
}

export interface LineRange { start: number; end: number }