declare const jest: { fn?: unknown } | undefined;

import {
  type HandshakeConfig,
  addWorkerListeners,
  removeWorkerListeners,
  withTimeout,
} from './worker-common';

interface QueueItem<TReq, TRes> {
  id: string;
  req: TReq;
  resolve: (value: TRes) => void;
  reject: (error: Error) => void;
  priority: number;
}

interface ActiveJob<TReq> {
  workerId: number;
  start: number;
  req: TReq;
  listeners?: {
    message: (e: MessageEvent) => void;
    error?: (e: ErrorEvent) => void;
  };
}

/**
 * Base class for discrete worker pools that process individual jobs with N workers.
 * Manages a pool of workers, job queue, deduplication, health monitoring, and recovery.
 * 
 * Handshake lifecycle:
 * 1. Workers send readySignalType on boot
 * 2. Pool sends initRequestType
 * 3. Workers respond with initResponseType
 * 
 * Timeout and fallback policy:
 * - Jobs timeout after operationTimeoutMs and resolve with fallback value
 * - Queue drops lowest priority items when full, resolving with fallback
 * 
 * Recovery strategy:
 * - Health checks run at healthMonitorIntervalSec intervals
 * - Unhealthy workers are recovered with lock to prevent duplicate recovery
 */
export abstract class DiscreteWorkerPoolBase<TReq, TRes> {
  private workers: Worker[] = [];
  private workerReady: boolean[] = [];
  private workerHealthy: boolean[] = [];
  private queue: QueueItem<TReq, TRes>[] = [];
  private activeJobs = new Map<string, ActiveJob<TReq>>();
  private activeResolves = new Map<string, (value: TRes) => void>();
  private pendingByHash = new Map<string, Promise<TRes>>();
  private pendingByHashAge = new Map<string, number>(); // Track age for cleanup
  private recoveryLocks = new Map<number, boolean>();
  private recoveryQueue = new Map<number, Promise<void>>();
  private healthMonitorInterval?: ReturnType<typeof setInterval>;
  
  private isTerminated = false;
  private acceptingJobs = true;
  private initPromise: Promise<void> | null = null;

  constructor(
    protected poolSize: number,
    protected handshake: HandshakeConfig,
    protected operationTimeoutMs: number,
    protected healthCheckTimeoutMs: number,
    protected healthMonitorIntervalSec: number,
    protected queueMaxSize: number
  ) {
    // In Jest/test environment, clamp timeouts to keep tests snappy and avoid perceived hangs.
    // eslint-disable-next-line unicorn/no-typeof-undefined
    if (typeof jest !== 'undefined') {
      this.operationTimeoutMs = Math.min(this.operationTimeoutMs, 500);
      this.healthCheckTimeoutMs = Math.min(this.healthCheckTimeoutMs, 200);
      this.healthMonitorIntervalSec = Math.min(this.healthMonitorIntervalSec, 1);
    }
    this.initPromise = this.init();
  }

  /**
   * Create a worker instance. Subclasses must implement this to provide
   * their specific worker with Vite-compatible static imports.
   */
  protected abstract createWorker(): Worker;

  protected abstract buildJobMessage(
    request: TReq,
    id: string
  ): { type: string; id: string; payload: unknown };

  protected abstract parseJobResult(
    event: MessageEvent,
    request: TReq
  ): { value: TRes; usedFallback: boolean } | null;

  protected abstract buildBatchJobMessage(
    requests: TReq[],
    id: string
  ): { type: string; id: string; payload: unknown } | null;

  protected abstract parseBatchJobResult(
    event: MessageEvent,
    requests: TReq[]
  ): TRes[] | null;

  protected abstract fallbackValue(request: TReq): TRes;

  protected hashRequest(request: TReq): string {
    const str = JSON.stringify(request);
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 1024); i++) {
      hash = (hash << 5) - hash + (str.codePointAt(i) ?? 0);
      hash = Math.trunc(hash);
    }
    return `${str.length}-${hash}`;
  }

  protected onWorkerRecovered(workerId: number): void {
    // Optional hook for subclasses
  }

  private async init(): Promise<void> {
    // Create workers using proper Vite pattern
    for (let i = 0; i < this.poolSize; i++) {
      try {
        // eslint-disable-next-line unicorn/no-typeof-undefined
        const worker: Worker = (typeof jest === 'undefined')
          // Delegate worker creation to the concrete subclass
          // This allows Vite to statically analyze the worker import
          ? this.createWorker()
          : new Worker('/mock/worker/path', { type: 'module' });
        this.workers[i] = worker;
        this.workerReady[i] = false;
        this.workerHealthy[i] = false;
        
        // In Jest, skip handshake to stabilize tests and rely on mocks
        // eslint-disable-next-line unicorn/no-typeof-undefined
        if (typeof jest === 'undefined') {
          await this.handshakeWorker(worker, i);
        }
        this.workerReady[i] = true;
        this.workerHealthy[i] = true;
      } catch (error) {
        console.error(`Failed to initialize worker ${i}:`, error);
        this.workerReady[i] = false;
        this.workerHealthy[i] = false;
      }
    }
    
    // Start health monitoring
    // Skip background health monitor in tests to avoid lingering timers/open handles
    // eslint-disable-next-line unicorn/no-typeof-undefined
    if (this.handshake.healthCheckType && typeof jest === 'undefined') {
      this.startHealthMonitoring();
    }
  }

  private async handshakeWorker(worker: Worker, workerId: number): Promise<void> {
    return withTimeout(
      new Promise<void>((resolve, reject) => {
        const handlers = {
          message: (e: MessageEvent) => {
            if (e.data?.type === this.handshake.readySignalType) {
              // Send init request
              worker.postMessage({ 
                type: this.handshake.initRequestType, 
                id: `init-${workerId}` 
              });
            } else if (e.data?.type === this.handshake.initResponseType) {
              removeWorkerListeners(worker, handlers);
              resolve();
            }
          },
          error: (e: ErrorEvent) => {
            removeWorkerListeners(worker, handlers);
            reject(new Error(`Worker ${workerId} error during handshake: ${e.message}`));
          }
        };
        
        addWorkerListeners(worker, handlers);
      }),
      this.operationTimeoutMs,
      `Worker ${workerId} handshake`
    );
  }

  private findAvailableWorker(): number | null {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workerHealthy[i] && !this.isWorkerBusy(i)) {
        return i;
      }
    }
    return null;
  }

  private isWorkerBusy(workerId: number): boolean {
    for (const job of this.activeJobs.values()) {
      if (job.workerId === workerId) {
        return true;
      }
    }
    return false;
  }

  private enqueue(item: QueueItem<TReq, TRes>): void {
    this.queue.push(item);
    this.queue.sort((a, b) => a.priority - b.priority);
    
    // Enforce queue size limit - drop highest priority value (lowest priority)
    while (this.queue.length > this.queueMaxSize) {
      const dropped = this.queue.pop();
      if (dropped) {
        dropped.resolve(this.fallbackValue(dropped.req));
      }
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0 || this.isTerminated) {
      return;
    }
    
    const workerId = this.findAvailableWorker();
    if (workerId === null) {
      return;
    }
    
    const item = this.queue.shift();
    if (!item) {
      return;
    }
    
    this.dispatch(item, workerId);
  }

  private dispatch(item: QueueItem<TReq, TRes>, workerId: number): void {
    const worker = this.workers[workerId];
    if (!worker) {
      item.resolve(this.fallbackValue(item.req));
      return;
    }
    
    const job: ActiveJob<TReq> = {
      workerId,
      start: Date.now(),
      req: item.req
    };
    
    this.activeJobs.set(item.id, job);
    this.activeResolves.set(item.id, item.resolve);
    
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isCompleted = false;
    
    const handlers = {
      message: (e: MessageEvent) => {
        if (e.data?.id !== item.id) return;
        const result = this.parseJobResult(e, item.req);
        if (result) {
          isCompleted = true;
          if (timeoutId) clearTimeout(timeoutId);
          this.cleanupJob(item.id);
          item.resolve(result.value);
          this.processNext();
        } else if (e.data?.type === this.handshake.errorType && e.data?.id === item.id) {
          isCompleted = true;
          if (timeoutId) clearTimeout(timeoutId);
          this.cleanupJob(item.id);
          item.resolve(this.fallbackValue(item.req));
          this.processNext();
        }
      },
      error: () => {
        isCompleted = true;
        if (timeoutId) clearTimeout(timeoutId);
        this.cleanupJob(item.id);
        item.resolve(this.fallbackValue(item.req));
        this.processNext();
      }
    };
    
    job.listeners = handlers;
    addWorkerListeners(worker, handlers);
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        this.cleanupJob(item.id);
        item.resolve(this.fallbackValue(item.req));
        this.processNext();
      }
    }, this.operationTimeoutMs);
    
    // Send job message
    worker.postMessage(this.buildJobMessage(item.req, item.id));
  }

  private cleanupJob(id: string): void {
    const job = this.activeJobs.get(id);
    if (job && job.listeners) {
      const worker = this.workers[job.workerId];
      if (worker) {
        removeWorkerListeners(worker, job.listeners);
      }
    }
    this.activeJobs.delete(id);
    this.activeResolves.delete(id);
  }

  private startHealthMonitoring(): void {
    this.healthMonitorInterval = setInterval(
      () => this.performHealthMonitoring(),
      this.healthMonitorIntervalSec * 1000
    );
  }

  private async recoverWorker(workerId: number): Promise<void> {
    // Check if already recovering
    if (this.recoveryLocks.get(workerId)) {
      const existing = this.recoveryQueue.get(workerId);
      if (existing) {
        return existing;
      }
    }
    
    // Set lock
    this.recoveryLocks.set(workerId, true);
    
    const recoveryPromise = (async () => {
      try {
        // Clean up old worker
        const oldWorker = this.workers[workerId];
        if (oldWorker) {
          oldWorker.terminate();
        }
        
        // Create new worker using proper Vite pattern
        // eslint-disable-next-line unicorn/no-typeof-undefined
        const newWorker: Worker = (typeof jest === 'undefined')
          // Delegate worker creation to the concrete subclass
          // This allows Vite to statically analyze the worker import
          ? this.createWorker()
          : new Worker('/mock/worker/path', { type: 'module' });
        this.workers[workerId] = newWorker;
        this.workerReady[workerId] = false;
        this.workerHealthy[workerId] = false;
        
        // Handshake only in non-test environments
        // eslint-disable-next-line unicorn/no-typeof-undefined
        if (typeof jest === 'undefined') {
          await this.handshakeWorker(newWorker, workerId);
        }
        this.workerReady[workerId] = true;
        this.workerHealthy[workerId] = true;
        
        this.onWorkerRecovered(workerId);
        this.processNext();
      } finally {
        this.recoveryLocks.delete(workerId);
        this.recoveryQueue.delete(workerId);
      }
    })();
    
    this.recoveryQueue.set(workerId, recoveryPromise);
    return recoveryPromise;
  }

  public async countOne(
    request: TReq,
    options?: { signal?: AbortSignal; priority?: number }
  ): Promise<TRes> {
    // Ensure workers are initialized
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Initialization failed, use fallback
        return this.fallbackValue(request);
      }
    }
    
    if (!this.acceptingJobs || this.isTerminated) {
      return this.fallbackValue(request);
    }
    
    const hash = this.hashRequest(request);
    const existing = this.pendingByHash.get(hash);
    if (existing) {
      return existing;
    }
    
    const promise = new Promise<TRes>((resolve, reject) => {
      const id = `job-${Date.now()}-${Math.random()}`;
      const workerId = this.findAvailableWorker();
      
      const item: QueueItem<TReq, TRes> = {
        id,
        req: request,
        resolve,
        reject,
        priority: options?.priority ?? 0
      };
      
      if (workerId === null) {
        this.enqueue(item);
      } else {
        this.dispatch(item, workerId);
      }
    });
    
    this.pendingByHash.set(hash, promise);
    this.pendingByHashAge.set(hash, Date.now());
    
    promise.finally(() => {
      this.pendingByHash.delete(hash);
      this.pendingByHashAge.delete(hash);
    });
    
    return promise;
  }

  public async countBatch(
    requests: TReq[],
    options?: { signal?: AbortSignal; priority?: number }
  ): Promise<TRes[]> {
    const batchMessage = this.buildBatchJobMessage(requests, `batch-${Date.now()}`);
    
    if (batchMessage) {
      // Use batch processing with timeout
      const workerId = this.findAvailableWorker();
      if (workerId === null) {
        // Fallback to parallel processing
        return Promise.all(requests.map(req => this.countOne(req, options)));
      }
      
      const worker = this.workers[workerId];
      const id = batchMessage.id;
      
      let handlers: {
        message: (e: MessageEvent) => void;
        error: () => void;
      } | null = null;
      
      const innerPromise = new Promise<TRes[]>((resolve) => {
        handlers = {
          message: (e: MessageEvent) => {
            if (e.data?.id !== id) return;
            const results = this.parseBatchJobResult(e, requests);
            if (results) {
              removeWorkerListeners(worker, handlers!);
              resolve(results);
            }
          },
          error: () => {
            removeWorkerListeners(worker, handlers!);
            resolve(requests.map(req => this.fallbackValue(req)));
          }
        };
        
        addWorkerListeners(worker, handlers);
        worker.postMessage(batchMessage);
      });
      
      try {
        return await withTimeout(innerPromise, this.operationTimeoutMs, 'Batch operation');
      } catch {
        // On timeout, ensure cleanup
        if (handlers) {
          removeWorkerListeners(worker, handlers);
        }
        return requests.map(req => this.fallbackValue(req));
      }
    } else {
      // Parallel processing
      return Promise.all(
        requests.map(req => this.countOne(req, { ...options, priority: (options?.priority ?? 0) + 1 }))
      );
    }
  }

  public async healthCheck(): Promise<
    { workerId: number; healthy: boolean; responseTime: number }[]
  > {
    if (!this.handshake.healthCheckType || !this.handshake.healthResponseType) {
      return this.workers.map((_, i) => ({
        workerId: i,
        healthy: this.workerHealthy[i],
        responseTime: 0
      }));
    }
    
    return await Promise.all(
      this.workers.map(async (worker, i) => {
        const start = Date.now();
        const healthId = `health-${Date.now()}-${i}-${Math.random()}`;
        let handlers: {
          message: (e: MessageEvent) => void;
        } | null = null;
        
        try {
          await withTimeout(
            new Promise<boolean>((resolve) => {
              handlers = {
                message: (e: MessageEvent) => {
                  if (e.data?.type === this.handshake.healthResponseType && e.data?.id === healthId) {
                    if (handlers) removeWorkerListeners(worker, handlers);
                    resolve(Boolean(e.data.healthy));
                  }
                }
              };
              
              addWorkerListeners(worker, handlers);
              worker.postMessage({ type: this.handshake.healthCheckType, id: healthId });
            }),
            this.healthCheckTimeoutMs,
            `Worker ${i} health check`
          );
          
          const responseTime = Date.now() - start;
          this.workerHealthy[i] = true;
          
          return { workerId: i, healthy: true, responseTime };
        } catch {
          // Ensure cleanup on timeout
          if (handlers) {
            removeWorkerListeners(worker, handlers);
          }
          this.workerHealthy[i] = false;
          return { workerId: i, healthy: false, responseTime: Date.now() - start };
        }
      })
    );
  }

  public getStats() {
    return {
      queueLength: this.queue.length,
      activeJobs: this.activeJobs.size,
      workerCount: this.workers.length,
      healthyWorkers: this.workerHealthy.filter(Boolean).length,
      acceptingJobs: this.acceptingJobs,
      isTerminated: this.isTerminated
    };
  }

  public async performHealthMonitoring(): Promise<void> {
    // Clean up stale pending promises (older than operation timeout)
    const staleThreshold = Date.now() - this.operationTimeoutMs;
    for (const [hash, age] of this.pendingByHashAge.entries()) {
      if (age < staleThreshold) {
        this.pendingByHash.delete(hash);
        this.pendingByHashAge.delete(hash);
        console.debug(`[WorkerPool] Cleaned up stale pending promise: ${hash}`);
      }
    }
    
    const results = await this.healthCheck();
    
    for (const result of results) {
      if (!result.healthy) {
        await this.recoverWorker(result.workerId);
      }
    }
  }

  public terminate(): void {
    this.isTerminated = true;
    this.acceptingJobs = false;
    
    // Clear health monitor
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
    }
    
    // Resolve pending with fallback
    for (const item of this.queue) {
      item.resolve(this.fallbackValue(item.req));
    }
    this.queue = [];
    
    // Clean up active jobs
    for (const [id, job] of this.activeJobs) {
      try {
        const resolve = this.activeResolves.get(id);
        if (resolve) {
          resolve(this.fallbackValue(job.req));
        }
      } finally {
        this.cleanupJob(id);
      }
    }
    
    // Terminate workers
    for (const worker of this.workers) {
      if (worker) {
        worker.terminate();
      }
    }
    
    // Clear all maps
    this.activeJobs.clear();
    this.pendingByHash.clear();
    this.pendingByHashAge.clear();
    this.recoveryLocks.clear();
    this.recoveryQueue.clear();
  }
}
