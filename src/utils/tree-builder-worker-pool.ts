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
  private initializationAttempts = 0;
  private readonly maxInitializationAttempts = 3;
  private readonly retryDelay = 1000;
  private initializationError: Error | null = null;

  constructor() {
    // Store the initialization promise so we can await it later
    // Implements retry mechanism for initialization failures
    this.initializationPromise = this.initializeWithRetry().catch(error => {
      console.error('Worker pool initialization failed after all retries:', error);
      this.state = 'error';
      // Store error for consumer access
      this.initializationError = error instanceof Error ? error : new Error(String(error));
      // Don't re-throw - let consumers check via isReady() and getInitializationError()
    });
  }

  /**
   * Initialize the pool with retry mechanism
   */
  private async initializeWithRetry(): Promise<void> {
    while (this.initializationAttempts < this.maxInitializationAttempts) {
      try {
        await this.initialize();
        return;
      } catch (error) {
        this.initializationAttempts++;
        
        if (this.initializationAttempts >= this.maxInitializationAttempts) {
          throw error;
        }
        
        console.warn(
          `Worker pool initialization attempt ${this.initializationAttempts} failed, retrying in ${this.retryDelay}ms...`,
          error
        );
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
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
        currentURL: typeof window === 'undefined' ? 'unknown' : window.location.href,
        protocol: typeof window === 'undefined' ? 'unknown' : window.location.protocol
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
      const worker = await this.instantiateWorker();
      return this.waitForWorkerReady(worker);
    } catch (error) {
      console.error('Failed to create Worker:', error);
      throw new Error(`Worker instantiation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Instantiate a worker with fallback strategies
   */
  private async instantiateWorker(): Promise<Worker> {
    try {
      return this.createWorkerWithStandardUrl();
    } catch (urlError) {
      console.error('Failed to create worker with URL constructor:', urlError);
      return this.createWorkerWithFallbacks(urlError);
    }
  }

  /**
   * Create worker using standard URL approach
   */
  private createWorkerWithStandardUrl(): Worker {
    const workerUrl = new URL('../workers/tree-builder-worker.ts', import.meta.url);
    return new Worker(workerUrl, { type: 'module' });
  }

  /**
   * Create worker using fallback strategies
   */
  private createWorkerWithFallbacks(urlError: unknown): Worker {
    if (typeof window === 'undefined') {
      throw urlError;
    }

    if (window.location.protocol === 'file:') {
      return this.createElectronProductionWorker();
    }

    const isDevelopment = this.isDevelopmentMode();
    if (isDevelopment) {
      return this.createDevelopmentWorker();
    }

    throw urlError;
  }

  /**
   * Check if we're in development mode
   */
  private isDevelopmentMode(): boolean {
    return typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  }

  /**
   * Create worker for Electron production environment
   */
  private createElectronProductionWorker(): Worker {
    try {
      const workerPath = this.findElectronWorkerPath();
      console.log('Attempting Electron production fallback with path:', workerPath);
      return new Worker(workerPath, { type: 'module' });
    } catch (electronError) {
      console.error('Electron fallback failed:', electronError);
      throw electronError;
    }
  }

  /**
   * Find the correct worker path in Electron production
   */
  private findElectronWorkerPath(): string {
    const scripts = document.querySelectorAll('script');
    
    for (const script of scripts) {
      const src = script.src;
      if (src && src.includes('tree-builder-worker')) {
        return src;
      }
    }
    
    return './assets/tree-builder-worker.js';
  }

  /**
   * Create worker for development environment
   */
  private createDevelopmentWorker(): Worker {
    try {
      const devWorkerPath = '/src/workers/tree-builder-worker.ts';
      console.log('Attempting development server fallback with path:', devWorkerPath);
      return new Worker(devWorkerPath, { type: 'module' });
    } catch (devError) {
      console.error('Development fallback failed:', devError);
      throw devError;
    }
  }

  /**
   * Wait for worker to signal it's ready
   */
  private async waitForWorkerReady(worker: Worker): Promise<Worker> {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      
      const timeout = this.createWorkerTimeout(worker, () => {
        if (!isResolved) {
          isResolved = true;
          reject(new Error('Worker initialization timeout - worker did not respond with READY'));
        }
      });
      
      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
      };
      
      const handleMessage = (event: MessageEvent) => {
        const message = event.data as WorkerMessage;
        if (message.type === 'READY' && !isResolved) {
          isResolved = true;
          cleanup();
          resolve(worker);
        }
      };
      
      const handleError = (error: ErrorEvent) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          const errorMessage = error.message || 'Worker failed to load';
          console.error('Worker error during initialization:', error);
          reject(new Error(errorMessage));
        }
      };
      
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      
      this.sendInitMessageToWorker(worker, isResolved, cleanup, reject);
    });
  }

  /**
   * Create timeout for worker initialization
   */
  private createWorkerTimeout(worker: Worker, onTimeout: () => void): NodeJS.Timeout {
    return setTimeout(() => {
      worker.terminate();
      onTimeout();
    }, UI.TREE.INIT_TIMEOUT_MS);
  }

  /**
   * Send initialization message to worker
   */
  private sendInitMessageToWorker(
    worker: Worker, 
    isResolved: boolean, 
    cleanup: () => void, 
    reject: (error: Error) => void
  ): void {
    try {
      const initMessage: WorkerRequest = { type: 'INIT' };
      worker.postMessage(initMessage);
    } catch (postError) {
      if (!isResolved) {
        cleanup();
        console.error('Failed to post INIT message to worker:', postError);
        reject(new Error('Failed to communicate with worker'));
      }
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
    
    // Check if initialization has failed and report immediately
    if (this.state === 'error' && this.initializationError) {
      // Report error immediately rather than queuing
      const errorMessage = this.initializationError.message;
      setTimeout(() => {
        callbacks.onError(new Error(
          `Worker pool initialization failed: ${errorMessage}`
        ));
      }, 0);
      
      // Return a no-op handle since the request won't be processed
      return {
        cancel: async () => {
          // No-op - request was never queued
        }
      };
    }
    
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
    
    await this.ensureWorkerPoolReady();
    
    if (this.state !== 'ready') {
      this.notifyAllQueuedRequestsOfFailure();
      return;
    }
    
    await this.ensureWorkerExists();
    
    const item = this.queue.shift();
    if (!item) return;
    
    this.startBuildExecution(item);
  }

  /**
   * Ensure the worker pool is properly initialized
   */
  private async ensureWorkerPoolReady(): Promise<void> {
    await this.waitForPendingInitialization();
    await this.initializeIfNeeded();
  }

  /**
   * Wait for any pending initialization to complete
   */
  private async waitForPendingInitialization(): Promise<void> {
    if (!this.initializationPromise) return;

    try {
      await this.initializationPromise;
    } catch (error) {
      console.error('Worker pool initialization failed while processing queue:', error);
    }
    
    this.initializationPromise = null;
  }

  /**
   * Initialize the pool if it's uninitialized
   */
  private async initializeIfNeeded(): Promise<void> {
    if (this.state !== 'ready' && this.state === 'uninitialized') {
      this.initializationPromise = this.initialize();
      
      try {
        await this.initializationPromise;
      } catch (error) {
        console.error('Failed to initialize worker pool:', error);
      }
      
      this.initializationPromise = null;
    }
  }

  /**
   * Notify all queued requests that initialization failed
   */
  private notifyAllQueuedRequestsOfFailure(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.callbacks.onError(new Error('Worker pool initialization failed'));
    }
  }

  /**
   * Ensure a worker exists, creating one if necessary
   */
  private async ensureWorkerExists(): Promise<void> {
    if (this.worker) return;

    try {
      this.worker = await this.createWorker();
    } catch (error) {
      console.error('Failed to create worker:', error);
      const item = this.queue.shift();
      if (item) {
        item.callbacks.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Start executing a build request
   */
  private startBuildExecution(item: QueuedRequest): void {
    this.activeBuild = {
      worker: this.worker!,
      request: item.request,
      callbacks: item.callbacks,
      cancelled: false
    };
    
    const { messageHandler, errorHandler } = this.createBuildHandlers();
    
    this.activeBuild.messageHandler = messageHandler;
    this.activeBuild.errorHandler = errorHandler;
    
    this.worker!.addEventListener('message', messageHandler);
    this.worker!.addEventListener('error', errorHandler);
    
    this.sendBuildRequestToWorker(item.request);
  }

  /**
   * Create message handler for build execution
   */
  private createMessageHandler(): (event: MessageEvent) => void {
    return (event: MessageEvent) => {
      const message = event.data as WorkerMessage;
      if (!this.activeBuild) return;
      if (message.type === 'READY') return;
      if ('id' in message && message.id !== this.activeBuild.request.id) return;
      
      this.handleWorkerMessage(message);
    };
  }

  /**
   * Create error handler for build execution
   */
  private createErrorHandler(): (event: ErrorEvent) => void {
    return (event: ErrorEvent) => {
      if (this.activeBuild && !this.activeBuild.cancelled) {
        this.activeBuild.callbacks.onError(new Error(event.message));
      }
      this.cleanupActiveBuild();
      
      this.worker = null;
      this.state = 'uninitialized';
    };
  }

  /**
   * Create message and error handlers for build execution
   */
  private createBuildHandlers(): {
    messageHandler: (event: MessageEvent) => void;
    errorHandler: (event: ErrorEvent) => void;
  } {
    return {
      messageHandler: this.createMessageHandler(),
      errorHandler: this.createErrorHandler()
    };
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(message: WorkerMessage): void {
    if (!this.activeBuild) return;

    switch (message.type) {
      case 'TREE_CHUNK': {
        this.handleChunkMessage(message as ChunkMessage);
        break;
      }
      case 'TREE_COMPLETE': {
        this.handleCompleteMessage(message as CompleteMessage);
        break;
      }
      case 'TREE_ERROR': {
        this.handleErrorMessage(message as ErrorMessage);
        break;
      }
      case 'CANCELLED': {
        this.handleCancelledMessage();
        break;
      }
    }
  }

  /**
   * Handle chunk message from worker
   */
  private handleChunkMessage(message: ChunkMessage): void {
    if (this.activeBuild && !this.activeBuild.cancelled) {
      this.activeBuild.callbacks.onChunk({
        nodes: message.payload.nodes,
        progress: message.payload.progress
      });
    }
  }

  /**
   * Handle complete message from worker
   */
  private handleCompleteMessage(message: CompleteMessage): void {
    if (this.activeBuild && !this.activeBuild.cancelled) {
      this.activeBuild.callbacks.onChunk({
        nodes: message.payload.nodes,
        progress: message.payload.progress
      });
      this.activeBuild.callbacks.onComplete();
    }
    this.cleanupActiveBuild();
  }

  /**
   * Handle error message from worker
   */
  private handleErrorMessage(message: ErrorMessage): void {
    if (this.activeBuild && !this.activeBuild.cancelled) {
      const error: TreeBuildError = new Error(message.error || 'Tree build error');
      error.code = message.code;
      this.activeBuild.callbacks.onError(error);
    }
    this.cleanupActiveBuild();
  }

  /**
   * Handle cancelled message from worker
   */
  private handleCancelledMessage(): void {
    if (this.activeBuild?.cancelResolver) {
      this.activeBuild.cancelResolver();
    }
  }

  /**
   * Send build request to worker
   */
  private sendBuildRequestToWorker(request: TreeBuildRequest): void {
    const buildMessage: WorkerRequest = {
      type: 'BUILD_TREE',
      id: request.id,
      allFiles: request.files,
      chunkSize: request.chunkSize ?? UI.TREE.CHUNK_SIZE,
      selectedFolder: request.selectedFolder,
      expandedNodes: request.expandedNodes
    };
    this.worker!.postMessage(buildMessage);
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
   * Check if the worker pool is ready for use
   */
  isReady(): boolean {
    return this.state === 'ready';
  }

  /**
   * Get the initialization error if one occurred
   */
  getInitializationError(): Error | null {
    return this.initializationError;
  }

  /**
   * Wait for initialization to complete (success or failure)
   */
  async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Get the current status of the pool
   */
  getStatus(): {
    state: PoolState;
    queueLength: number;
    hasActiveBuild: boolean;
    initializationError: Error | null;
  } {
    return {
      state: this.state,
      queueLength: this.queue.length,
      hasActiveBuild: this.activeBuild !== null,
      initializationError: this.initializationError
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

  /**
   * Public method to retry initialization if it previously failed
   */
  public async retryInitialization(): Promise<void> {
    if (this.state === 'ready') {
      return;
    }
    
    // Reset attempts counter and error state for manual retry
    this.initializationAttempts = 0;
    this.state = 'uninitialized';
    this.initializationError = null;
    
    try {
      await this.initializeWithRetry();
    } catch (error) {
      console.error('Manual retry of worker pool initialization failed:', error);
      // Store the error for consumer access
      this.initializationError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
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