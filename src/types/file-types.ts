import type * as React from 'react';

// Import and re-export domain types from shared module
import type { FileData, LineRange, SelectedFileReference, SystemPrompt, RolePrompt, Instruction, FileTreeMode, WorkspaceState } from "../shared-types";

// Re-export for consumers of this module
export type { FileData, LineRange, SelectedFileReference, SystemPrompt, RolePrompt, Instruction, FileTreeMode, WorkspaceState };

// Forward declaration of DirectorySelectionCache interface
// The actual implementation is in utils/selection-cache.ts (renderer-only)
export interface DirectorySelectionCache {
  get(path: string): 'full' | 'partial' | 'none';
  set(path: string, state: 'full' | 'partial' | 'none'): void;
  bulkUpdate(updates: Map<string, 'full' | 'partial' | 'none'>): void;
  clear(): void;
  isComputing?(): boolean;
  getProgress?(): number;
  startProgressiveRecompute?(opts: {
    selectedPaths: Set<string>;
    priorityPaths?: readonly string[];
    batchSize?: number;
  }): { cancel: () => void };
  cancel?(): void;
  setSelectedPaths?(paths: Set<string>): void;
}


// New interface for selected files with line ranges
export interface SelectedFileWithLines {
  path: string;
  lines?: LineRange[];       // Undefined or empty array means entire file
  content?: string;          // Cached content of selected lines
  tokenCount?: number;       // Pre-computed token count for selected content
  isFullFile?: boolean;      // Explicit flag indicating if the whole file is selected
  isContentLoaded?: boolean; // Flag indicating if content has been loaded
  error?: string;           // Error message if loading failed
  isCountingTokens?: boolean; // Flag indicating if tokens are being counted
  tokenCountError?: string;  // Error message if token counting failed
}


export interface TreeNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  isExpanded?: boolean;
  level: number;
  fileData?: FileData;
}

export interface SidebarProps {
  selectedFolder: string | null;
  openFolder: () => void;
  allFiles: FileData[];
  selectedFiles: SelectedFileReference[]; // Updated type
  toggleFileSelection: (filePath: string) => void;
  toggleFolderSelection: (folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  expandedNodes: Record<string, boolean>;
  toggleExpanded: (path: string) => void;
  resetFolderState?: () => void;
  onFileTreeSortChange?: (sortOrder: string) => void;
  toggleFilterModal?: () => void;
  refreshFileTree?: () => void;
  onViewFile?: (filePath: string) => void; // New prop
  folderSelectionCache?: DirectorySelectionCache;
  processingStatus?: {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
    processed?: number;
    directories?: number;
    total?: number;
  };
  loadFileContent?: (filePath: string) => Promise<void>; // Add loadFileContent property
}

export interface FileListProps {
  files: FileData[];
  selectedFiles: SelectedFileReference[]; // Updated type
  toggleFileSelection: (filePath: string) => void;
  toggleSelection?: (filePath: string, lineRange?: LineRange) => void;
  openFolder: () => void;
  onViewFile?: (filePath: string) => void; // New prop
  processingStatus: {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
  };
  folderSelectionCache?: DirectorySelectionCache;
  selectedSystemPrompts?: SystemPrompt[];
  toggleSystemPromptSelection?: (prompt: SystemPrompt) => void;
  onViewSystemPrompt?: (prompt: SystemPrompt) => void;
  selectedRolePrompts?: RolePrompt[];
  toggleRolePromptSelection?: (prompt: RolePrompt) => void;
  onViewRolePrompt?: (prompt: RolePrompt) => void;
  selectedInstructions?: Instruction[];
  toggleInstructionSelection?: (instruction: Instruction) => void;
  onViewInstruction?: (instruction: Instruction) => void;
  loadFileContent: (filePath: string) => Promise<void>; // Added loadFileContent property
  toggleFolderSelection?: (folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }) => void; // New: folder toggling for folder cards
}

export interface FileCardProps {
  file: FileData;
  selectedFile: SelectedFileWithLines | undefined; // Updated type
  toggleSelection: (filePath: string, lineRange?: LineRange) => void;
  onViewFile?: (filePath: string) => void; // New prop
  loadFileContent: (filePath: string) => Promise<void>; // Added loadFileContent property
}

export interface TreeItemProps {
  node: TreeNode;
  selectedFiles: SelectedFileReference[]; // Updated type
  selectedFilesLookup?: Map<string, SelectedFileReference>; // O(1) lookup for selection state
  toggleFileSelection: (filePath: string) => void;
  toggleFolderSelection: (folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }) => void;
  toggleExpanded: (path: string, currentState?: boolean) => void;
  expandedNodes?: Record<string, boolean>;
  onViewFile?: (filePath: string) => void; // New prop
  loadFileContent?: (filePath: string) => Promise<void>; // Add loadFileContent property
  folderSelectionCache?: DirectorySelectionCache;
}

export interface SortOption {
  value: string;
  label: string;
}

export interface SearchBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
}

export interface CopyButtonProps {
  text: string | (() => string);
  className?: string;
  children?: React.ReactNode;
}


export interface FilterModalProps {
  exclusionPatterns: string[];
  onSave: (patterns: string[]) => void;
  onClose: () => void;
}

export interface XmlApplyTabProps {
  selectedFolder: string;
}

export interface FileChange {
  summary: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  path: string;
  code?: string;
}

// New interface for file view modal
export interface FileViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  allFiles: FileData[];
  selectedFile: SelectedFileWithLines | undefined;
  onUpdateSelectedFile: (path: string, lines?: LineRange[]) => void;
  loadFileContent: (filePath: string) => Promise<void>;
}


export interface SystemPromptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompts: SystemPrompt[];
  onAddPrompt: (prompt: SystemPrompt) => void;
  onDeletePrompt: (id: string) => void;
  onUpdatePrompt: (prompt: SystemPrompt) => void;
  onSelectPrompt: (prompt: SystemPrompt) => void;
  selectedSystemPrompts?: SystemPrompt[];
  toggleSystemPromptSelection: (prompt: SystemPrompt) => void;
  initialEditPrompt?: SystemPrompt | null;
}

export interface RolePromptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rolePrompts: RolePrompt[];
  onAddPrompt: (prompt: RolePrompt) => void;
  onDeletePrompt: (id: string) => void;
  onUpdatePrompt: (prompt: RolePrompt) => void;
  onSelectPrompt: (prompt: RolePrompt) => void;
  selectedRolePrompts?: RolePrompt[];
  toggleRolePromptSelection: (prompt: RolePrompt) => void;
  initialEditPrompt?: RolePrompt | null;
}

// If these types don't exist, add them:

export interface Doc {
  id: string;
  name: string;
  content: string;
  tokenCount?: number;
}


export interface InstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  instructions: Instruction[];
  onAddInstruction: (instruction: Instruction) => Promise<void>;
  onDeleteInstruction: (id: string) => Promise<void>;
  onUpdateInstruction: (instruction: Instruction) => Promise<void>;
  selectedInstructions: Instruction[];
  toggleInstructionSelection: (instruction: Instruction) => void;
  initialEditInstruction?: Instruction | null;
}


export interface LineSelectionValidationResult {
  isValid: boolean;
  validatedLines: LineRange[] | undefined;
  removedLines: LineRange[];
  reason?: string;
  contentAvailable: boolean;
}

export interface LineSelectionChangeEvent {
  filePath: string;
  previousLines: LineRange[] | undefined;
  currentLines: LineRange[] | undefined;
  removedLines: LineRange[];
  validationSkipped?: boolean;
  reason?: string;
}

export interface ValidationSummary {
  validatedFiles: string[];
  skippedFiles: string[];
  deletedFiles: string[];
  renamedFiles: string[];
}

export interface NotificationConfig {
  type: 'warning' | 'error' | 'info' | 'success';
  title: string;
  message: string;
  details?: {
    summary: {
      totalFiles: number;
      totalRemovedLines: number;
      validatedFiles: string[];
      skippedFiles: string[];
      deletedFiles: string[];
      renamedFiles: string[];
    };
    changes: {
      file: string;
      removedLines: LineRange[];
      status: 'pending' | 'validated';
      reason?: string;
    }[];
  };
}
