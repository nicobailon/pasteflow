/**
 * Core interface representing a file or directory in the workspace.
 * 
 * This is the authoritative data structure for all file information in the
 * single-source-of-truth architecture. The `allFiles` array in the app state
 * contains all FileData objects, and this is the only place where file content,
 * metadata, and token counts are stored.
 * 
 * Components should never duplicate this data. Instead, they should:
 * 1. Use `SelectedFileReference` to track which files are selected
 * 2. Look up the actual file data from `allFiles` when needed
 * 3. Derive display data at render time by combining the reference with the source data
 * 
 * This pattern ensures consistency and prevents the state synchronization issues
 * that can cause UI flicker or stale data display.
 */
export interface FileData {
  name: string;
  path: string;
  isDirectory: boolean;
  isContentLoaded?: boolean;
  tokenCount?: number;
  children?: FileData[];
  content?: string;
  size: number;
  /** File modification time in milliseconds (from fs.stat.mtimeMs) */
  mtimeMs?: number;
  isBinary: boolean;
  isSkipped: boolean;
  error?: string;
  fileType?: string;
  excludedByDefault?: boolean;
  isCountingTokens?: boolean;
  tokenCountError?: string;
}

// New interface for selected line ranges
export interface LineRange {
  start: number;
  end: number;
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

/**
 * Simplified interface for selected files following the single-source-of-truth pattern.
 * 
 * This interface only stores the minimal reference information needed to identify
 * which files (and optionally which line ranges) are selected. The actual file
 * content, metadata, and token counts are always retrieved from the `allFiles`
 * array in the app state, ensuring there's only one authoritative source for
 * file data.
 * 
 * This design prevents state desynchronization issues that previously caused
 * content flicker when switching between files.
 * 
 * @example
 * // Full file selection
 * { path: '/src/index.ts' }
 * 
 * @example
 * // Partial file selection with line ranges
 * { path: '/src/utils.ts', lines: [{ start: 10, end: 20 }, { start: 30, end: 40 }] }
 */
export interface SelectedFileReference {
  path: string;
  lines?: LineRange[];       // Undefined or empty array means entire file
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
  folderSelectionCache?: import('../utils/selection-cache').DirectorySelectionCache; // Cache for instant folder selection UI updates
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
  folderSelectionCache?: import('../utils/selection-cache').DirectorySelectionCache; // Cache for instant folder selection UI updates
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
  children?: JSX.Element | string;
}

export type FileTreeMode = "none" | "selected" | "selected-with-roots" | "complete";

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

// Interface for system prompts
export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  tokenCount?: number;
}

// Interface for role prompts
export interface RolePrompt {
  id: string;
  name: string;
  content: string;
  tokenCount?: number;
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

export interface Instruction {
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
  folderIndex?: Map<string, string[]>; // Optional for backward compatibility
  systemPrompts: SystemPrompt[];
  rolePrompts: RolePrompt[];
  // instructions are now stored in database, not in workspace
  selectedInstructions?: Instruction[]; // Optional for backward compatibility
  savedAt?: number; // Added timestamp for sorting
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
