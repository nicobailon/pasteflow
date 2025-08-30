import type {
  SelectedFileReference,
  FileTreeMode,
  SystemPrompt,
  RolePrompt
} from '../types/file-types';

export interface AutoSavePreferences {
  enabled: boolean;
  debounceMs: number;
  minIntervalMs: number;
}

export interface WorkspaceSignatureData {
  selectedFolder: string | null;
  selectedFiles: { path: string; lines?: { start: number; end: number }[] }[];
  expandedNodes: Record<string, boolean>;
  sortOrder: string;
  searchTerm: string;
  fileTreeMode: FileTreeMode;
  exclusionPatterns: string[];
  selectedInstructions: string[];
  systemPromptIds: string[];
  rolePromptIds: string[];
  userInstructions: string;
}

export interface AutoSaveOptions {
  currentWorkspace: string | null;
  selectedFolder: string | null;
  selectedFiles: SelectedFileReference[];
  expandedNodes: Record<string, boolean>;
  sortOrder: string;
  searchTerm: string;
  fileTreeMode: FileTreeMode;
  exclusionPatterns: string[];
  selectedInstructions: string[];
  customPrompts: {
    systemPrompts: (SystemPrompt & { selected?: boolean })[];
    rolePrompts: (RolePrompt & { selected?: boolean })[];
  };
  userInstructions: string;
  isApplyingWorkspaceData: boolean;
  isProcessing: boolean;
  onAutoSave: () => Promise<void>;
}

export const DEFAULT_PREFERENCES: AutoSavePreferences = {
  enabled: true,
  debounceMs: 100,
  minIntervalMs: 0
};

export interface AutoSaveState {
  lastSaveTime: number;
  lastSignature: string;
  saveInProgress: boolean;
  hasInitialized: boolean;
  prevWorkspace: string | null;
  pendingSignature: string | null;
}

/**
 * Extract selected prompt IDs from custom prompts
 */
export function extractPromptIds(customPrompts: AutoSaveOptions['customPrompts'] | undefined): {
  systemPromptIds: string[];
  rolePromptIds: string[];
} {
  const systemPromptIds = (customPrompts?.systemPrompts ?? [])
    .filter((p: { selected?: boolean }) => !!p.selected)
    .map((p: { id: string }) => p.id);
  
  const rolePromptIds = (customPrompts?.rolePrompts ?? [])
    .filter((p: { selected?: boolean }) => !!p.selected)
    .map((p: { id: string }) => p.id);
  
  return { systemPromptIds, rolePromptIds };
}

/**
 * Build workspace signature data with guards for undefined values
 */
export function buildSignatureData(
  options: Pick<AutoSaveOptions, 
    'selectedFolder' | 'selectedFiles' | 'expandedNodes' | 'sortOrder' |
    'searchTerm' | 'fileTreeMode' | 'exclusionPatterns' | 'selectedInstructions' |
    'customPrompts' | 'userInstructions'>
): WorkspaceSignatureData {
  const { systemPromptIds, rolePromptIds } = extractPromptIds(options.customPrompts);
  
  return {
    selectedFolder: options.selectedFolder ?? null,
    selectedFiles: Array.isArray(options.selectedFiles)
      ? options.selectedFiles.map(f => ({ path: f.path, lines: f.lines }))
      : [],
    expandedNodes: options.expandedNodes ?? {},
    sortOrder: options.sortOrder ?? '',
    searchTerm: options.searchTerm ?? '',
    fileTreeMode: (options.fileTreeMode ?? 'none') as FileTreeMode,
    exclusionPatterns: Array.isArray(options.exclusionPatterns) ? options.exclusionPatterns : [],
    selectedInstructions: Array.isArray(options.selectedInstructions) ? options.selectedInstructions : [],
    systemPromptIds,
    rolePromptIds,
    userInstructions: options.userInstructions ?? ''
  };
}

/**
 * Normalize and sort line ranges for consistent comparison
 */
function normalizeLineRanges(lines: { start: number; end: number }[] | undefined): string {
  if (!Array.isArray(lines)) return '';
  
  return [...lines]
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    })
    .map(l => `${l.start}-${l.end}`)
    .join(',');
}

/**
 * Normalize selected files for signature computation
 */
function normalizeSelectedFiles(selectedFiles: { path: string; lines?: { start: number; end: number }[] }[]): {
  path: string;
  lines: string;
}[] {
  return selectedFiles.map(f => ({
    path: f.path,
    lines: normalizeLineRanges(f.lines)
  })).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Normalize expanded nodes for signature computation
 */
function normalizeExpandedNodes(expandedNodes: Record<string, boolean>): string[] {
  return Object.entries(expandedNodes)
    .filter(([_, expanded]) => !!expanded)
    .map(([path]) => path)
    .sort();
}

/**
 * Computes a stable signature from workspace state for change detection.
 * Excludes heavy data like allFiles and token counts.
 */
export function computeWorkspaceSignature(data: WorkspaceSignatureData): string {
  const selectedFilesArr = Array.isArray(data.selectedFiles) ? data.selectedFiles : [];
  const exclusionArr = Array.isArray(data.exclusionPatterns) ? data.exclusionPatterns : [];
  const selectedInstructionsArr = Array.isArray(data.selectedInstructions) ? data.selectedInstructions : [];
  const systemPromptIdsArr = Array.isArray(data.systemPromptIds) ? data.systemPromptIds : [];
  const rolePromptIdsArr = Array.isArray(data.rolePromptIds) ? data.rolePromptIds : [];
  const expandedNodesObj = (data.expandedNodes && typeof data.expandedNodes === 'object') ? data.expandedNodes : {};

  const normalized = {
    selectedFolder: data.selectedFolder || '',
    selectedFiles: normalizeSelectedFiles(selectedFilesArr),
    expandedNodes: normalizeExpandedNodes(expandedNodesObj),
    sortOrder: data.sortOrder || '',
    searchTerm: data.searchTerm || '',
    fileTreeMode: data.fileTreeMode,
    exclusionPatterns: [...exclusionArr].sort(),
    selectedInstructions: [...selectedInstructionsArr].sort(),
    systemPromptIds: [...systemPromptIdsArr].sort(),
    rolePromptIds: [...rolePromptIdsArr].sort(),
    userInstructions: data.userInstructions || ''
  };

  return JSON.stringify(normalized);
}

/**
 * Check if auto-save should proceed based on current conditions
 */
export function canAutoSave(
  autoSaveEnabled: boolean,
  currentWorkspace: string | null,
  isApplyingWorkspaceData: boolean,
  isProcessing: boolean,
  saveInProgress: boolean
): boolean {
  return !!(
    autoSaveEnabled &&
    currentWorkspace &&
    !isApplyingWorkspaceData &&
    !isProcessing &&
    !saveInProgress
  );
}

/**
 * Check if auto-save is needed based on signature comparison
 */
export function needsAutoSave(
  autoSaveEnabled: boolean,
  currentWorkspace: string | null,
  isApplyingWorkspaceData: boolean,
  isProcessing: boolean,
  saveInProgress: boolean,
  currentSignature: string,
  lastSignature: string
): boolean {
  return !!(
    autoSaveEnabled &&
    currentWorkspace &&
    !isApplyingWorkspaceData &&
    !isProcessing &&
    !saveInProgress &&
    currentSignature !== lastSignature
  );
}

/**
 * Log auto-save errors with appropriate categorization
 */
export function logAutoSaveError(error: unknown): void {
  if (error instanceof Error) {
    const errorMessage = error.message || '';
    if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
      console.error('[AutoSave] Permission error during save:', errorMessage);
    } else if (errorMessage.includes('ENOSPC')) {
      console.error('[AutoSave] Disk space error during save:', errorMessage);
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
      console.error('[AutoSave] Rate limit error during save:', errorMessage);
    } else {
      console.error('[AutoSave] Auto-save failed:', errorMessage);
    }
  } else {
    console.error('[AutoSave] Unexpected auto-save error:', error);
  }
}

/**
 * Create handler for app quit event
 */
export function createAppWillQuitHandler(
  refs: {
    autoSaveEnabledRef: React.MutableRefObject<boolean>;
    currentWorkspaceRef: React.MutableRefObject<string | null>;
    isApplyingWorkspaceDataRef: React.MutableRefObject<boolean>;
    isProcessingRef: React.MutableRefObject<boolean>;
    saveInProgressRef: React.MutableRefObject<boolean>;
    currentSignatureRef: React.MutableRefObject<string>;
    lastSignatureRef: React.MutableRefObject<string>;
    onAutoSaveRef: React.MutableRefObject<() => Promise<void>>;
  }
) {
  return () => {
    const needSave = needsAutoSave(
      refs.autoSaveEnabledRef.current,
      refs.currentWorkspaceRef.current,
      refs.isApplyingWorkspaceDataRef.current,
      refs.isProcessingRef.current,
      refs.saveInProgressRef.current,
      refs.currentSignatureRef.current,
      refs.lastSignatureRef.current
    );

    if (needSave) {
      refs.saveInProgressRef.current = true;
      Promise.resolve(refs.onAutoSaveRef.current?.())
        .then(() => {
          refs.lastSignatureRef.current = refs.currentSignatureRef.current;
          if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.send('app-will-quit-save-complete', {});
          }
        })
        .catch(() => {
          if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.send('app-will-quit-save-complete', { error: true });
          }
        });
    } else {
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.send('app-will-quit-save-complete', { skipped: true });
      }
    }
  };
}

/**
 * Create handler for before unload event
 */
export function createBeforeUnloadHandler(
  refs: {
    autoSaveEnabledRef: React.MutableRefObject<boolean>;
    currentWorkspaceRef: React.MutableRefObject<string | null>;
    isApplyingWorkspaceDataRef: React.MutableRefObject<boolean>;
    isProcessingRef: React.MutableRefObject<boolean>;
    saveInProgressRef: React.MutableRefObject<boolean>;
    currentSignatureRef: React.MutableRefObject<string>;
    lastSignatureRef: React.MutableRefObject<string>;
    onAutoSaveRef: React.MutableRefObject<() => Promise<void>>;
  }
) {
  return () => {
    const needSave = needsAutoSave(
      refs.autoSaveEnabledRef.current,
      refs.currentWorkspaceRef.current,
      refs.isApplyingWorkspaceDataRef.current,
      refs.isProcessingRef.current,
      refs.saveInProgressRef.current,
      refs.currentSignatureRef.current,
      refs.lastSignatureRef.current
    );

    if (needSave) {
      void refs.onAutoSaveRef.current?.();
    }
  };
}

/**
 * Create handler for visibility change event
 */
export function createVisibilityChangeHandler(
  refs: {
    autoSaveEnabledRef: React.MutableRefObject<boolean>;
    currentWorkspaceRef: React.MutableRefObject<string | null>;
    isApplyingWorkspaceDataRef: React.MutableRefObject<boolean>;
    isProcessingRef: React.MutableRefObject<boolean>;
    saveInProgressRef: React.MutableRefObject<boolean>;
    currentSignatureRef: React.MutableRefObject<string>;
    lastSignatureRef: React.MutableRefObject<string>;
    onAutoSaveRef: React.MutableRefObject<() => Promise<void>>;
  }
) {
  return () => {
    if (document.visibilityState === 'hidden') {
      const needSave = needsAutoSave(
        refs.autoSaveEnabledRef.current,
        refs.currentWorkspaceRef.current,
        refs.isApplyingWorkspaceDataRef.current,
        refs.isProcessingRef.current,
        refs.saveInProgressRef.current,
        refs.currentSignatureRef.current,
        refs.lastSignatureRef.current
      );

      if (needSave) {
        void refs.onAutoSaveRef.current?.();
      }
    }
  };
}