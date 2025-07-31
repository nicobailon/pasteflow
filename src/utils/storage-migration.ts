import { STORAGE_KEYS } from '../constants';

interface MigrationPair {
  old: string;
  new: string;
}

export function migrateLocalStorageKeys(): void {
  const migrations: MigrationPair[] = [
    { old: 'pasteflow-selected-files', new: STORAGE_KEYS.SELECTED_FILES },
    { old: 'pasteflow-sort-order', new: STORAGE_KEYS.SORT_ORDER },
    { old: 'pasteflow-file-tree-sort-order', new: STORAGE_KEYS.FILE_TREE_SORT_ORDER },
    { old: 'pasteflow-search-term', new: STORAGE_KEYS.SEARCH_TERM },
    { old: 'pasteflow-expanded-nodes', new: STORAGE_KEYS.EXPANDED_NODES },
    { old: 'pasteflow-file-tree-mode', new: STORAGE_KEYS.FILE_TREE_MODE },
    { old: 'pasteflow-system-prompts', new: STORAGE_KEYS.SYSTEM_PROMPTS },
    { old: 'pasteflow-role-prompts', new: STORAGE_KEYS.ROLE_PROMPTS },
    { old: 'pasteflow-workspaces', new: STORAGE_KEYS.WORKSPACES },
    { old: 'pasteflow-workspace-sort-mode', new: STORAGE_KEYS.WORKSPACE_SORT_MODE },
    { old: 'pasteflow-workspace-manual-order', new: STORAGE_KEYS.WORKSPACE_MANUAL_ORDER },
  ];

  let migratedCount = 0;

  for (const migration of migrations) {
    const oldValue = localStorage.getItem(migration.old);
    
    if (oldValue !== null) {
      const existingNewValue = localStorage.getItem(migration.new);
      
      if (existingNewValue === null) {
        localStorage.setItem(migration.new, oldValue);
        migratedCount++;
      }
      
      localStorage.removeItem(migration.old);
    }
  }

  if (migratedCount > 0) {
  }
}