import { useEffect, useRef, useCallback } from 'react';

import { debounce } from '../utils/debounce';

import { usePersistentState } from './use-persistent-state';
import {
  type AutoSavePreferences,
  type AutoSaveOptions,
  DEFAULT_PREFERENCES,
  buildSignatureData,
  canAutoSave,
  logAutoSaveError,
  createAppWillQuitHandler,
  createBeforeUnloadHandler,
  createVisibilityChangeHandler,
  computeWorkspaceSignature
} from './use-workspace-autosave-helpers';

// Re-export for backward compatibility
export { computeWorkspaceSignature } from './use-workspace-autosave-helpers';

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
    isApplyingWorkspaceData,
    isProcessing,
    onAutoSave
  } = options;

  // Consolidate all auto-save preferences into a single state to avoid rate limiting
  const [autoSavePrefs, setAutoSavePrefs] = usePersistentState<AutoSavePreferences>(
    'pasteflow.prefs.workspace.autosave',
    DEFAULT_PREFERENCES
  );

  // Normalize possibly undefined data coming from persistence to keep the UI stable
  const safePrefs: AutoSavePreferences = (autoSavePrefs ?? DEFAULT_PREFERENCES);

  // Extract individual values for easier access
  const autoSaveEnabled = !!safePrefs.enabled;
  const debounceMs = safePrefs.debounceMs ?? DEFAULT_PREFERENCES.debounceMs;
  
  // Wrapper to update just the enabled state
  const setAutoSaveEnabled = useCallback((enabled: boolean) => {
    setAutoSavePrefs(prev => ({ ...(prev ?? DEFAULT_PREFERENCES), enabled }));
  }, [setAutoSavePrefs]);

  // Track last save time and signature
  const lastSaveTimeRef = useRef<number>(0);
  const lastSignatureRef = useRef<string>('');
  const saveInProgressRef = useRef<boolean>(false);
  const hasInitializedRef = useRef<boolean>(false);
  const prevWorkspaceRef = useRef<string | null>(null);
  const minIntervalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSignatureRef = useRef<string | null>(null);

  // Build signature data using helper
  const signatureData = buildSignatureData(options);

  // Compute current signature
  const currentSignature = computeWorkspaceSignature(signatureData);

  // Stable refs for lifetime event handlers (prevents listener re-registration)
  const autoSaveEnabledRef = useRef(autoSaveEnabled);
  useEffect(() => { autoSaveEnabledRef.current = autoSaveEnabled; }, [autoSaveEnabled]);

  const currentSignatureRef = useRef(currentSignature);
  useEffect(() => { currentSignatureRef.current = currentSignature; }, [currentSignature]);

  const currentWorkspaceRef = useRef(currentWorkspace);
  useEffect(() => { currentWorkspaceRef.current = currentWorkspace; }, [currentWorkspace]);

  const isApplyingWorkspaceDataRef = useRef(isApplyingWorkspaceData);
  useEffect(() => { isApplyingWorkspaceDataRef.current = isApplyingWorkspaceData; }, [isApplyingWorkspaceData]);

  const isProcessingRef = useRef(isProcessing);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  const onAutoSaveRef = useRef(onAutoSave);
  useEffect(() => { onAutoSaveRef.current = onAutoSave; }, [onAutoSave]);

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
  const canAutoSaveNow = useCallback(() => {
    return canAutoSave(
      autoSaveEnabled,
      currentWorkspace,
      isApplyingWorkspaceData,
      isProcessing,
      saveInProgressRef.current
    );
  }, [autoSaveEnabled, currentWorkspace, isApplyingWorkspaceData, isProcessing]);

  // Auto-save function with guards
  const performAutoSave = useCallback(async () => {
    // Guard conditions
    if (!canAutoSaveNow()) return;

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
    canAutoSaveNow,
    currentSignature,
    onAutoSave
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

  // Add handlers for app close and visibility changes (stable, single registration)
  useEffect(() => {
    // Create refs object for handlers
    const refs = {
      autoSaveEnabledRef,
      currentWorkspaceRef,
      isApplyingWorkspaceDataRef,
      isProcessingRef,
      saveInProgressRef,
      currentSignatureRef,
      lastSignatureRef,
      onAutoSaveRef
    };

    // Create event handlers using helpers
    const handleAppWillQuitStable = createAppWillQuitHandler(refs);
    const handleBeforeUnload = createBeforeUnloadHandler(refs);
    const handleVisibilityChange = createVisibilityChangeHandler(refs);

    // Register event listeners
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('app-will-quit', handleAppWillQuitStable);
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.removeListener('app-will-quit', handleAppWillQuitStable);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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
    autoSavePreferences: safePrefs
  };
}