import type {
  FileData,
  SelectedFileReference,
  WorkspaceState,
  Instruction,
  SystemPrompt,
  RolePrompt,
} from "../types/file-types";

export function dedupeSelectedFiles(selected: SelectedFileReference[]): SelectedFileReference[] {
  return [...new Map(selected.map((f) => [f.path, f])).values()];
}

export function buildTokenCountsForSelectedFiles(
  allFiles: FileData[],
  selected: SelectedFileReference[]
): { [filePath: string]: number } {
  const map = new Map(allFiles.map((f) => [f.path, f] as const));
  const acc: { [filePath: string]: number } = {};
  for (const s of selected) {
    acc[s.path] = map.get(s.path)?.tokenCount ?? 0;
  }
  return acc;
}

export function buildWorkspaceState(params: {
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  allFiles: FileData[];
  selectedFiles: SelectedFileReference[];
  sortOrder: string;
  searchTerm: string;
  fileTreeMode: string;
  exclusionPatterns: string[];
  userInstructions: string;
  selectedSystemPrompts: SystemPrompt[];
  selectedRolePrompts: RolePrompt[];
  selectedInstructions: Instruction[];
}): WorkspaceState {
  const uniqueSelected = dedupeSelectedFiles(params.selectedFiles);
  const tokenCounts = buildTokenCountsForSelectedFiles(params.allFiles, uniqueSelected);
  return {
    selectedFolder: params.selectedFolder,
    expandedNodes: params.expandedNodes,
    selectedFiles: uniqueSelected,
    sortOrder: params.sortOrder,
    searchTerm: params.searchTerm,
    fileTreeMode: params.fileTreeMode as WorkspaceState["fileTreeMode"],
    exclusionPatterns: params.exclusionPatterns,
    userInstructions: params.userInstructions,
    tokenCounts,
    selectedSystemPromptIds: params.selectedSystemPrompts.map((p) => p.id),
    selectedRolePromptIds: params.selectedRolePrompts.map((p) => p.id),
    selectedInstructions: params.selectedInstructions,
  };
}

export function reconcileSelectedInstructions(
  saved: Instruction[] | undefined,
  currentDb: Instruction[]
): Instruction[] {
  if (!saved || saved.length === 0) return [];
  const byId = new Map(currentDb.map((i) => [i.id, i] as const));
  return saved
    .map((s) => byId.get(s.id) ?? s)
    .filter((i): i is Instruction => Boolean(i));
}

