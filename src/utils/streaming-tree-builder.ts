import type { FileData, TreeNode } from '../types/file-types';
import { UI } from '../constants/app-constants';

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
    private chunkSize = UI.TREE.CHUNK_SIZE,
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
      this.worker = new Worker(
        new URL('../workers/tree-builder-worker.ts', import.meta.url),
        { type: 'module' }
      );

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
            if (!this.abortController.signal.aborted) {
              onComplete();
            }
            this.cleanup();
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
    
    // If no worker, just cleanup
    if (!this.worker) {
      this.cleanup();
      return;
    }
    
    // Send cancel message and wait for acknowledgement
    const cancelRequest: WorkerRequest = {
      type: 'CANCEL',
      id: this.id
    };
    
    this.worker.postMessage(cancelRequest);
    
    // Wait for CANCELLED acknowledgement with timeout
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('Tree builder cancellation timeout, forcing cleanup');
        this.cleanup();
        resolve();
      }, UI.TREE.CANCEL_TIMEOUT_MS);
      
      this.cancelResolver = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
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