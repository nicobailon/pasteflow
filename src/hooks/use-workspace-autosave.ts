import { useEffect, useRef, useCallback } from 'react';
import { debounce } from '../utils/debounce';
import { usePersistentState } from './use-persistent-state';
import type { 
  SelectedFileReference, 
  FileTreeMode,
  SystemPrompt,
  RolePrompt
} from '../types/file-types';

interface AutoSavePreferences {
  enabled: boolean;
  debounceMs: number;
  minIntervalMs: number;
}

interface WorkspaceSignatureData {
  selectedFolder: string | null;
  selectedFiles: Array<{ path: string; lines?: { start: number; end: number }[] }>;
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
    systemPrompts: Array<SystemPrompt & { selected?: boolean }>;
    rolePrompts: Array<RolePrompt & { selected?: boolean }>;
  };
  userInstructions: string;
  isApplyingWorkspaceData: boolean;
  isProcessing: boolean;
  onAutoSave: () => Promise<void>;
}

const DEFAULT_PREFERENCES: AutoSavePreferences = {
  enabled: true, // Auto-save ON by default
  debounceMs: 2000,
  minIntervalMs: 10000
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
            .sort((a, b) => (a.start - b.start) || (a.end - b.end))
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

  // Auto-save function with guards
  const performAutoSave = useCallback(async () => {
    // Guard conditions
    if (!autoSaveEnabled) return;
    if (!currentWorkspace) return;
    if (isApplyingWorkspaceData) return;
    if (isProcessing) return;
    if (saveInProgressRef.current) return;

    // Check minimum interval
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    if (timeSinceLastSave < minIntervalMs) {
      // Schedule one trailing save at the earliest allowed time
      pendingSignatureRef.current = currentSignature;
      if (!minIntervalTimerRef.current) {
        minIntervalTimerRef.current = setTimeout(() => {
          minIntervalTimerRef.current = null;
          // Re-check guards just in case
          if (!autoSaveEnabled || !currentWorkspace || isApplyingWorkspaceData || isProcessing || saveInProgressRef.current) {
            return;
          }
          if (pendingSignatureRef.current && pendingSignatureRef.current !== lastSignatureRef.current) {
            // Trigger a save with the latest signature
            void performAutoSave();
          }
        }, Math.max(0, minIntervalMs - timeSinceLastSave));
      }
      return;
    }

    // Check if signature has changed
    if (currentSignature === lastSignatureRef.current) {
      return;
    }

    // Perform save
    try {
      saveInProgressRef.current = true;
      await onAutoSave();
      lastSaveTimeRef.current = now;
      lastSignatureRef.current = currentSignature;
      pendingSignatureRef.current = null;
    } catch (error) {
      console.error('[AutoSave] Auto-save failed:', error);
    } finally {
      saveInProgressRef.current = false;
    }
  }, [
    autoSaveEnabled,
    currentWorkspace,
    isApplyingWorkspaceData,
    isProcessing,
    currentSignature,
    minIntervalMs,
    onAutoSave
  ]);

  // Create debounced save function
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();
  
  useEffect(() => {
    debouncedSaveRef.current = debounce(performAutoSave, debounceMs);
    return () => {
      // If your debounce supports cancel, call it here.
      // (No-op otherwise; safe.)
      // @ts-expect-error: optional cancel
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