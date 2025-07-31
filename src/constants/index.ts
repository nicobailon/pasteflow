// Keys for localStorage
export const STORAGE_KEYS = {
  SELECTED_FILES: "pasteflow-selected-files",
  SORT_ORDER: "pasteflow-sort-order",
  FILE_TREE_SORT_ORDER: "pasteflow-file-tree-sort-order",
  SEARCH_TERM: "pasteflow-search-term",
  EXPANDED_NODES: "pasteflow-expanded-nodes",
  FILE_TREE_MODE: "pasteflow-file-tree-mode",
  SYSTEM_PROMPTS: "pasteflow-system-prompts",
  ROLE_PROMPTS: "pasteflow-role-prompts",
  WORKSPACES: "pasteflow-workspaces",
  WORKSPACE_SORT_MODE: "pasteflow-workspace-sort-mode",
  WORKSPACE_MANUAL_ORDER: "pasteflow-workspace-manual-order",
};

// Sort options for the dropdown
export const SORT_OPTIONS = [
  { value: "tokens-desc", label: "Tokens: High to Low" },
  { value: "tokens-asc", label: "Tokens: Low to High" },
  { value: "name-asc", label: "Name: A to Z" },
  { value: "name-desc", label: "Name: Z to A" },
];

// Default exclusion patterns
export const DEFAULT_EXCLUSION_PATTERNS = [
  "**/node_modules/",
  "**/.npm/",
  "**/__pycache__/",
  "**/.pytest_cache/",
  "**/.mypy_cache/",
  "**/.gradle/",
  "**/.nuget/",
  "**/.cargo/",
  "**/.stack-work/",
  "**/.ccache/",
  "**/.idea/",
  "**/.vscode/",
  "**/*.swp",
  "**/*~",
  "**/*.tmp",
  "**/*.temp",
  "**/*.bak",
  "**/*.meta",
  "**/package-lock.json",
];