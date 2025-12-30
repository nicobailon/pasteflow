export type FileTreeMode = "none" | "selected" | "selected-with-roots" | "complete";

import type { SelectedFileReference } from "./selection";
import type { Instruction } from "./prompts";

export interface WorkspaceState {
  selectedFolder: string | null;
  selectedFiles: SelectedFileReference[];
  expandedNodes: Record<string, boolean>;
  sortOrder: string;
  searchTerm: string;
  fileTreeMode: FileTreeMode;
  exclusionPatterns: string[];
  userInstructions: string;
  tokenCounts: { [filePath: string]: number };
  folderIndex?: Map<string, string[]>;
  selectedSystemPromptIds?: string[];
  selectedRolePromptIds?: string[];
  selectedInstructions?: Instruction[];
  savedAt?: number;
}