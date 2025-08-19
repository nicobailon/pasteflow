// Declare jest global for test environment detection with precise type
declare const jest: { fn?: unknown } | undefined;

import type { FileData, TreeNode } from '../types/file-types';
import { UI } from '@constants';

export interface TreeChunk {
  nodes: TreeNode[];
  progress: number;
}

interface WorkerMessage {
  type: 'TREE_CHUNK' | 'TREE_COMPLETE' | 'TREE_ERROR' | 'CANCELLED';
  id: string;
  payload?: TreeChunk;
  error?: string;
  code?: string;
}

interface WorkerRequest {
  type?: 'BUILD_TREE' | 'CANCEL';
  allFiles?: FileData[];
  chunkSize?: number;
  selectedFolder?: string | null;
  expandedNodes?: Record<string, boolean>;
  id: string;
}

export class StreamingTreeBuilder {
  private worker: Worker | null = null;
  private abortController = new AbortController();
  private id: string;
  private messageHandler: ((e: MessageEvent<WorkerMessage>) => void) | null = null;
  private errorHandler: ((error: ErrorEvent) => void) | null = null;
  private cancelResolver: (() => void) | null = null;
  private cancelled = false;

  constructor(
    private files: FileData[],
    private chunkSize: number = UI.TREE.CHUNK_SIZE,
    private selectedFolder?: string | null,
    private expandedNodes?: Record<string, boolean>
  ) {
    this.id = `tree-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  start(
    onChunk: (chunk: TreeChunk) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): void {
    try {
      // Create worker using the same pattern as token-worker-pool
      // If a worker was injected (tests), reuse it; otherwise create one
      if (!this.worker) {
        // Check if we're in a Jest test environment (more reliable than NODE_ENV)
        if (typeof jest !== 'undefined') {
          this.worker = new Worker('/mock/worker/path', { type: 'module' });
        } else {
          try {
            // Use eval to prevent Jest from parsing this at compile time
            const metaUrl = eval('import.meta.url');
            this.worker = new Worker(
              new URL('../workers/tree-builder-worker.ts', metaUrl),
              { type: 'module' }
            );
          } catch (error) {
            // Fallback for environments where import.meta is not available
            console.warn('import.meta.url not available, using fallback worker path');
            this.worker = new Worker('/src/workers/tree-builder-worker.ts', { type: 'module' });
          }
        }
      }

      // Set up message handlers
      this.messageHandler = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.id !== this.id) return; // Ignore messages from other instances

        switch (e.data.type) {
          case 'TREE_CHUNK': {
            if (e.data.payload && !this.abortController.signal.aborted) {
              onChunk(e.data.payload);
            }
            break;
          }
          
          case 'TREE_COMPLETE': {
            // Ensure cleanup occurs before invoking completion callback
            this.cleanup();
            if (!this.abortController.signal.aborted) {
              onComplete();
            }
            break;
          }
          
          case 'TREE_ERROR': {
            if (!this.abortController.signal.aborted) {
              const error = new Error(e.data.error || 'Unknown error in tree builder');
              if (e.data.code) {
                (error as Error & { code?: string }).code = e.data.code;
              }
              onError(error);
            }
            this.cleanup();
            break;
          }
          
          case 'CANCELLED': {
            // Acknowledge cancellation
            if (this.cancelResolver) {
              this.cancelResolver();
              this.cancelResolver = null;
            }
            this.cleanup();
            break;
          }
        }
      };

      this.errorHandler = (error) => {
        if (!this.abortController.signal.aborted) {
          onError(new Error(`Worker error: ${error.message || 'Unknown worker error'}`));
        }
        this.cleanup();
      };

      this.worker.addEventListener('message', this.messageHandler);
      this.worker.addEventListener('error', this.errorHandler);

      // Start processing
      const request: WorkerRequest = {
        type: 'BUILD_TREE',
        allFiles: this.files,
        chunkSize: this.chunkSize,
        selectedFolder: this.selectedFolder,
        expandedNodes: this.expandedNodes,
        id: this.id
      };
      this.worker.postMessage(request);
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Failed to start tree builder'));
      this.cleanup();
    }
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return;

    this.cancelled = true;
    this.abortController.abort();

    // Immediately cleanup to ensure handlers are removed and worker terminated
    this.cleanup();
  }

  private cleanup(): void {
    if (this.worker) {
      // Remove event listeners before terminating to prevent memory leaks
      if (this.messageHandler) {
        this.worker.removeEventListener('message', this.messageHandler);
        this.messageHandler = null;
      }
      if (this.errorHandler) {
        this.worker.removeEventListener('error', this.errorHandler);
        this.errorHandler = null;
      }
      
      this.worker.terminate();
      this.worker = null;
    }
  }
}