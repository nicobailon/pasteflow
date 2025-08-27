/* usePreviewGenerator hook
   Manages a dedicated preview-generation worker that streams preview text chunks and progress.
   Public API:
     - startPreview(params): string (id)
     - cancel(): void
     - reset(): void
     - previewState: PreviewState
     - isReady: boolean
*/

declare const jest: { fn?: unknown } | undefined;

import { useCallback, useEffect, useRef, useState, startTransition as reactStartTransition } from 'react';

import { TOKEN_COUNTING } from '@constants';

// Type-safe wrapper for startTransition with fallback
// React 18 exports startTransition, earlier versions will have undefined
const startTransition: typeof reactStartTransition = 
  reactStartTransition ?? ((fn: () => void) => { fn(); });
import type {
  FileData,
  SelectedFileReference,
  Instruction,
  SystemPrompt,
  RolePrompt,
  FileTreeMode,
} from '../types/file-types';
import { trackTokenAccuracy, trackPreviewStart, trackPreviewCancel } from '../utils/dev-metrics';
import {
  appendToBuffers,
  buildLightweightFilesForStart,
  computePercent,
  sanitizeErrorMessage,
} from './use-preview-generator-helpers';

export type PreviewStatus = 'idle' | 'loading' | 'streaming' | 'complete' | 'error' | 'cancelled';

export interface PreviewState {
  id: string | null;
  status: PreviewStatus;
  processed: number;
  total: number;
  percent: number;
  tokenEstimate: number;
  contentForDisplay: string; // truncated display text
  fullContent: string;       // full clipboard text
  error?: string;
}

export interface StartPreviewParams {
  allFiles: FileData[];
  selectedFiles: SelectedFileReference[];
  sortOrder: string;
  fileTreeMode: FileTreeMode;
  selectedFolder: string | null;
  selectedSystemPrompts: SystemPrompt[];
  selectedRolePrompts: RolePrompt[];
  selectedInstructions: Instruction[];
  userInstructions: string;
  chunkSize?: number;
  packOnly?: boolean;
}

type WorkerMessage =
  | { type: 'READY' }
  | { type: 'INIT_COMPLETE' } // For Jest MockWorker compatibility
  | {
      type: 'CHUNK';
      id: string;
      // New fields: display placeholder chunk + full content chunk
      displayChunk?: string;
      fullChunk?: string;
      // Back-compat (older workers): a single 'chunk' contained full content
      chunk?: string;
      processed: number;
      total: number;
      tokenDelta?: number;
    }
  | { type: 'PROGRESS'; id: string; processed: number; total: number; percent: number; tokenTotal?: number }
  | {
      type: 'COMPLETE';
      id: string;
      // New fields: final display + full footer chunks
      finalDisplayChunk?: string;
      finalFullChunk?: string;
      // Back-compat
      finalChunk?: string;
      tokenTotal?: number;
    }
  | { type: 'CANCELLED'; id: string }
  | { type: 'ERROR'; id?: string; error: string };

const DISPLAY_TRUNCATION_LIMIT = 200_000;
const UI_THROTTLE_MS = 33; // ~15fps to keep UI responsive under heavy streams

function createWorker(): Worker {
  let worker: Worker;
  // eslint-disable-next-line unicorn/no-typeof-undefined
  if (typeof jest === 'undefined') {
    try {
      // Use eval to avoid Jest transform issues
       
      const metaUrl = eval('import.meta.url');
      worker = new Worker(new URL('../workers/preview-generator-worker.ts', metaUrl), { type: 'module' });
    } catch {
      // Fallback path (dev servers)
      worker = new Worker('/src/workers/preview-generator-worker.ts', { type: 'module' });
    }
  } else {
    // Test environments will mock Worker. Script URL is ignored by the mock.
    worker = new Worker('/mock/worker/path', { type: 'module' } as WorkerOptions);
  }
  return worker;
}

export function usePreviewGenerator() {
  const workerRef = useRef<Worker | null>(null);
  const messageHandlerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const currentIdRef = useRef<string | null>(null);
  const rafPendingRef = useRef<boolean>(false);
  const lastFlushTimeRef = useRef<number>(0);
  const fileTreeModeRef = useRef<FileTreeMode>('none');

  // Mutable accumulation buffers
  const displayBufferRef = useRef<string>('');
  const fullBufferRef = useRef<string>('');
  const tokenEstimateRef = useRef<number>(0);
  const processedRef = useRef<number>(0);
  const totalRef = useRef<number>(0);
  const percentRef = useRef<number>(0);

  const [isReady, setIsReady] = useState<boolean>(false);
  const [previewState, setPreviewState] = useState<PreviewState>({
    id: null,
    status: 'idle',
    processed: 0,
    total: 0,
    percent: 0,
    tokenEstimate: 0,
    contentForDisplay: '',
    fullContent: '',
  });

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = createWorker();
    const readyListener = (e: MessageEvent) => {
      const msg = e.data as WorkerMessage;
      // Accept READY from real worker and INIT_COMPLETE from Jest MockWorker
      if (msg.type === 'READY' || msg.type === 'INIT_COMPLETE') {
        setIsReady(true);
      }
    };
    w.addEventListener('message', readyListener);
    workerRef.current = w;
    return w;
  }, []);

  const resetBuffers = useCallback((id: string | null) => {
    currentIdRef.current = id;
    displayBufferRef.current = '';
    fullBufferRef.current = '';
    tokenEstimateRef.current = 0;
    processedRef.current = 0;
    totalRef.current = 0;
    percentRef.current = 0;
  }, []);

  const flushState = useCallback((force = false) => {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (!force && now - lastFlushTimeRef.current < UI_THROTTLE_MS) {
      return;
    }
    lastFlushTimeRef.current = now;
    
    // Wrap non-urgent updates in startTransition for better responsiveness
    startTransition(() => {
      setPreviewState((prev) => ({
        id: currentIdRef.current,
        status: prev.status === 'idle' ? 'loading' : prev.status,
        processed: processedRef.current,
        total: totalRef.current,
        percent: percentRef.current,
        tokenEstimate: tokenEstimateRef.current,
        contentForDisplay: displayBufferRef.current,
        fullContent: fullBufferRef.current,
        error: prev.error,
      }));
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    const raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now() as unknown as number), 0);
    raf(() => {
      rafPendingRef.current = false;
      flushState(false);
    });
  }, [flushState]);

  const handleMessage = useCallback((e: MessageEvent) => {
    const msg = e.data as WorkerMessage;
    switch (msg.type) {
      case 'READY': {
        setIsReady(true);
        break;
      }
      case 'INIT_COMPLETE': {
        // Jest MockWorker compatibility
        setIsReady(true);
        break;
      }
      case 'CHUNK': {
        if (currentIdRef.current !== msg.id) return;

        // Prefer new fields; fall back to legacy 'chunk' for back-compat
        const displayPart = msg.displayChunk ?? msg.chunk ?? '';
        const fullPart = msg.fullChunk ?? msg.chunk ?? '';

        // Append to buffers via helper (enforces truncation)
        const { display, full } = appendToBuffers(
          displayBufferRef.current,
          fullBufferRef.current,
          displayPart,
          fullPart,
          DISPLAY_TRUNCATION_LIMIT
        );
        displayBufferRef.current = display;
        fullBufferRef.current = full;

        processedRef.current = msg.processed;
        totalRef.current = msg.total;
        percentRef.current = computePercent(processedRef.current, totalRef.current);

        const fallbackLen = typeof fullPart === 'string' ? fullPart.length : 0;
        tokenEstimateRef.current += typeof msg.tokenDelta === 'number'
          ? msg.tokenDelta
          : Math.ceil(fallbackLen / TOKEN_COUNTING.CHARS_PER_TOKEN);

        // Move to streaming on first data
        setPreviewState((prev) => (prev.status === 'loading' ? { ...prev, status: 'streaming' } : prev));

        scheduleFlush();
        break;
      }
      case 'PROGRESS': {
        if (currentIdRef.current !== msg.id) return;
        processedRef.current = msg.processed;
        totalRef.current = msg.total;
        percentRef.current = msg.percent;
        if (typeof msg.tokenTotal === 'number') {
          tokenEstimateRef.current = msg.tokenTotal;
        }
        scheduleFlush();
        break;
      }
      case 'COMPLETE': {
        if (currentIdRef.current !== msg.id) return;

        const finalDisplay = msg.finalDisplayChunk ?? msg.finalChunk ?? '';
        const finalFull = msg.finalFullChunk ?? msg.finalChunk ?? '';

        // Append final chunks/footer from worker
        const { display, full } = appendToBuffers(
          displayBufferRef.current,
          fullBufferRef.current,
          finalDisplay,
          finalFull,
          DISPLAY_TRUNCATION_LIMIT
        );
        displayBufferRef.current = display;
        fullBufferRef.current = full;

        const estimatedBeforeFinal = tokenEstimateRef.current;
        if (typeof msg.tokenTotal === 'number') {
          tokenEstimateRef.current = Math.max(tokenEstimateRef.current, msg.tokenTotal);
        }
        percentRef.current = 100;
        processedRef.current = totalRef.current;

        // Track token accuracy metrics (dev-only)
        // Only track if we have meaningful data (received chunks with estimates)
        if (currentIdRef.current && estimatedBeforeFinal > 0 && tokenEstimateRef.current > 0) {
          trackTokenAccuracy({
            sessionId: currentIdRef.current,
            estimatedTokens: estimatedBeforeFinal,
            finalTokens: tokenEstimateRef.current,
            fileCount: totalRef.current,
            selectionMode: fileTreeModeRef.current,
          });
        }

        setPreviewState({
          id: currentIdRef.current,
          status: 'complete',
          processed: processedRef.current,
          total: totalRef.current,
          percent: percentRef.current,
          tokenEstimate: tokenEstimateRef.current,
          contentForDisplay: displayBufferRef.current,
          fullContent: fullBufferRef.current,
        });
        break;
      }
      case 'CANCELLED': {
        if (currentIdRef.current && msg.id && currentIdRef.current !== msg.id) return;
        
        // Track cancellation (dev-only)
        if (currentIdRef.current) {
          trackPreviewCancel(currentIdRef.current);
        }
        
        setPreviewState((prev) => ({
          ...prev,
          status: 'cancelled',
        }));
        break;
      }
      case 'ERROR': {
        setPreviewState((prev) => ({
          ...prev,
          status: 'error',
          error: sanitizeErrorMessage(msg.error || 'Unknown error'),
        }));
        break;
      }
      default: {
        break;
      }
    }
  }, [scheduleFlush]);

  const attachMessageHandler = useCallback((worker: Worker) => {
    // Detach previous
    if (messageHandlerRef.current) {
      try {
        worker.removeEventListener('message', messageHandlerRef.current as EventListener);
      } catch {
        // ignore
      }
    }
    messageHandlerRef.current = (e: MessageEvent) => handleMessage(e);
    worker.addEventListener('message', messageHandlerRef.current as EventListener);
  }, [handleMessage]);

  const startPreview = useCallback((params: StartPreviewParams): string => {
    const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Store fileTreeMode for later use in metrics
    fileTreeModeRef.current = params.fileTreeMode;

    // Track preview start (dev-only)
    trackPreviewStart(id, params.selectedFiles.length);

    // Reset buffers and set loading state
    resetBuffers(id);
    setPreviewState({
      id,
      status: 'loading',
      processed: 0,
      total: 0,
      percent: 0,
      tokenEstimate: 0,
      contentForDisplay: '',
      fullContent: '',
    });

    const worker = ensureWorker();
    attachMessageHandler(worker);

    // Proactively request READY (safe no-op in worker)
    try {
      worker.postMessage({ type: 'INIT' });
    } catch {
      // ignore
    }

    // Build the lightweight file descriptors for the worker
    const lightweightAllFiles = buildLightweightFilesForStart(
      params.allFiles,
      params.selectedFiles,
      params.fileTreeMode
    );

    // Fire-and-forget streaming start
    worker.postMessage({
      type: 'START',
      payload: {
        id,
        allFiles: lightweightAllFiles,
        selectedFiles: params.selectedFiles,
        sortOrder: params.sortOrder,
        fileTreeMode: params.fileTreeMode,
        selectedFolder: params.selectedFolder,
        selectedSystemPrompts: params.selectedSystemPrompts,
        selectedRolePrompts: params.selectedRolePrompts,
        selectedInstructions: params.selectedInstructions,
        userInstructions: params.userInstructions,
        chunkSize: params.chunkSize,
        packOnly: params.packOnly,
      },
    });

    // Initial flush to update UI immediately
    flushState(true);
    return id;
  }, [ensureWorker, attachMessageHandler, flushState, resetBuffers]);

  const cancel = useCallback(() => {
    const id = currentIdRef.current;
    if (!id) return;
    const worker = workerRef.current;
    try {
      worker?.postMessage({ type: 'CANCEL', id });
    } catch {
      // ignore
    }
    // Optimistically set cancelled; worker will also emit CANCELLED
    setPreviewState((prev) => ({ ...prev, status: 'cancelled' }));
  }, []);

  // Push newly loaded file contents to the worker so it can stream them without re-opening the modal
  const pushFileUpdates = useCallback((files: { path: string; content: string; tokenCount?: number }[]) => {
    const id = currentIdRef.current;
    const worker = workerRef.current;
    if (!id || !worker || !Array.isArray(files) || files.length === 0) return;

    // Filter out invalid entries defensively
    const sanitized = files
      .filter(f => !!f && typeof f.path === 'string' && typeof f.content === 'string')
      .map(f => ({ path: f.path, content: f.content, tokenCount: f.tokenCount }));

    if (sanitized.length > 0) {
      try {
        worker.postMessage({ type: 'UPDATE_FILES', id, files: sanitized });
      } catch {
        // ignore posting errors
      }
    }
  }, []);

  const pushFileStatus = useCallback((path: string, status: 'binary' | 'skipped' | 'error', reason?: string) => {
    const id = currentIdRef.current;
    const worker = workerRef.current;
    if (!id || !worker) return;

    try {
      worker.postMessage({ type: 'UPDATE_FILE_STATUS', id, path, status, reason });
    } catch {
      // ignore posting errors
    }
  }, []);

  const reset = useCallback(() => {
    resetBuffers(null);
    setPreviewState({
      id: null,
      status: 'idle',
      processed: 0,
      total: 0,
      percent: 0,
      tokenEstimate: 0,
      contentForDisplay: '',
      fullContent: '',
    });
  }, [resetBuffers]);

  // Terminate worker and cleanup on unmount
  useEffect(() => {
    return () => {
      const w = workerRef.current;
      if (w && messageHandlerRef.current) {
        try {
          w.removeEventListener('message', messageHandlerRef.current as EventListener);
        } catch {
          // ignore
        }
      }
      try {
        w?.terminate();
      } catch {
        // ignore
      }
      workerRef.current = null;
      messageHandlerRef.current = null;
    };
  }, []);

  return {
    startPreview,
    cancel,
    pushFileUpdates,
    pushFileStatus,
    reset,
    previewState,
    isReady,
  };
}
