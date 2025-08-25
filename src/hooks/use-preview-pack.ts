import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';

import type {
  FileData,
  SelectedFileReference,
  Instruction,
  SystemPrompt,
  RolePrompt,
  FileTreeMode,
} from '../types/file-types';
import { logger } from '../utils/logger';

import { usePreviewGenerator } from './use-preview-generator';
import type { StartPreviewParams } from './use-preview-generator';

export type PackStatus = 'idle' | 'packing' | 'ready' | 'error' | 'cancelled';

export interface PackState {
  status: PackStatus;
  processed: number;
  total: number;
  percent: number;
  tokenEstimate: number;
  fullContent?: string;
  contentForDisplay?: string;
  signature: string;
  error?: string;
  hasSignatureChanged?: boolean;
}

export interface UsePreviewPackParams {
  allFiles: FileData[];
  selectedFiles: SelectedFileReference[];
  sortOrder: string;
  selectedFolder: string | null;
  selectedSystemPrompts: SystemPrompt[];
  selectedRolePrompts: RolePrompt[];
  selectedInstructions: Instruction[];
  userInstructions: string;
  fileTreeMode: FileTreeMode;
}

/**
 * Computes a stable signature from the input parameters for cache keying and change detection.
 * This signature is used to determine when inputs have changed and a new pack is needed.
 */
function computeSignature(params: UsePreviewPackParams): string {
  const {
    selectedFiles,
    sortOrder,
    selectedFolder,
    selectedSystemPrompts,
    selectedRolePrompts,
    selectedInstructions,
    userInstructions,
    fileTreeMode,
  } = params;

  // Sort and stringify to ensure stable signature
  const sortedFiles = [...selectedFiles].sort((a, b) => a.path.localeCompare(b.path));
  const sortedSystemPrompts = [...selectedSystemPrompts].sort((a, b) => a.id.localeCompare(b.id));
  const sortedRolePrompts = [...selectedRolePrompts].sort((a, b) => a.id.localeCompare(b.id));
  const sortedInstructions = [...selectedInstructions].sort((a, b) => a.id.localeCompare(b.id));

  const signatureObj = {
    files: sortedFiles.map(f => ({
      path: f.path,
      lines: f.lines ? [...f.lines].sort((a, b) => a.start - b.start) : undefined,
    })),
    sortOrder,
    selectedFolder,
    systemPrompts: sortedSystemPrompts.map(p => p.id),
    rolePrompts: sortedRolePrompts.map(p => p.id),
    instructions: sortedInstructions.map(i => i.id),
    userInstructions,
    fileTreeMode,
  };

  // Create a stable JSON string
  return JSON.stringify(signatureObj);
}

/**
 * Simple LRU cache for prepared preview content.
 * Keeps only the most recent entry by default to minimize memory usage.
 */
class PreparedPreviewCache {
  private cache: Map<string, { 
    state: PackState;
    timestamp: number;
  }> = new Map();
  private maxEntries = 1;

  get(signature: string): PackState | null {
    const entry = this.cache.get(signature);
    if (!entry) return null;
    
    // Move to end (most recently used)
    this.cache.delete(signature);
    this.cache.set(signature, entry);
    
    return entry.state;
  }

  set(signature: string, state: PackState): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(signature)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(signature, {
      state,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  has(signature: string): boolean {
    return this.cache.has(signature);
  }
}

/**
 * Hook for the Pack → Preview/Copy workflow.
 * Wraps usePreviewGenerator to enable background packing without opening the modal.
 */
export function usePreviewPack(params: UsePreviewPackParams) {
  const { startPreview, cancel, pushFileUpdates, pushFileStatus, reset, previewState } = usePreviewGenerator();
  
  const cacheRef = useRef<PreparedPreviewCache>(new PreparedPreviewCache());
  const currentSignatureRef = useRef<string>('');
  const [packState, setPackState] = useState<PackState>({
    status: 'idle',
    processed: 0,
    total: 0,
    percent: 0,
    tokenEstimate: 0,
    signature: '',
  });

  // Compute the current signature
  const signature = useMemo(() => computeSignature(params), [params]);

  // Map preview state to pack state
  useEffect(() => {
    // Only sync state if we have an active packing session
    if (currentSignatureRef.current && previewState.id) {
      // Update pack state with preview progress
      // Don't read packState.status from outer closure - rely on functional update
      // Wrap in startTransition for non-urgent updates during heavy streaming
      startTransition(() => {
        setPackState(prev => {
          // Don't update if we've already completed or cancelled
          if (prev.status === 'ready' || prev.status === 'cancelled' || prev.status === 'error') {
            return prev;
          }
          
          // Only update if we're in idle or packing state
          if (prev.status === 'idle' || prev.status === 'packing') {
            return {
              ...prev,
              status: prev.status === 'idle' ? 'packing' : prev.status,
              processed: previewState.processed,
              total: previewState.total,
              percent: previewState.percent,
              tokenEstimate: previewState.tokenEstimate,
              // Only update content if new content is available, preserve existing otherwise
              fullContent: previewState.fullContent || prev.fullContent,
              contentForDisplay: previewState.contentForDisplay || prev.contentForDisplay,
            };
          }
          
          return prev;
        });
      });
    }
    
    // Handle completion, error, and cancellation states
    if (currentSignatureRef.current && previewState.id) {
      // Check if preview is complete
      switch (previewState.status) {
      case 'complete': {
        logger.info('[Pack] Pack operation completed', {
          processed: previewState.processed,
          total: previewState.total,
          tokenEstimate: previewState.tokenEstimate,
          signature: currentSignatureRef.current,
        });
        
        const completeState: PackState = {
          status: 'ready',
          processed: previewState.processed,
          total: previewState.total,
          percent: 100,
          tokenEstimate: previewState.tokenEstimate,
          fullContent: previewState.fullContent,
          contentForDisplay: previewState.contentForDisplay,
          signature: currentSignatureRef.current,
          hasSignatureChanged: false,  // Content is now up-to-date
        };
        
        // Use functional update to avoid race with startTransition above
        setPackState(prev => {
          // Don't override if already cancelled or ready
          if (prev.status === 'cancelled' || prev.status === 'ready') {
            return prev;
          }
          return completeState;
        });
        cacheRef.current.set(currentSignatureRef.current, completeState);
      
      break;
      }
      case 'error': {
        logger.error('[Pack] Pack operation failed', { error: previewState.error });
        setPackState(prev => ({
          ...prev,
          status: 'error',
          error: previewState.error,
          fullContent: previewState.fullContent, // Keep any partial content
          contentForDisplay: previewState.contentForDisplay,
        }));
      
      break;
      }
      case 'cancelled': {
        setPackState(prev => ({
          ...prev,
          status: 'cancelled',
          fullContent: previewState.fullContent, // Keep any partial content
          contentForDisplay: previewState.contentForDisplay,
        }));
      
      break;
      }
      // No default
      }
    }
  }, [previewState]); // Only depend on previewState

  // Auto-cancel and reset if signature changes
  useEffect(() => {
    // Don't reset if we're in ready state - preserve the packed content
    if (packState.status === 'ready' && signature !== currentSignatureRef.current) {
      // Mark that signature has changed so UI can show Repack button
      setPackState(prev => ({
        ...prev,
        hasSignatureChanged: true,
      }));
      // IMPORTANT: Update the signature reference to prevent infinite loop
      currentSignatureRef.current = signature;
      return;
    }
    
    if (signature !== currentSignatureRef.current && 
        (packState.status === 'packing' || packState.status === 'error' || packState.status === 'cancelled')) {
      // Signature changed, cancel current pack if in progress
      if (packState.status === 'packing') {
        cancel();
      }
      
      // Check cache for this signature
      const cached = cacheRef.current.get(signature);
      if (cached) {
        currentSignatureRef.current = signature;
        setPackState(cached);
      } else {
        // Reset to idle for new signature immediately
        currentSignatureRef.current = signature;
        setPackState({
          status: 'idle',
          processed: 0,
          total: 0,
          percent: 0,
          tokenEstimate: 0,
          signature,
        });
      }
    }
  }, [signature, packState.status, packState.fullContent, cancel]);

  // Pack function - starts background processing without opening modal
  const pack = useCallback(() => {
    logger.debug('[Pack] Starting pack operation', { signature });
    
    // Check cache first
    const cached = cacheRef.current.get(signature);
    if (cached && cached.status === 'ready') {
      logger.debug('[Pack] Using cached result', { signature });
      currentSignatureRef.current = signature;  // Set BEFORE updating state
      setPackState({
        ...cached,
        hasSignatureChanged: false,  // Clear the flag since we're now up-to-date
      });
      return;
    }
    
    // Update state to packing
    currentSignatureRef.current = signature;
    setPackState({
      status: 'packing',
      processed: 0,
      total: 0,
      percent: 0,
      tokenEstimate: 0,
      signature,
      hasSignatureChanged: false,  // Clear the flag when starting new pack
    });

    logger.info('[Pack] Starting preview generation', { 
      fileCount: params.selectedFiles.length,
      signature 
    });

    // Start the preview generation in the worker
    const startParams: StartPreviewParams = {
      allFiles: params.allFiles,
      selectedFiles: params.selectedFiles,
      sortOrder: params.sortOrder,
      fileTreeMode: params.fileTreeMode,
      selectedFolder: params.selectedFolder,
      selectedSystemPrompts: params.selectedSystemPrompts,
      selectedRolePrompts: params.selectedRolePrompts,
      selectedInstructions: params.selectedInstructions,
      userInstructions: params.userInstructions,
      packOnly: true,  // Always use pack-only mode to minimize UI updates
    };

    startPreview(startParams);
  }, [signature, params, startPreview]);

  // Cancel pack function
  const cancelPack = useCallback(() => {
    logger.info('[Pack] Cancelling pack operation');
    cancel();
    setPackState(prev => ({
      ...prev,
      status: 'cancelled',
    }));
  }, [cancel]);

  // Reset pack function
  const resetPack = useCallback(() => {
    logger.debug('[Pack] Resetting pack state');
    reset();
    setPackState({
      status: 'idle',
      processed: 0,
      total: 0,
      percent: 0,
      tokenEstimate: 0,
      signature: '',
    });
    currentSignatureRef.current = '';
  }, [reset]);

  // Clear cache when workspace (selectedFolder) actually changes
  const previousFolderRef = useRef<string | null | undefined>();
  useEffect(() => {
    // Skip on initial mount (when previousFolderRef is undefined)
    if (previousFolderRef.current === undefined) {
      previousFolderRef.current = params.selectedFolder;
      return;
    }
    
    // Only clear if folder actually changed
    if (previousFolderRef.current !== params.selectedFolder) {
      logger.debug('[Pack] Clearing cache due to workspace change', {
        from: previousFolderRef.current,
        to: params.selectedFolder
      });
      cacheRef.current.clear();
      // Reset state when workspace changes
      if (currentSignatureRef.current) {
        resetPack();
      }
      previousFolderRef.current = params.selectedFolder;
    }
  }, [params.selectedFolder, resetPack]);
  
  // Clear cache on unmount
  useEffect(() => {
    return () => {
      logger.debug('[Pack] Clearing cache due to unmount');
      cacheRef.current.clear();
    };
  }, []);

  // Computed values
  const isPacking = packState.status === 'packing';
  const isPackReady = packState.status === 'ready';
  const copyText = packState.fullContent || '';

  return {
    pack,
    cancelPack,
    resetPack,
    pushFileUpdates,
    pushFileStatus,
    packState,
    previewState, // Pass through for modal compatibility
    isPacking,
    isReady: isPackReady,
    copyText,
  };
}