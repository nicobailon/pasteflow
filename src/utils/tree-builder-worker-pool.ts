/**
 * Dedicated worker pool for tree building operations.
 * Provides deterministic cancellation, queue deduplication, and resource management.
 */

import { UI } from '../constants/app-constants';
import type { FileData, TreeNode } from '../types/file-types';

// Worker message types for type safety
type ReadyMessage = { type: 'READY' };
type ChunkMessage = { type: 'TREE_CHUNK'; id: string; payload: { nodes: TreeNode[]; progress: number } };
type CompleteMessage = { type: 'TREE_COMPLETE'; id: string; payload: { nodes: TreeNode[]; progress: number } };
type ErrorMessage = { type: 'TREE_ERROR'; id: string; code: string; error: string };
type CancelledMessage = { type: 'CANCELLED'; id: string };

type WorkerMessage = ReadyMessage | ChunkMessage | CompleteMessage | ErrorMessage | CancelledMessage;

type WorkerRequest =
  | { type: 'INIT' }
  | { type: 'CANCEL'; id: string }
  | {
      type: 'BUILD_TREE';
      id: string;
      allFiles: FileData[];
      chunkSize: number;
      selectedFolder: string | null;
      expandedNodes: Record<string, boolean>;
    };

interface TreeBuildError extends Error {
  code?: string;
}

interface TreeBuildRequest {
  id: string;
  files: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  chunkSize?: number;
}

interface TreeBuildCallbacks {
  onChunk: (chunk: { nodes: TreeNode[]; progress: number }) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

interface TreeBuildHandle {
  cancel: () => Promise<void>;
}

interface QueuedRequest {
  request: TreeBuildRequest;
  callbacks: TreeBuildCallbacks;
  hash: string;
}

interface ActiveBuild {
  worker: Worker;
  request: TreeBuildRequest;
  callbacks: TreeBuildCallbacks;
  cancelled: boolean;
  cancelResolver?: () => void;
  messageHandler?: (event: MessageEvent) => void;
  errorHandler?: (event: ErrorEvent) => void;
}

type PoolState = 'uninitialized' | 'initializing' | 'ready' | 'error';

export class TreeBuilderWorkerPool {
  private state: PoolState = 'uninitialized';
  private worker: Worker | null = null;
  private queue: QueuedRequest[] = [];
  private activeBuild: ActiveBuild | null = null;
  private nextRequestId = 1;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // Store the initialization promise so we can await it later
    // Don't let initialization errors crash the constructor
    this.initializationPromise = this.initialize().catch(error => {
      console.error('Worker pool initialization failed in constructor:', error);
      // The error is logged but not re-thrown, allowing the pool to exist
      // and potentially retry initialization later
    });
  }

  /**
   * Initialize the pool by pre-warming a worker
   */
  private async initialize(): Promise<void> {
    if (this.state === 'initializing' || this.state === 'ready') {
      return;
    }
    
    this.state = 'initializing';
    
    try {
      
      this.worker = await this.createWorker();
      this.state = 'ready';
    } catch (error) {
      console.error('Failed to initialize tree builder worker pool:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        currentURL: typeof window !== 'undefined' ? window.location.href : 'unknown',
        protocol: typeof window !== 'undefined' ? window.location.protocol : 'unknown'
      });
      
      this.state = 'error';
      throw error; // Re-throw to properly reject the promise
    }
  }

  /**
   * Create a new worker instance
   */
  private async createWorker(): Promise<Worker> {
    try {
      let worker: Worker;
      
      // Check if we're in development mode (Vite dev server)
      const isDevelopment = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      
      
      try {
        // Try the standard way first - this should work with Vite
        const workerUrl = new URL('../workers/tree-builder-worker.ts', import.meta.url);
        worker = new Worker(workerUrl, { type: 'module' });
      } catch (urlError) {
        console.error('Failed to create worker with URL constructor:', urlError);
        
        // Try different fallback approaches
        if (typeof window !== 'undefined') {
          if (window.location.protocol === 'file:') {
            // In production Electron, workers are bundled in assets
            try {
              // Try with hash-based filename from build
              const scripts = document.getElementsByTagName('script');
              let workerPath = '';
              
              for (let i = 0; i < scripts.length; i++) {
                const src = scripts[i].src;
                if (src && src.includes('tree-builder-worker')) {
                  workerPath = src;
                  break;
                }
              }
              
              if (!workerPath) {
                // Fallback to expected pattern
                workerPath = './assets/tree-builder-worker.js';
              }
              
              console.log('Attempting Electron production fallback with path:', workerPath);
              worker = new Worker(workerPath, { type: 'module' });
            } catch (electronError) {
              console.error('Electron fallback failed:', electronError);
              throw electronError;
            }
          } else if (isDevelopment) {
            // Development server fallback
            try {
              const devWorkerPath = '/src/workers/tree-builder-worker.ts';
              console.log('Attempting development server fallback with path:', devWorkerPath);
              worker = new Worker(devWorkerPath, { type: 'module' });
            } catch (devError) {
              console.error('Development fallback failed:', devError);
              throw devError;
            }
          } else {
            throw urlError;
          }
        } else {
          throw urlError;
        }
      }
      
      // Wait for worker to be ready
      return new Promise((resolve, reject) => {
        let isResolved = false;
        
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            worker.terminate();
            reject(new Error('Worker initialization timeout - worker did not respond with READY'));
          }
        }, UI.TREE.INIT_TIMEOUT_MS);
        
        const handleMessage = (event: MessageEvent) => {
          const message = event.data as WorkerMessage;
          if (message.type === 'READY' && !isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            resolve(worker);
          }
        };
        
        const handleError = (error: ErrorEvent) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            const errorMessage = error.message || 'Worker failed to load';
            console.error('Worker error during initialization:', error);
            reject(new Error(errorMessage));
          }
        };
        
        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);
        
        // Send init message
        try {
          const initMessage: WorkerRequest = { type: 'INIT' };
          worker.postMessage(initMessage);
        } catch (postError) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            console.error('Failed to post INIT message to worker:', postError);
            reject(new Error('Failed to communicate with worker'));
          }
        }
      });
    } catch (error) {
      console.error('Failed to create Worker:', error);
      throw new Error(`Worker instantiation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start a streaming tree build operation
   */
  startStreamingBuild(
    request: Omit<TreeBuildRequest, 'id'>,
    callbacks: TreeBuildCallbacks
  ): TreeBuildHandle {
    const id = `tree-build-${this.nextRequestId++}`;
    const fullRequest: TreeBuildRequest = {
      ...request,
      id,
      chunkSize: request.chunkSize ?? UI.TREE.CHUNK_SIZE
    };
    
    // Calculate hash for deduplication
    const hash = this.calculateRequestHash(fullRequest);
    
    // Check if identical request is already queued
    const existingIndex = this.queue.findIndex(q => q.hash === hash);
    if (existingIndex >= 0) {
      // Replace the existing queued request with the new one
      this.queue[existingIndex] = { request: fullRequest, callbacks, hash };
    } else {
      // Add to queue
      this.queue.push({ request: fullRequest, callbacks, hash });
    }
    
    // Process queue if not busy
    if (!this.activeBuild) {
      this.processQueue();
    }
    
    // Return handle for cancellation
    return {
      cancel: async () => {
        await this.cancelRequest(id);
      }
    };
  }

  /**
   * Cancel a specific request
   */
  private async cancelRequest(id: string): Promise<void> {
    // Check if request is queued
    const queueIndex = this.queue.findIndex(q => q.request.id === id);
    if (queueIndex >= 0) {
      // Remove from queue
      this.queue.splice(queueIndex, 1);
      return;
    }
    
    // Check if request is active
    if (this.activeBuild && this.activeBuild.request.id === id) {
      await this.cancelActiveBuild();
    }
  }

  /**
   * Cancel the active build with deterministic cleanup
   */
  private async cancelActiveBuild(): Promise<void> {
    if (!this.activeBuild || !this.worker) return;
    
    const build = this.activeBuild;
    build.cancelled = true;
    
    // Send cancel message to worker
    const cancelMessage: WorkerRequest = { type: 'CANCEL', id: build.request.id };
    this.worker.postMessage(cancelMessage);
    
    // Wait for CANCELLED acknowledgement with timeout
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('Tree build cancellation timeout, forcing cleanup');
        this.cleanupActiveBuild();
        resolve();
      }, UI.TREE.CANCEL_TIMEOUT_MS);
      
      // Store resolver to call when CANCELLED is received
      build.cancelResolver = () => {
        clearTimeout(timeout);
        this.cleanupActiveBuild();
        resolve();
      };
    });
  }

  /**
   * Clean up the active build
   */
  private cleanupActiveBuild(): void {
    if (this.activeBuild) {
      // Remove all listeners for this build
      if (this.worker && this.activeBuild.messageHandler) {
        this.worker.removeEventListener('message', this.activeBuild.messageHandler);
      }
      if (this.worker && this.activeBuild.errorHandler) {
        this.worker.removeEventListener('error', this.activeBuild.errorHandler);
      }
      
      this.activeBuild = null;
      
      // Process next item in queue
      this.processQueue();
    }
  }

  /**
   * Process the next item in the queue
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.activeBuild) return;
    
    // Wait for initialization if it's in progress
    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
      } catch (error) {
        console.error('Worker pool initialization failed while processing queue:', error);
      }
      // Clear the promise after it completes
      this.initializationPromise = null;
    }
    
    // Check if worker is ready after initialization
    if (this.state !== 'ready') {
      // Try to initialize if not already done
      if (this.state === 'uninitialized') {
        this.initializationPromise = this.initialize();
        try {
          await this.initializationPromise;
        } catch (error) {
          console.error('Failed to initialize worker pool:', error);
        }
        this.initializationPromise = null;
      }
    }
    
    // Re-check state after potential initialization
    if (this.state !== 'ready') {
      // Failed to initialize, notify all queued requests
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        item.callbacks.onError(new Error('Worker pool initialization failed'));
      }
      return;
    }
    
    if (!this.worker) {
      // Try to recreate worker
      try {
        this.worker = await this.createWorker();
      } catch (error) {
        console.error('Failed to create worker:', error);
        const item = this.queue.shift();
        if (item) {
          item.callbacks.onError(error as Error);
        }
        return;
      }
    }
    
    const item = this.queue.shift();
    if (!item) return;
    
    // Start the build
    this.activeBuild = {
      worker: this.worker,
      request: item.request,
      callbacks: item.callbacks,
      cancelled: false
    };
    
    // Set up message handlers
    const messageHandler = (event: MessageEvent) => {
      const message = event.data as WorkerMessage;
      if (!this.activeBuild) return;
      if (message.type === 'READY') return; // Ignore READY messages during active builds
      if ('id' in message && message.id !== this.activeBuild.request.id) return;
      
      switch (message.type) {
        case 'TREE_CHUNK': {
          if (!this.activeBuild.cancelled) {
            const chunkMsg = message as ChunkMessage;
            this.activeBuild.callbacks.onChunk({
              nodes: chunkMsg.payload.nodes,
              progress: chunkMsg.payload.progress
            });
          }
          break;
        }
          
        case 'TREE_COMPLETE': {
          if (!this.activeBuild.cancelled) {
            const completeMsg = message as CompleteMessage;
            this.activeBuild.callbacks.onChunk({
              nodes: completeMsg.payload.nodes,
              progress: completeMsg.payload.progress
            });
            this.activeBuild.callbacks.onComplete();
          }
          this.cleanupActiveBuild();
          break;
        }
          
        case 'TREE_ERROR': {
          if (!this.activeBuild.cancelled) {
            const errorMsg = message as ErrorMessage;
            const error: TreeBuildError = new Error(errorMsg.error || 'Tree build error');
            error.code = errorMsg.code;
            this.activeBuild.callbacks.onError(error);
          }
          this.cleanupActiveBuild();
          break;
        }
          
        case 'CANCELLED': {
          if (this.activeBuild.cancelResolver) {
            this.activeBuild.cancelResolver();
          }
          break;
        }
      }
    };
    
    const errorHandler = (event: ErrorEvent) => {
      if (this.activeBuild && !this.activeBuild.cancelled) {
        this.activeBuild.callbacks.onError(new Error(event.message));
      }
      this.cleanupActiveBuild();
      
      // Recreate worker for next request
      this.worker = null;
      this.state = 'uninitialized';
    };
    
    // Store handlers on the active build so we can remove them later
    this.activeBuild.messageHandler = messageHandler;
    this.activeBuild.errorHandler = errorHandler;
    
    this.worker.addEventListener('message', messageHandler);
    this.worker.addEventListener('error', errorHandler);
    
    // Send the build request
    const buildMessage: WorkerRequest = {
      type: 'BUILD_TREE',
      id: item.request.id,
      allFiles: item.request.files,
      chunkSize: item.request.chunkSize ?? UI.TREE.CHUNK_SIZE,
      selectedFolder: item.request.selectedFolder,
      expandedNodes: item.request.expandedNodes
    };
    this.worker.postMessage(buildMessage);
  }

  /**
   * Calculate a hash for request deduplication
   */
  private calculateRequestHash(request: TreeBuildRequest): string {
    const filesPaths = request.files.map(f => f.path).sort().join('|');
    const expandedKeys = Object.entries(request.expandedNodes)
      .filter(([_, expanded]) => expanded)
      .map(([path]) => path)
      .sort()
      .join('|');
    
    return `${filesPaths}:${request.selectedFolder || ''}:${expandedKeys}`;
  }

  /**
   * Get the current status of the pool
   */
  getStatus(): {
    state: PoolState;
    queueLength: number;
    hasActiveBuild: boolean;
  } {
    return {
      state: this.state,
      queueLength: this.queue.length,
      hasActiveBuild: this.activeBuild !== null
    };
  }

  /**
   * Terminate the pool and clean up resources
   */
  async terminate(): Promise<void> {
    // Cancel active build
    if (this.activeBuild) {
      await this.cancelActiveBuild();
    }
    
    // Clear queue
    this.queue = [];
    
    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    this.state = 'uninitialized';
  }
}

// Export singleton instance
let poolInstance: TreeBuilderWorkerPool | null = null;

export function getTreeBuilderWorkerPool(): TreeBuilderWorkerPool {
  if (!poolInstance) {
    poolInstance = new TreeBuilderWorkerPool();
  }
  return poolInstance;
}

export function resetTreeBuilderWorkerPool(): void {
  if (poolInstance) {
    poolInstance.terminate();
    poolInstance = null;
  }
}