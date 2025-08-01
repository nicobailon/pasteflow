import type { FileData, TreeNode } from '../types/file-types';

export interface TreeChunk {
  nodes: TreeNode[];
  progress: number;
}

interface WorkerMessage {
  type: 'TREE_CHUNK' | 'TREE_COMPLETE' | 'TREE_ERROR';
  id: string;
  payload?: TreeChunk;
  error?: string;
}

export class StreamingTreeBuilder {
  private worker: Worker | null = null;
  private abortController = new AbortController();
  private id: string;

  constructor(
    private files: FileData[],
    private chunkSize = 500,
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
      this.worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
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
              onError(new Error(e.data.error || 'Unknown error in tree builder'));
            }
            this.cleanup();
            break;
          }
        }
      });

      this.worker.addEventListener('error', (error) => {
        if (!this.abortController.signal.aborted) {
          onError(new Error(`Worker error: ${error.message || 'Unknown worker error'}`));
        }
        this.cleanup();
      });

      // Start processing
      this.worker.postMessage({
        allFiles: this.files,
        chunkSize: this.chunkSize,
        selectedFolder: this.selectedFolder,
        expandedNodes: this.expandedNodes,
        id: this.id
      });
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Failed to start tree builder'));
      this.cleanup();
    }
  }

  cancel(): void {
    this.abortController.abort();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}