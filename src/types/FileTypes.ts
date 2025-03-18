export interface FileData {
  name: string;
  path: string;
  content: string;
  tokenCount: number;
  size: number;
  isBinary: boolean;
  isSkipped: boolean;
  error?: string;
  fileType?: string;
  excludedByDefault?: boolean;
}

// New interface for selected line ranges
export interface LineRange {
  start: number;
  end: number;
}

// New interface for selected files with line ranges
export interface SelectedFileWithLines {
  path: string;
  lines?: LineRange[];  // Undefined or empty array means entire file
  content?: string;     // Cached content of selected lines
  tokenCount?: number;  // Pre-computed token count for selected content
  isFullFile?: boolean; // Explicit flag indicating if the whole file is selected
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
  selectedFiles: SelectedFileWithLines[]; // Updated type
  toggleFileSelection: (filePath: string) => void;
  toggleFolderSelection: (folderPath: string, isSelected: boolean) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  expandedNodes: Record<string, boolean>;
  toggleExpanded: (nodeId: string) => void;
  resetFolderState?: () => void;
  onFileTreeSortChange?: (sortOrder: string) => void;
  toggleFilterModal?: () => void;
  refreshFileTree?: () => void;
  onViewFile?: (filePath: string) => void; // New prop
  processingStatus?: {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
    processed?: number;
    directories?: number;
    total?: number;
  };
}

export interface FileListProps {
  files: FileData[];
  selectedFiles: SelectedFileWithLines[]; // Updated type
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
  selectedRolePrompts?: RolePrompt[];
  toggleRolePromptSelection?: (prompt: RolePrompt) => void;
}

export interface FileCardProps {
  file: FileData;
  selectedFile: SelectedFileWithLines | undefined; // Updated type
  toggleSelection: (filePath: string, lineRange?: LineRange) => void;
  onViewFile?: (filePath: string) => void; // New prop
}

export interface TreeItemProps {
  node: TreeNode;
  selectedFiles: SelectedFileWithLines[]; // Updated type
  toggleFileSelection: (filePath: string) => void;
  toggleFolderSelection: (folderPath: string, isSelected: boolean) => void;
  toggleExpanded: (nodeId: string) => void;
  expandedNodes?: Record<string, boolean>;
  onViewFile?: (filePath: string) => void; // New prop
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
  onUpdateSelectedFile: (selectedFile: SelectedFileWithLines) => void;
}

// Interface for system prompts
export interface SystemPrompt {
  id: string;
  title: string;
  content: string;
}

// Interface for role prompts
export interface RolePrompt {
  id: string;
  title: string;
  content: string;
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
}

// If these types don't exist, add them:

export interface Doc {
  id: string;
  title: string;
  content: string;
}

export interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  docs: Doc[];
  onAddDoc: (doc: Doc) => void;
  onDeleteDoc: (id: string) => void;
  onUpdateDoc: (doc: Doc) => void;
  onSelectDoc: (doc: Doc) => void;
  selectedDocs: Doc[];
  toggleDocSelection: (doc: Doc) => void;
}