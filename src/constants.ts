export const STORAGE_KEYS = {
  SELECTED_FOLDER: 'pasteflow.selected_folder',
  SELECTED_FILES: 'pasteflow.selected_files',
  SORT_ORDER: 'pasteflow.sort_order',
  FILE_TREE_SORT_ORDER: 'pasteflow.file_tree_sort_order',
  SEARCH_TERM: 'pasteflow.search_term',
  EXPANDED_NODES: 'pasteflow.expanded_nodes',
  FILE_TREE_MODE: 'pasteflow.file_tree_mode',
  SYSTEM_PROMPTS: 'pasteflow.system_prompts',
  ROLE_PROMPTS: 'pasteflow.role_prompts',
  DOCS: 'pasteflow.docs',
  WORKSPACES: 'pasteflow.workspaces',
  CURRENT_WORKSPACE: 'pasteflow.current_workspace',
  WORKSPACE_SORT_MODE: 'pasteflow.workspace_sort_mode',
  WORKSPACE_MANUAL_ORDER: 'pasteflow.workspace_manual_order'
};

export const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "tokens-asc", label: "Tokens (Lowest First)" },
  { value: "tokens-desc", label: "Tokens (Highest First)" },
  { value: "size-asc", label: "Size (Smallest First)" },
  { value: "size-desc", label: "Size (Largest First)" }
]; 