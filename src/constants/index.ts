export * from './app-constants';
export * from './workspace-drag-constants';

export const STORAGE_KEYS = {
  SELECTED_FOLDER: 'pasteflow.selected_folder',
  SELECTED_FILES: 'pasteflow.selected_files',
  SORT_ORDER: 'pasteflow.sort_order',
  FILE_TREE_SORT_ORDER: 'pasteflow.file_tree_sort_order',
  SEARCH_TERM: 'pasteflow.search_term',
  FILE_TREE_MODE: 'pasteflow.file_tree_mode',
  SYSTEM_PROMPTS: 'pasteflow.system_prompts',
  ROLE_PROMPTS: 'pasteflow.role_prompts',
  DOCS: 'pasteflow.docs',
  WORKSPACES: 'pasteflow.workspaces',
  CURRENT_WORKSPACE: 'pasteflow.current_workspace',
  WORKSPACE_SORT_MODE: 'pasteflow.workspace_sort_mode',
  WORKSPACE_MANUAL_ORDER: 'pasteflow.workspace_manual_order'
} as const;