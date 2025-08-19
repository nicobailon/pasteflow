/**
 * Dedicated worker pool for tree building operations.
 * Provides deterministic cancellation, queue deduplication, and resource management.
 */

// Declare jest global for test environment detection with precise type
declare const jest: { fn?: unknown } | undefined;

import { UI } from '@constants';
import { StreamingWorkerBase } from './worker-base/streaming-worker-base';
import type { FileData, TreeNode } from '../types/file-types';

interface TreeBuildStartRequest {
  files: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  chunkSize?: number;
}

interface TreeBuildChunk {
  nodes: TreeNode[];
  progress: number;
}

interface TreeBuildDone {
  nodes: TreeNode[];
  progress: number;
}

export class TreeBuilderWorkerPool extends StreamingWorkerBase<
  TreeBuildStartRequest,
  TreeBuildChunk,
  TreeBuildDone
> {
  private initializationError: Error | null = null;
  private isInitialized = false;

  constructor() {
    super(
      '../workers/tree-builder-worker.ts',
      {
        readySignalType: 'READY',
        initRequestType: 'INIT',
        initResponseType: 'READY',
        errorType: 'TREE_ERROR'
      },
      5000, // initTimeoutMs
      2000  // cancelTimeoutMs
    );

    // Auto-initialize on construction
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Trigger initialization by starting a dummy streaming operation
      const handle = this.startStreaming(
        {
          files: [],
          selectedFolder: null,
          expandedNodes: {},
          chunkSize: 1
        },
        {
          onChunk: () => {},
          onComplete: () => { this.isInitialized = true; },
          onError: (error) => { this.initializationError = error; }
        }
      );
      
      // Immediately cancel to just complete initialization
      await handle.cancel();
      this.isInitialized = true;
    } catch (error) {
      this.initializationError = error as Error;
    }
  }

  protected buildInitMessage() {
    return { type: 'INIT' };
  }

  protected buildStartMessage(req: TreeBuildStartRequest, id: string) {
    return {
      type: 'BUILD_TREE',
      id,
      allFiles: req.files,
      chunkSize: req.chunkSize ?? UI.TREE.CHUNK_SIZE,
      selectedFolder: req.selectedFolder,
      expandedNodes: req.expandedNodes
    };
  }

  protected buildCancelMessage(id: string) {
    return { type: 'CANCEL', id };
  }

  protected parseChunk(event: MessageEvent, id: string): TreeBuildChunk | null {
    if (event.data?.type === 'TREE_CHUNK' && event.data?.id === id) {
      return event.data.payload as TreeBuildChunk;
    }
    return null;
  }

  protected parseComplete(event: MessageEvent, id: string): TreeBuildDone | null {
    if (event.data?.type === 'TREE_COMPLETE' && event.data?.id === id) {
      return event.data.payload as TreeBuildDone;
    }
    return null;
  }

  protected parseError(event: MessageEvent, id: string): Error | null {
    if (event.data?.type === 'TREE_ERROR' && event.data?.id === id) {
      const error = new Error(event.data.error || event.data.code || 'TREE_ERROR');
      if (event.data.code) {
        (error as Error & { code?: string }).code = event.data.code;
      }
      return error;
    }
    return null;
  }

  protected isCancelledAck(event: MessageEvent, id: string): boolean {
    return event.data?.type === 'CANCELLED' && event.data?.id === id;
  }

  protected hashRequest(req: TreeBuildStartRequest): string {
    const filesPaths = req.files.map(f => f.path).sort().join('|');
    const expandedKeys = Object.entries(req.expandedNodes || {})
      .filter(([_, expanded]) => expanded)
      .map(([path]) => path)
      .sort()
      .join('|');
    
    return `${filesPaths}:${req.selectedFolder || ''}:${expandedKeys}:${req.chunkSize ?? UI.TREE.CHUNK_SIZE}`;
  }

  // Public API matching existing interface
  buildTree(
    files: FileData[],
    callbacks: {
      onChunk: (chunk: { nodes: TreeNode[]; progress: number }) => void;
      onComplete: () => void;
      onError: (error: Error) => void;
    },
    selectedFolder: string | null = null,
    expandedNodes: Record<string, boolean> = {},
    chunkSize?: number
  ): { cancel: () => Promise<void> } {
    return this.startStreaming(
      {
        files,
        selectedFolder,
        expandedNodes,
        chunkSize
      },
      callbacks
    );
  }

  // Compatibility methods for existing tests/UI
  isReady(): boolean {
    return this.isInitialized && !this.initializationError;
  }

  getInitializationError(): Error | null {
    return this.initializationError;
  }

  async waitForInitialization(): Promise<void> {
    // Wait for initialization to complete
    if (!this.isInitialized && !this.initializationError) {
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.isInitialized || this.initializationError) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }
    
    if (this.initializationError) {
      throw this.initializationError;
    }
  }

  getStatus() {
    return {
      state: this.isReady() ? 'ready' : this.initializationError ? 'error' : 'initializing',
      queueLength: 0, // Base class doesn't expose queue
      hasActiveBuild: false // Base class doesn't expose active state
    };
  }

  async retryInitialization(): Promise<void> {
    this.initializationError = null;
    this.isInitialized = false;
    await this.initialize();
  }

  // Delegate to base class
  async cleanup(): Promise<void> {
    await this.terminate();
  }
}

// Singleton instance for application use
let workerPoolInstance: TreeBuilderWorkerPool | null = null;

export function getTreeBuilderWorkerPool(): TreeBuilderWorkerPool {
  if (!workerPoolInstance) {
    workerPoolInstance = new TreeBuilderWorkerPool();
  }
  return workerPoolInstance;
}

export function resetTreeBuilderWorkerPool(): void {
  if (workerPoolInstance) {
    workerPoolInstance.cleanup().catch(console.error);
    workerPoolInstance = null;
  }
}