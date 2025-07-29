import { estimateTokenCount } from './token-utils';

interface QueueItem {
  id: string;
  text: string;
  resolve: (count: number) => void;
  reject: (error: Error) => void;
}

interface ActiveJob {
  workerId: number;
  startTime: number;
  size: number;
  text: string;
  resolve: (count: number) => void;
}

export class TokenWorkerPool {
  private workers: Worker[] = [];
  private queue: QueueItem[] = [];
  private activeJobs = new Map<string, ActiveJob>();
  private workerStatus: boolean[] = [];
  private workerReadyStatus: boolean[] = [];
  private isTerminated = false;
  private isRecycling = false;
  private recyclingLock = false;
  private acceptingJobs = true;
  
  // Store event listeners for cleanup
  private workerListeners = new Map<number, {
    message: (event: MessageEvent) => void;
    error: (event: ErrorEvent) => void;
    messageerror?: (event: MessageEvent) => void;
  }>();
  
  // Queue management
  private readonly MAX_QUEUE_SIZE = 1000;
  private droppedRequests = 0;
  
  // Health check configuration
  private readonly HEALTH_CHECK_TIMEOUT = 1000;
  
  // Request deduplication
  private pendingRequests = new Map<string, Promise<number>>();
  
  // Performance monitoring
  private performanceStats = {
    totalProcessed: 0,
    totalTime: 0,
    failureCount: 0
  };
  
  constructor(private poolSize = Math.min(navigator.hardwareConcurrency || 4, 8)) {
    this.initializeWorkers();
  }
  
  private async initializeWorkers() {
    console.log('[Pool] Starting worker initialization...');
    // Progressive enhancement check
    const supportsWorkers = typeof Worker !== 'undefined';
    const supportsWasm = typeof WebAssembly !== 'undefined';
    
    console.log('[Pool] Support check - Workers:', supportsWorkers, 'WASM:', supportsWasm);
    
    if (!supportsWorkers || !supportsWasm) {
      console.warn('Web Workers or WASM not supported, falling back to estimation');
      this.isTerminated = true;
      return;
    }
    
    for (let i = 0; i < this.poolSize; i++) {
      try {
        console.log(`[Pool] Creating worker ${i}...`);
        // Note: Webpack/Vite will handle worker bundling
        const worker = new Worker(
          new URL('../workers/token-counter-worker.ts', import.meta.url),
          { type: 'module' }
        );
        console.log(`[Pool] Worker ${i} created successfully`);
        
        // Create named handlers for proper cleanup
        const messageHandler = (event: MessageEvent) => {
          this.handleWorkerMessage(i, event);
        };
        
        const errorHandler = (error: ErrorEvent) => {
          console.error(`Worker ${i} error:`, error);
          this.workerStatus[i] = false;
        };
        
        const messageErrorHandler = (event: MessageEvent) => {
          console.error(`Worker ${i} message error:`, event);
          this.workerStatus[i] = false;
        };
        
        // Use addEventListener for consistency and proper cleanup
        worker.addEventListener('message', messageHandler);
        worker.addEventListener('error', errorHandler);
        worker.addEventListener('messageerror', messageErrorHandler);
        
        // Store references for cleanup
        this.workerListeners.set(i, {
          message: messageHandler,
          error: errorHandler,
          messageerror: messageErrorHandler
        });
        
        this.workers.push(worker);
        this.workerStatus.push(false); // Will be set to true on successful init
        this.workerReadyStatus.push(false); // Will be set to true when worker sends READY
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }
    
    // Wait for all workers to send READY signal
    console.log('[Pool] Waiting for workers to be ready...');
    await this.waitForWorkersReady();
    
    // Send INIT messages to all ready workers
    console.log('[Pool] All workers ready, sending INIT messages...');
    for (const [i, worker] of this.workers.entries()) {
      if (this.workerReadyStatus[i]) {
        console.log(`[Pool] Sending INIT message to worker ${i}`);
        worker.postMessage({ type: 'INIT', id: `init-${i}` });
      }
    }
    
    // Wait for workers to initialize
    await this.waitForWorkerInit();
    
    // Start health monitoring
    this.performHealthMonitoring();
  }
  
  private async waitForWorkersReady(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const hasReady = this.workerReadyStatus.some(Boolean);
      const readyCount = hasReady ? this.workerReadyStatus.filter(Boolean).length : 0;
      console.log(`[Pool] ${readyCount}/${this.workers.length} workers ready`);
      
      if (hasReady && readyCount === this.workers.length) {
        console.log('[Pool] All workers are ready!');
        return;
      }
      
      // If at least half are ready after 1 second, continue
      if (Date.now() - start > 1000 && readyCount >= Math.ceil(this.workers.length / 2)) {
        console.log(`[Pool] ${readyCount} workers ready, continuing with partial pool`);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const readyCount = this.workerReadyStatus.filter(Boolean).length;
    console.warn(`[Pool] Worker ready timeout - only ${readyCount}/${this.workers.length} workers ready`);
  }
  
  private async waitForWorkerInit(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.workerStatus.some(Boolean)) {
        return; // At least one worker is ready
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.warn('Worker initialization timeout - falling back to estimation');
  }
  
  private handleWorkerMessage(workerId: number, event: MessageEvent) {
    const { type, id, success, healthy } = event.data;
    
    console.log(`[Pool] Received message from worker ${workerId}:`, { type, id, success: success || healthy });
    
    switch (type) {
      case 'WORKER_READY': {
        console.log(`[Pool] Worker ${workerId} is ready`);
        this.workerReadyStatus[workerId] = true;
        break;
      }
        
      case 'INIT_COMPLETE': {
        console.log(`[Pool] Worker ${workerId} initialization complete, success: ${success}`);
        this.workerStatus[workerId] = success;
        break;
      }
        
      case 'TOKEN_COUNT': {
        const job = this.activeJobs.get(id);
        if (job) {
          // Update performance stats
          const duration = Date.now() - job.startTime;
          this.performanceStats.totalProcessed++;
          this.performanceStats.totalTime += duration;
          
          this.activeJobs.delete(id);
          this.processNextInQueue(workerId);
        }
        break;
      }
        
      case 'ERROR': {
        this.performanceStats.failureCount++;
        this.activeJobs.delete(id);
        this.processNextInQueue(workerId);
        break;
      }
    }
  }
  
  private processNextInQueue(workerId: number) {
    if (this.queue.length === 0 || !this.acceptingJobs) return;
    
    const item = this.queue.shift();
    if (!item) return;
    
    this.activeJobs.set(item.id, {
      workerId,
      startTime: Date.now(),
      size: item.text.length,
      text: item.text,
      resolve: item.resolve
    });
    
    this.workers[workerId].postMessage({
      type: 'COUNT_TOKENS',
      id: item.id,
      payload: { text: item.text }
    });
  }
  
  private hashText(text: string): string {
    // Simple hash function for deduplication
    let hash = 0;
    for (let i = 0; i < Math.min(text.length, 1000); i++) {
      const char = text.codePointAt(i) ?? 0;
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${hash}-${text.length}`;
  }
  
  async countTokens(text: string): Promise<number> {
    // Fast path for terminated, recycling, or no workers
    // Use atomic check to prevent race condition during recycling
    if (this.isTerminated || !this.acceptingJobs || this.workers.length === 0) {
      return estimateTokenCount(text);
    }
    
    // Check for duplicate request
    const textHash = this.hashText(text);
    if (this.pendingRequests.has(textHash)) {
      // Return existing promise for the same text
      return this.pendingRequests.get(textHash)!;
    }
    
    // Create new promise for this request
    const promise = this.createCountTokensPromise(text);
    this.pendingRequests.set(textHash, promise);
    
    // Clean up after completion
    promise.finally(() => {
      this.pendingRequests.delete(textHash);
    });
    
    return promise;
  }
  
  private createCountTokensPromise(text: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Double-check job acceptance inside promise creation
      if (!this.acceptingJobs) {
        resolve(estimateTokenCount(text));
        return;
      }
      
      // Find available worker
      const availableWorkerIndex = this.workerStatus.findIndex(
        (status, index) => status && ![...this.activeJobs.values()]
          .some(job => job.workerId === index)
      );
      const id = `count-${Date.now()}-${Math.random()}`;
      
      if (availableWorkerIndex === -1) {
        // Queue for later processing with size limit enforcement
        if (this.queue.length >= this.MAX_QUEUE_SIZE) {
          // Drop oldest request (FIFO) and warn
          const dropped = this.queue.shift();
          if (dropped) {
            this.droppedRequests++;
            console.warn(`Queue size limit reached (${this.MAX_QUEUE_SIZE}), dropping oldest request`);
            // Resolve dropped request with estimation
            dropped.resolve(estimateTokenCount(dropped.text));
          }
        }
        
        this.queue.push({ id, text, resolve, reject });
      } else {
        // Direct processing
        this.activeJobs.set(id, {
          workerId: availableWorkerIndex,
          startTime: Date.now(),
          size: text.length,
          text: text,
          resolve: resolve
        });
        
        const worker = this.workers[availableWorkerIndex];
        
        // Set up cleanup function for proper resource management
        // Define handlers first
        let timeoutId: NodeJS.Timeout;
        
        const cleanup = () => {
          worker.removeEventListener('message', messageHandler);
          worker.removeEventListener('error', errorHandler);
          clearTimeout(timeoutId);
          
          // Clean up active job if still present
          if (this.activeJobs.has(id)) {
            this.activeJobs.delete(id);
            this.processNextInQueue(availableWorkerIndex);
          }
        };
        
        const errorHandler = (event: ErrorEvent) => {
          console.error('Worker crashed:', event);
          cleanup();
          
          // Attempt to recover the worker
          this.recoverWorker(availableWorkerIndex);
          
          // Fallback to estimation
          resolve(estimateTokenCount(text));
        };
        
        // Set up message handler
        const messageHandler = (event: MessageEvent) => {
          if (event.data.id === id) {
            cleanup();
            
            if (event.data.type === 'ERROR') {
              console.warn('Worker error, falling back:', event.data.error);
              resolve(estimateTokenCount(text));
            } else if (event.data.type === 'TOKEN_COUNT') {
              resolve(event.data.fallback ? estimateTokenCount(text) : event.data.result);
            }
            
            const job = this.activeJobs.get(id);
            if (job) {
              const duration = Date.now() - job.startTime;
              this.performanceStats.totalProcessed++;
              this.performanceStats.totalTime += duration;
            }
          }
        };
        
        // Add event listeners
        worker.addEventListener('message', messageHandler);
        worker.addEventListener('error', errorHandler);
        
        // Send the message
        worker.postMessage({
          type: 'COUNT_TOKENS',
          id,
          payload: { text }
        });
      }
    });
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
    // Fast path for recycling state or job acceptance disabled
    if (!this.acceptingJobs) {
      return texts.map(text => estimateTokenCount(text));
    }
    
    // For small batches, process in parallel
    if (texts.length <= this.poolSize * 2) {
      return Promise.all(texts.map(text => this.countTokens(text)));
    }
    
    // For large batches, chunk and process
    const chunkSize = Math.ceil(texts.length / this.poolSize);
    const chunks: string[][] = [];
    
    for (let i = 0; i < texts.length; i += chunkSize) {
      chunks.push(texts.slice(i, i + chunkSize));
    }
    
    const chunkResults = await Promise.all(
      chunks.map(chunk => Promise.all(chunk.map(text => this.countTokens(text))))
    );
    
    return chunkResults.flat();
  }
  
  // Memory management
  monitorWorkerMemory() {
    if ('performance' in self && 'measureUserAgentSpecificMemory' in performance) {
      // Periodic memory monitoring
      setInterval(async () => {
        try {
          const memory = await (performance as any).measureUserAgentSpecificMemory();
          console.log('Worker pool memory usage:', memory);
          
          // Recycle workers if memory usage is high
          if (memory.bytes > 500_000_000) { // 500MB threshold
            this.recycleWorkers();
          }
        } catch {
          // Memory API might not be available
        }
      }, 30_000); // Check every 30 seconds
    }
  }
  
  // Public method for testing and manual recycling
  async forceRecycle(): Promise<void> {
    return this.recycleWorkers();
  }
  
  private async recycleWorkers() {
    // Atomically set both flags to prevent race conditions
    if (this.recyclingLock) {
      // Already recycling, wait for completion
      while (this.recyclingLock) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return;
    }
    
    // Stop accepting new jobs BEFORE setting recycling flags
    this.acceptingJobs = false;
    this.recyclingLock = true;
    this.isRecycling = true;
    
    try {
      // Process any queued items with fallback
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (item) {
          // Use estimation fallback for queued items during recycling
          item.resolve(estimateTokenCount(item.text));
        }
      }
      
      // Wait for active jobs to complete with timeout
      const maxWaitTime = 10_000; // 10 seconds max wait
      const startWait = Date.now();
      
      // Create a snapshot of active job count to detect if new jobs are added
      let lastJobCount = this.activeJobs.size;
      let stableIterations = 0;
      const requiredStableIterations = 3; // Require 3 consecutive checks with no new jobs
      
      while (this.activeJobs.size > 0 && Date.now() - startWait < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if job count is stable
        if (this.activeJobs.size === lastJobCount) {
          stableIterations++;
        } else {
          // New job was added (shouldn't happen with acceptingJobs=false, but defensive)
          console.warn(`New job detected during recycling: ${this.activeJobs.size} jobs (was ${lastJobCount})`);
          stableIterations = 0;
          lastJobCount = this.activeJobs.size;
        }
        
        // If we've had stable job count for required iterations, we can proceed
        if (stableIterations >= requiredStableIterations && this.activeJobs.size === 0) {
          break;
        }
      }
      
      // Force resolve any remaining active jobs with estimation
      if (this.activeJobs.size > 0) {
        console.warn(`Force clearing ${this.activeJobs.size} stuck jobs during recycling`);
        
        // Create a copy of active jobs to avoid modification during iteration
        const stuckJobs = new Map(this.activeJobs);
        
        // Clear all active jobs
        this.activeJobs.clear();
        
        // Resolve stuck jobs with estimation
        for (const [jobId, job] of stuckJobs) {
          try {
            job.resolve(estimateTokenCount(job.text));
          } catch (error) {
            console.error(`Failed to resolve stuck job ${jobId}:`, error);
          }
        }
      }
      
      // Terminate and recreate workers
      this.terminate();
      this.workers = [];
      this.workerStatus = [];
      this.workerReadyStatus = [];
      this.isTerminated = false;
      
      await this.initializeWorkers();
    } finally {
      // Always clear flags atomically, even if initialization fails
      this.isRecycling = false;
      this.recyclingLock = false;
      // Re-enable job acceptance only after recycling is complete
      this.acceptingJobs = true;
    }
  }
  
  private async recoverWorker(workerId: number) {
    // Clean up old worker listeners before termination
    this.cleanupWorkerListeners(workerId);
    
    // Terminate the crashed worker
    try {
      this.workers[workerId].terminate();
    } catch (error) {
      console.error('Failed to terminate crashed worker:', error);
    }
    
    // Create a new worker
    const worker = new Worker(
      new URL('../workers/token-counter-worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    this.workers[workerId] = worker;
    this.workerStatus[workerId] = false;
    this.workerReadyStatus[workerId] = false; // Reset ready status
    
    // Create named handlers for proper cleanup
    const messageHandler = (event: MessageEvent) => {
      this.handleWorkerMessage(workerId, event);
    };
    
    const errorHandler = (error: ErrorEvent) => {
      console.error(`Worker ${workerId} error:`, error);
      this.workerStatus[workerId] = false;
    };
    
    const messageErrorHandler = (event: MessageEvent) => {
      console.error(`Worker ${workerId} message error:`, event);
      this.workerStatus[workerId] = false;
    };
    
    // Add event listeners
    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);
    worker.addEventListener('messageerror', messageErrorHandler);
    
    // Store references for cleanup
    this.workerListeners.set(workerId, {
      message: messageHandler,
      error: errorHandler,
      messageerror: messageErrorHandler
    });
    
    // Wait for worker to be ready before sending INIT
    await new Promise<void>((resolve) => {
      let isResolved = false;
      
      const readyHandler = (event: MessageEvent) => {
        if (event.data.type === 'WORKER_READY' && !isResolved) {
          isResolved = true;
          clearTimeout(readyTimeout);
          worker.removeEventListener('message', readyHandler);
          console.log(`[Pool] Recovered worker ${workerId} is ready, sending INIT`);
          this.workerReadyStatus[workerId] = true;
          worker.postMessage({ type: 'INIT', id: `init-recovery-${workerId}` });
          resolve();
        }
      };
      
      const readyTimeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          worker.removeEventListener('message', readyHandler);
          console.error(`Worker ${workerId} failed to send READY signal during recovery`);
          resolve(); // Continue anyway
        }
      }, 2000);
      
      worker.addEventListener('message', readyHandler);
    });
    
    // Wait for initialization
    await new Promise<void>((resolve) => {
      const checkInit = setInterval(() => {
        if (this.workerStatus[workerId]) {
          clearInterval(checkInit);
          resolve();
        }
      }, 50);
      
      // Timeout after 2 seconds
      setTimeout(() => {
        clearInterval(checkInit);
        console.error(`Worker ${workerId} failed to initialize after recovery`);
        resolve();
      }, 2000);
    });
  }
  
  getPerformanceStats() {
    return {
      ...this.performanceStats,
      averageTime: this.performanceStats.totalProcessed > 0 
        ? this.performanceStats.totalTime / this.performanceStats.totalProcessed 
        : 0,
      successRate: this.performanceStats.totalProcessed > 0
        ? (this.performanceStats.totalProcessed - this.performanceStats.failureCount) / this.performanceStats.totalProcessed
        : 0,
      queueLength: this.queue.length,
      activeJobs: this.activeJobs.size,
      droppedRequests: this.droppedRequests,
      maxQueueSize: this.MAX_QUEUE_SIZE,
      poolSize: this.poolSize,
      availableWorkers: this.getAvailableWorkerCount(),
      isRecycling: this.isRecycling,
      recyclingLock: this.recyclingLock,
      acceptingJobs: this.acceptingJobs
    };
  }
  
  private isWorkerBusy(workerId: number): boolean {
    return [...this.activeJobs.values()].some(job => job.workerId === workerId);
  }
  
  private getAvailableWorkerCount(): number {
    let available = 0;
    for (let i = 0; i < this.poolSize; i++) {
      if (this.workerStatus[i] && !this.isWorkerBusy(i)) {
        available++;
      }
    }
    return available;
  }
  
  async healthCheck(): Promise<{ workerId: number; healthy: boolean; responseTime: number }[]> {
    return Promise.all(
      this.workers.map(async (worker, index) => {
        const id = `health-${Date.now()}-${index}`;
        const start = performance.now();
        
        return new Promise<{ workerId: number; healthy: boolean; responseTime: number }>((resolve) => {
          let isResolved = false;
          let healthTimeout: ReturnType<typeof setTimeout> | null = null;
          
          // Simplified cleanup function to avoid complexity
          const cleanup = () => {
            if (healthTimeout) {
              clearTimeout(healthTimeout);
              healthTimeout = null;
            }
            worker.removeEventListener('message', handler);
          };
          
          // Handler function with deterministic cleanup
          const handler = (e: MessageEvent) => {
            if (e.data.id === id && e.data.type === 'HEALTH_RESPONSE' && !isResolved) {
              isResolved = true;
              cleanup();
              
              resolve({
                workerId: index,
                healthy: e.data.healthy === true, // Require explicit true from worker
                responseTime: performance.now() - start
              });
            }
          };
          
          // Single timeout with guaranteed cleanup
          healthTimeout = setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              cleanup();
              
              resolve({ 
                workerId: index, 
                healthy: false, 
                responseTime: Number.POSITIVE_INFINITY 
              });
            }
          }, this.HEALTH_CHECK_TIMEOUT);
          
          worker.addEventListener('message', handler);
          worker.postMessage({ type: 'HEALTH_CHECK', id });
        });
      })
    );
  }
  
  async performHealthMonitoring() {
    if (this.isTerminated) return;
    
    const healthResults = await this.healthCheck();
    const unhealthyWorkers = healthResults.filter(r => !r.healthy);
    
    if (unhealthyWorkers.length > 0) {
      console.warn(`${unhealthyWorkers.length} unhealthy workers detected:`, unhealthyWorkers);
      
      // Attempt to recover unhealthy workers
      for (const { workerId } of unhealthyWorkers) {
        await this.recoverWorker(workerId);
      }
    }
    
    // Schedule next health check
    setTimeout(() => this.performHealthMonitoring(), 30_000); // Every 30 seconds
  }
  
  private cleanupWorkerListeners(workerId: number) {
    const worker = this.workers[workerId];
    const listeners = this.workerListeners.get(workerId);
    
    if (worker && listeners) {
      worker.removeEventListener('message', listeners.message);
      worker.removeEventListener('error', listeners.error);
      if (listeners.messageerror) {
        worker.removeEventListener('messageerror', listeners.messageerror);
      }
      this.workerListeners.delete(workerId);
    }
  }
  
  terminate() {
    this.isTerminated = true;
    this.acceptingJobs = false;
    
    // Clean up all worker listeners before termination
    for (const [index, worker] of this.workers.entries()) {
      this.cleanupWorkerListeners(index);
      worker.terminate();
    }
    
    this.workers = [];
    this.queue = [];
    this.activeJobs.clear();
    this.workerListeners.clear();
  }
}