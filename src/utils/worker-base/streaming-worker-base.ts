import {
  type HandshakeConfig,
  resolveWorkerUrl,
  addWorkerListeners,
  removeWorkerListeners,
  withTimeout,
} from './worker-common';

interface QueueItem<TStartReq, TChunk, TDone> {
  id: string;
  req: TStartReq;
  callbacks: {
    onChunk: (chunk: TChunk) => void;
    onComplete: (done: TDone) => void;
    onError: (error: Error) => void;
  };
  hash: string;
}

interface ActiveItem<TStartReq, TChunk, TDone> extends QueueItem<TStartReq, TChunk, TDone> {
  cancelled: boolean;
}

type WorkerState = 'uninitialized' | 'initializing' | 'ready' | 'error';

/**
 * Base class for streaming worker operations with one worker.
 * Manages a single worker for streaming operations with chunk-based responses.
 * 
 * Handshake lifecycle:
 * 1. Worker sends readySignalType on boot
 * 2. Optional: Pool sends initRequestType, worker responds with initResponseType
 * 
 * Cancel policy:
 * - Cancel requests wait for CANCELLED ack up to cancelTimeoutMs
 * - After timeout, forced cleanup and proceed to next request
 * 
 * Error handling:
 * - Errors reset state to 'uninitialized' requiring re-initialization
 */
export abstract class StreamingWorkerBase<TStartReq, TChunk, TDone> {
  private worker: Worker | null = null;
  private state: WorkerState = 'uninitialized';
  private queue: QueueItem<TStartReq, TChunk, TDone>[] = [];
  private active: ActiveItem<TStartReq, TChunk, TDone> | null = null;
  private messageHandler?: (e: MessageEvent) => void;
  private errorHandler?: (e: ErrorEvent) => void;

  constructor(
    protected workerRelativePath: string,
    protected handshake: HandshakeConfig,
    protected initTimeoutMs: number,
    protected cancelTimeoutMs: number
  ) {}

  protected abstract buildInitMessage(): { type: string };

  protected abstract buildStartMessage(
    req: TStartReq,
    id: string
  ): { type: string; id: string; [key: string]: unknown };

  protected abstract buildCancelMessage(id: string): { type: string; id: string };

  protected abstract parseChunk(event: MessageEvent, id: string): TChunk | null;

  protected abstract parseComplete(event: MessageEvent, id: string): TDone | null;

  protected abstract parseError(event: MessageEvent, id: string): Error | null;

  protected abstract isCancelledAck(event: MessageEvent, id: string): boolean;

  protected hashRequest(req: TStartReq): string {
    return JSON.stringify(req);
  }

  private async ensureReady(): Promise<void> {
    if (this.state === 'ready') {
      return;
    }

    if (this.state === 'initializing') {
      // Wait for ongoing initialization
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = this.initTimeoutMs / 10;
        const checkState = setInterval(() => {
          attempts++;
          if (this.state === 'ready') {
            clearInterval(checkState);
            resolve();
          } else if (this.state === 'error' || attempts >= maxAttempts) {
            clearInterval(checkState);
            reject(new Error('Worker initialization failed'));
          }
        }, 10);
      });
    }

    this.state = 'initializing';

    try {
      const url = resolveWorkerUrl(this.workerRelativePath);
      this.worker = new Worker(url, { type: 'module' });

      // Create a promise that resolves when initialization is complete
      const initPromise = new Promise<void>((resolve, reject) => {
        let resolved = false;
        
        const handlers = {
          message: (e: MessageEvent) => {
            if (resolved) return;
            
            if (e.data?.type === this.handshake.readySignalType) {
              // Send init if configured
              if (this.handshake.initRequestType) {
                this.worker?.postMessage(this.buildInitMessage());
                // Don't resolve yet - wait for init response
              } else {
                // No init required, we're ready
                resolved = true;
                removeWorkerListeners(this.worker!, handlers);
                resolve();
              }
            } else if (e.data?.type === this.handshake.initResponseType) {
              // Init response received
              resolved = true;
              removeWorkerListeners(this.worker!, handlers);
              resolve();
            }
          },
          error: (e: ErrorEvent) => {
            if (resolved) return;
            resolved = true;
            removeWorkerListeners(this.worker!, handlers);
            reject(new Error(`Worker error during init: ${e.message}`));
          }
        };

        addWorkerListeners(this.worker!, handlers);
      });

      await withTimeout(initPromise, this.initTimeoutMs, 'Worker initialization');
      this.state = 'ready';
    } catch (error) {
      this.state = 'error';
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      throw error;
    }
  }

  private cleanupActive(): void {
    if (this.active && this.worker && this.messageHandler) {
      removeWorkerListeners(this.worker, {
        message: this.messageHandler,
        error: this.errorHandler
      });
    }
    this.active = null;
    this.messageHandler = undefined;
    this.errorHandler = undefined;
  }

  private async processNext(): Promise<void> {
    if (this.active || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) {
      return;
    }

    try {
      await this.ensureReady();
    } catch (error) {
      // Call error callbacks for all queued items
      item.callbacks.onError(error as Error);
      for (const queuedItem of this.queue) {
        queuedItem.callbacks.onError(error as Error);
      }
      this.queue = [];
      return;
    }

    if (!this.worker) {
      item.callbacks.onError(new Error('Worker not available'));
      return;
    }

    this.active = { ...item, cancelled: false };

    this.messageHandler = (e: MessageEvent) => {
      if (!this.active) return;

      const chunk = this.parseChunk(e, this.active.id);
      if (chunk !== null) {
        this.active.callbacks.onChunk(chunk);
        return;
      }

      const complete = this.parseComplete(e, this.active.id);
      if (complete !== null) {
        this.active.callbacks.onComplete(complete);
        this.cleanupActive();
        this.processNext();
        return;
      }

      const error = this.parseError(e, this.active.id);
      if (error !== null) {
        this.active.callbacks.onError(error);
        this.cleanupActive();
        this.state = 'uninitialized';
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        this.processNext();
        return;
      }

      if (this.isCancelledAck(e, this.active.id)) {
        this.cleanupActive();
        this.processNext();
        return;
      }
    };

    this.errorHandler = (e: ErrorEvent) => {
      if (!this.active) return;
      
      this.active.callbacks.onError(new Error(e.message));
      this.cleanupActive();
      this.state = 'uninitialized';
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.processNext();
    };

    addWorkerListeners(this.worker, {
      message: this.messageHandler,
      error: this.errorHandler
    });

    this.worker.postMessage(this.buildStartMessage(this.active.req, this.active.id));
  }

  private async cancelActiveIfMatch(id: string): Promise<void> {
    if (!this.active || this.active.id !== id) {
      return;
    }

    this.active.cancelled = true;

    if (this.worker) {
      this.worker.postMessage(this.buildCancelMessage(id));

      try {
        await withTimeout(
          new Promise<void>((resolve) => {
            const checkCancel = setInterval(() => {
              if (!this.active || this.active.id !== id) {
                clearInterval(checkCancel);
                resolve();
              }
            }, 10);
          }),
          this.cancelTimeoutMs,
          'Cancel acknowledgment'
        );
      } catch {
        // Timeout - force cleanup
        this.cleanupActive();
        this.processNext();
      }
    } else {
      this.cleanupActive();
      this.processNext();
    }
  }

  public startStreaming(
    req: TStartReq,
    callbacks: {
      onChunk: (chunk: TChunk) => void;
      onComplete: (done: TDone) => void;
      onError: (error: Error) => void;
    }
  ): { cancel: () => Promise<void> } {
    const id = `stream-${Date.now()}-${Math.random()}`;
    const hash = this.hashRequest(req);

    // Replace policy: remove existing items with same hash
    this.queue = this.queue.filter(item => item.hash !== hash);

    const item: QueueItem<TStartReq, TChunk, TDone> = {
      id,
      req,
      callbacks,
      hash
    };

    this.queue.push(item);

    if (!this.active) {
      this.processNext();
    }

    return {
      cancel: () => this.cancelActiveIfMatch(id)
    };
  }

  public async terminate(): Promise<void> {
    // Cancel active operation
    if (this.active) {
      this.active.callbacks.onError(new Error('Worker terminated'));
      this.cleanupActive();
    }

    // Clear queue
    for (const item of this.queue) {
      item.callbacks.onError(new Error('Worker terminated'));
    }
    this.queue = [];

    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.state = 'uninitialized';
  }
}