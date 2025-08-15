import { useEffect, useRef, useCallback } from 'react';

import { debounce } from '../utils/debounce';
import type { 
  SelectedFileReference, 
  FileTreeMode,
  SystemPrompt,
  RolePrompt
} from '../types/file-types';

import { usePersistentState } from './use-persistent-state';

interface AutoSavePreferences {
  enabled: boolean;
  debounceMs: number;
  minIntervalMs: number;
}

interface WorkspaceSignatureData {
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

interface AutoSaveOptions {
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

const DEFAULT_PREFERENCES: AutoSavePreferences = {
  enabled: true, // Auto-save ON by default
  debounceMs: 100, // Very short debounce to batch rapid keystrokes
  minIntervalMs: 0 // No minimum interval between saves
};

/**
 * Computes a stable signature from workspace state for change detection.
 * Excludes heavy data like allFiles and token counts.
 */
export function computeWorkspaceSignature(data: WorkspaceSignatureData): string {
  const normalized = {
    selectedFolder: data.selectedFolder || '',
    selectedFiles: data.selectedFiles.map(f => ({
      path: f.path,
      // Canonicalize line ranges: sort then join
      lines: f.lines
        ? [...f.lines]
            .sort((a, b) => {
              if (a.start !== b.start) return a.start - b.start;
              return a.end - b.end;
            })
            .map(l => `${l.start}-${l.end}`)
            .join(',')
        : ''
    })).sort((a, b) => a.path.localeCompare(b.path)),
    expandedNodes: Object.entries(data.expandedNodes)
      .filter(([_, expanded]) => expanded)
      .map(([path]) => path)
      .sort(),
    sortOrder: data.sortOrder,
    searchTerm: data.searchTerm,
    fileTreeMode: data.fileTreeMode,
    exclusionPatterns: [...data.exclusionPatterns].sort(),
    selectedInstructions: [...data.selectedInstructions].sort(),
    systemPromptIds: [...data.systemPromptIds].sort(),
    rolePromptIds: [...data.rolePromptIds].sort(),
    userInstructions: data.userInstructions
  };
  
  return JSON.stringify(normalized);
}

/**
 * Hook for auto-saving workspace changes with debouncing and guards.
 * Monitors workspace state changes and automatically persists them after a delay.
 */
export function useWorkspaceAutoSave(options: AutoSaveOptions): {
  isAutoSaveEnabled: boolean;
  setAutoSaveEnabled: (enabled: boolean) => void;
  autoSavePreferences: AutoSavePreferences;
} {
  const {
    currentWorkspace,
    selectedFolder,
    selectedFiles,
    expandedNodes,
    sortOrder,
    searchTerm,
    fileTreeMode,
    exclusionPatterns,
    selectedInstructions,
    customPrompts,
    userInstructions,
    isApplyingWorkspaceData,
    isProcessing,
    onAutoSave
  } = options;

  // Consolidate all auto-save preferences into a single state to avoid rate limiting
  const [autoSavePrefs, setAutoSavePrefs] = usePersistentState<AutoSavePreferences>(
    'pasteflow.prefs.workspace.autosave',
    DEFAULT_PREFERENCES
  );
  
  // Extract individual values for easier access
  const autoSaveEnabled = autoSavePrefs.enabled;
  const debounceMs = autoSavePrefs.debounceMs;
  const minIntervalMs = autoSavePrefs.minIntervalMs;
  
  // Wrapper to update just the enabled state
  const setAutoSaveEnabled = useCallback((enabled: boolean) => {
    setAutoSavePrefs(prev => ({ ...prev, enabled }));
  }, [setAutoSavePrefs]);

  // Track last save time and signature
  const lastSaveTimeRef = useRef<number>(0);
  const lastSignatureRef = useRef<string>('');
  const saveInProgressRef = useRef<boolean>(false);
  const hasInitializedRef = useRef<boolean>(false);
  const prevWorkspaceRef = useRef<string | null>(null);
  const minIntervalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSignatureRef = useRef<string | null>(null);

  // Extract prompt IDs from customPrompts
  const systemPromptIds = customPrompts.systemPrompts
    .filter((p: { selected?: boolean }) => p.selected)
    .map((p: { id: string }) => p.id);
  const rolePromptIds = customPrompts.rolePrompts
    .filter((p: { selected?: boolean }) => p.selected)
    .map((p: { id: string }) => p.id);

  // Build signature data
  const signatureData: WorkspaceSignatureData = {
    selectedFolder,
    selectedFiles: selectedFiles.map(f => ({
      path: f.path,
      lines: f.lines
    })),
    expandedNodes,
    sortOrder,
    searchTerm,
    fileTreeMode,
    exclusionPatterns,
    selectedInstructions,
    systemPromptIds,
    rolePromptIds,
    userInstructions
  };

  // Compute current signature
  const currentSignature = computeWorkspaceSignature(signatureData);

  // Reset baseline when workspace changes and we're not in applying phase
  useEffect(() => {
    if (currentWorkspace !== prevWorkspaceRef.current && !isApplyingWorkspaceData) {
      lastSignatureRef.current = currentSignature;
      prevWorkspaceRef.current = currentWorkspace;
      // Clear any trailing timers from previous workspace
      if (minIntervalTimerRef.current) {
        clearTimeout(minIntervalTimerRef.current);
        minIntervalTimerRef.current = null;
      }
      pendingSignatureRef.current = null;
    }
  }, [currentWorkspace, isApplyingWorkspaceData, currentSignature]);

  // Helper to check if auto-save should proceed
  const canAutoSave = useCallback(() => {
    return autoSaveEnabled && 
           currentWorkspace && 
           !isApplyingWorkspaceData && 
           !isProcessing && 
           !saveInProgressRef.current;
  }, [autoSaveEnabled, currentWorkspace, isApplyingWorkspaceData, isProcessing]);

  // Helper to log auto-save errors
  const logAutoSaveError = useCallback((error: unknown) => {
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
  }, []);

  // Auto-save function with guards
  const performAutoSave = useCallback(async () => {
    // Guard conditions
    if (!canAutoSave()) return;

    // Check if signature has changed
    if (currentSignature === lastSignatureRef.current) {
      return;
    }

    // With minIntervalMs set to 0, we can save immediately without complex timing logic
    const now = Date.now();

    // Perform save
    try {
      saveInProgressRef.current = true;
      await onAutoSave();
      lastSaveTimeRef.current = now;
      lastSignatureRef.current = currentSignature;
      pendingSignatureRef.current = null;
    } catch (error) {
      logAutoSaveError(error);
    } finally {
      saveInProgressRef.current = false;
    }
  }, [
    canAutoSave,
    currentSignature,
    onAutoSave,
    logAutoSaveError
  ]);

  // Create debounced save function
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();
  
  useEffect(() => {
    debouncedSaveRef.current = debounce(performAutoSave, debounceMs);
    return () => {
      // If your debounce supports cancel, call it here.
      // (No-op otherwise; safe.)
      // @ts-expect-error: cancel method exists at runtime but is not in debounce type definition
      debouncedSaveRef.current?.cancel?.();
    };
  }, [performAutoSave, debounceMs]);

  // Initialize signature on first mount
  useEffect(() => {
    if (!hasInitializedRef.current) {
      lastSignatureRef.current = currentSignature;
      hasInitializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once

  // Add handlers for app close and visibility changes
  useEffect(() => {
    // Handle Electron's app-will-quit event for reliable shutdown saves
    const handleAppWillQuit = () => {
      // Synchronously check if we need to save
      if (canAutoSave() && currentSignature !== lastSignatureRef.current) {
        // Mark that we're saving to prevent duplicate saves
        saveInProgressRef.current = true;
        
        // Perform save and update refs immediately
        // Note: This is still async but Electron will wait briefly
        onAutoSave().then(() => {
          lastSignatureRef.current = currentSignature;
        }).catch(error => {
          console.error('[AutoSave] Emergency save failed:', error);
        });
      }
    };

    // Listen for Electron IPC message
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('app-will-quit', handleAppWillQuit);
    }
    
    // Fallback: browser beforeunload event
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (canAutoSave() && currentSignature !== lastSignatureRef.current) {
        // Attempt to save (may not complete in all cases)
        void performAutoSave();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Also listen for visibility change to save when app loses focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (canAutoSave() && currentSignature !== lastSignatureRef.current) {
          void performAutoSave();
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.removeListener('app-will-quit', handleAppWillQuit);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [canAutoSave, currentSignature, performAutoSave, onAutoSave]);
  
  // Trigger auto-save on signature changes
  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (!currentWorkspace) return;
    if (isApplyingWorkspaceData) return;
    if (isProcessing) return;
    if (!hasInitializedRef.current) return;
    
    // Only trigger if signature has changed
    if (currentSignature !== lastSignatureRef.current) {
      debouncedSaveRef.current?.();
    }
  }, [
    autoSaveEnabled,
    currentWorkspace,
    isApplyingWorkspaceData,
    isProcessing,
    currentSignature
  ]);

  return {
    isAutoSaveEnabled: autoSaveEnabled,
    setAutoSaveEnabled,
    autoSavePreferences: autoSavePrefs
  };
}