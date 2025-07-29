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
  
  // Recovery lock mechanism to prevent race conditions
  private workerRecoveryLocks = new Map<number, boolean>();
  private workerRecoveryQueue = new Map<number, Promise<void>>();
  
  // Recovery debouncing for rapid failures
  private workerFailureTimes = new Map<number, number[]>();
  private readonly FAILURE_WINDOW_MS = 5000; // 5 seconds
  private readonly MAX_FAILURES_IN_WINDOW = 3;
  
  // Graceful degradation tracking
  private workerPermanentlyFailed = new Set<number>();
  
  // Active operations tracking for abort support
  private activeOperations = new Map<string, AbortController>();
  
  constructor(private poolSize = Math.min(navigator.hardwareConcurrency || 4, 8)) {
    this.initializeWorkers();
  }
  
  /**
   * Atomically acquire a recovery lock for a specific worker.
   * Returns true if lock was acquired, false if recovery is already in progress.
   */
  private async acquireRecoveryLock(workerId: number): Promise<boolean> {
    // Check if already recovering
    if (this.workerRecoveryLocks.get(workerId)) {
      // Wait for existing recovery to complete
      const existingRecovery = this.workerRecoveryQueue.get(workerId);
      if (existingRecovery) {
        await existingRecovery;
      }
      return false; // Don't proceed with another recovery
    }
    
    // Atomically acquire lock
    this.workerRecoveryLocks.set(workerId, true);
    return true;
  }
  
  /**
   * Check if we should attempt to recover a worker based on recent failure history.
   * Implements debouncing to prevent rapid recovery attempts.
   */
  private shouldRecoverWorker(workerId: number): boolean {
    const now = Date.now();
    const failures = this.workerFailureTimes.get(workerId) || [];
    
    // Remove old failures outside the window
    const recentFailures = failures.filter(time => now - time < this.FAILURE_WINDOW_MS);
    
    // Add current failure
    recentFailures.push(now);
    this.workerFailureTimes.set(workerId, recentFailures);
    
    // If too many failures, don't recover immediately
    if (recentFailures.length >= this.MAX_FAILURES_IN_WINDOW) {
      console.warn(`Worker ${workerId} has failed ${recentFailures.length} times in ${this.FAILURE_WINDOW_MS}ms, delaying recovery`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Mark a worker as permanently failed and handle graceful degradation.
   */
  private markWorkerAsFailed(workerId: number): void {
    this.workerPermanentlyFailed.add(workerId);
    this.workerStatus[workerId] = false;
    console.error(`Worker ${workerId} marked as permanently failed`);
    
    // Check if we still have enough healthy workers
    const healthyWorkerCount = this.getHealthyWorkerCount();
    if (healthyWorkerCount === 0) {
      console.error('All workers have failed, falling back to estimation only');
      this.acceptingJobs = false;
    }
  }
  
  /**
   * Get the count of healthy (non-permanently-failed) workers.
   */
  private getHealthyWorkerCount(): number {
    let count = 0;
    for (let i = 0; i < this.poolSize; i++) {
      if (this.workerStatus[i] && !this.workerPermanentlyFailed.has(i)) {
        count++;
      }
    }
    return count;
  }
  
  /**
   * Verify if a specific worker is healthy by sending a health check.
   */
  private async isWorkerHealthy(workerId: number): Promise<boolean> {
    if (!this.workerStatus[workerId]) return false;
    
    try {
      const worker = this.workers[workerId];
      const healthCheckId = `health-verify-${Date.now()}-${workerId}`;
      
      worker.postMessage({ type: 'HEALTH_CHECK', id: healthCheckId });
      
      return await this.waitForWorkerMessage(
        worker,
        `health-verify-${workerId}`,
        1000, // 1 second timeout
        (event) => {
          if (event.data.id === healthCheckId && event.data.type === 'HEALTH_RESPONSE') {
            return event.data.healthy === true;
          }
          return null;
        }
      );
    } catch {
      return false;
    }
  }
  
  /**
   * Utility method for one-time message handling with timeout and guaranteed cleanup.
   * Ensures deterministic cleanup of event listeners and timeouts in all cases.
   */
  private waitForWorkerMessage<T>(
    worker: Worker,
    messageId: string,
    timeout: number,
    messageValidator: (event: MessageEvent) => T | null
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      // Single cleanup function that handles all resources
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        worker.removeEventListener('message', messageHandler);
        worker.removeEventListener('error', errorHandler);
      };
      
      const messageHandler = (event: MessageEvent) => {
        if (resolved) return;
        
        const result = messageValidator(event);
        if (result !== null) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };
      
      const errorHandler = (error: ErrorEvent) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`Worker error during ${messageId}: ${error.message}`));
      };
      
      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Timeout waiting for ${messageId}`));
        }
      }, timeout);
      
      // Add listeners - if this fails, cleanup in catch
      try {
        worker.addEventListener('message', messageHandler);
        worker.addEventListener('error', errorHandler);
      } catch (error) {
        resolved = true;
        cleanup();
        reject(error);
      }
    });
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
    
    // Check if operation was aborted while in queue
    const operationController = this.activeOperations.get(item.id);
    if (!operationController || operationController.signal.aborted) {
      // Already aborted, skip to next
      if (operationController) {
        this.activeOperations.delete(item.id);
      }
      item.reject(new DOMException('Aborted', 'AbortError'));
      this.processNextInQueue(workerId);
      return;
    }
    
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
  
  async countTokens(text: string, options?: { signal?: AbortSignal }): Promise<number> {
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
    // Pass true to indicate job acceptance was already verified
    const promise = this.createCountTokensPromise(text, options?.signal, true);
    this.pendingRequests.set(textHash, promise);
    
    // Clean up after completion
    promise.finally(() => {
      this.pendingRequests.delete(textHash);
    });
    
    return promise;
  }
  
  private createCountTokensPromise(text: string, signal?: AbortSignal, jobAcceptanceVerified = false): Promise<number> {
    return new Promise((resolve, reject) => {
      // Only check job acceptance if not already verified atomically
      if (!jobAcceptanceVerified && !this.acceptingJobs) {
        resolve(estimateTokenCount(text));
        return;
      }
      
      // Find available worker (excluding permanently failed ones)
      const availableWorkerIndex = this.workerStatus.findIndex(
        (status, index) => status && 
          ![...this.activeJobs.values()].some(job => job.workerId === index) &&
          !this.workerPermanentlyFailed.has(index)
      );
      const id = `count-${Date.now()}-${Math.random()}`;
      
      // Create internal abort controller for this operation
      const operationController = new AbortController();
      this.activeOperations.set(id, operationController);
      
      // Chain external signal with internal controller
      if (signal) {
        if (signal.aborted) {
          this.activeOperations.delete(id);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => operationController.abort());
      }
      
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
        
        // Handle abort for queued items
        const queueAbortHandler = () => {
          // Remove from queue if still present
          const queueIndex = this.queue.findIndex(item => item.id === id);
          if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
            this.activeOperations.delete(id);
            reject(new DOMException('Aborted', 'AbortError'));
          }
        };
        
        operationController.signal.addEventListener('abort', queueAbortHandler);
        
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
        
        // Set up for message handling with guaranteed cleanup
        let resolved = false;
        let timeoutId: NodeJS.Timeout | null = null;
        
        // Single cleanup function that's always called
        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          worker.removeEventListener('message', messageHandler);
          worker.removeEventListener('error', errorHandler);
          
          // Remove abort listener
          operationController.signal.removeEventListener('abort', handleAbort);
          
          // Clean up active job and process next in queue
          if (this.activeJobs.has(id)) {
            this.activeJobs.delete(id);
            this.processNextInQueue(availableWorkerIndex);
          }
          
          // Clean up operation tracking
          this.activeOperations.delete(id);
        };
        
        const handleResult = (result: number) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(result);
        };
        
        const messageHandler = (event: MessageEvent) => {
          if (event.data.id !== id) return;
          
          // Update stats before resolving
          const job = this.activeJobs.get(id);
          if (job) {
            const duration = Date.now() - job.startTime;
            this.performanceStats.totalProcessed++;
            this.performanceStats.totalTime += duration;
          }
          
          if (event.data.type === 'ERROR') {
            console.warn('Worker error, falling back:', event.data.error);
            handleResult(estimateTokenCount(text));
          } else if (event.data.type === 'TOKEN_COUNT') {
            handleResult(event.data.fallback ? estimateTokenCount(text) : event.data.result);
          }
        };
        
        const errorHandler = (event: ErrorEvent) => {
          if (resolved) return;
          console.error('Worker crashed:', event);
          
          // Check if we should attempt recovery
          if (this.shouldRecoverWorker(availableWorkerIndex)) {
            // Recover worker asynchronously (don't await)
            this.recoverWorker(availableWorkerIndex).catch(error => {
              console.error(`Failed to recover worker ${availableWorkerIndex}:`, error);
              this.markWorkerAsFailed(availableWorkerIndex);
            });
          } else {
            // Too many failures, mark as permanently failed
            this.markWorkerAsFailed(availableWorkerIndex);
          }
          
          // Use fallback immediately
          handleResult(estimateTokenCount(text));
        };
        
        const handleAbort = () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        
        // Set up abort listener for the operation controller
        operationController.signal.addEventListener('abort', handleAbort);
        
        // Set timeout for response
        timeoutId = setTimeout(() => {
          console.warn(`Token counting timeout for worker ${availableWorkerIndex}`);
          handleResult(estimateTokenCount(text));
        }, 30_000); // 30 second timeout for token counting
        
        // Add listeners and send message - wrap in try/catch for safety
        try {
          worker.addEventListener('message', messageHandler);
          worker.addEventListener('error', errorHandler);
          
          worker.postMessage({
            type: 'COUNT_TOKENS',
            id,
            payload: { text }
          });
        } catch (error) {
          console.error('Failed to send message to worker:', error);
          handleResult(estimateTokenCount(text));
        }
      }
    });
  }
  
  async countTokensBatch(texts: string[], options?: { signal?: AbortSignal }): Promise<number[]> {
    // Fast path for recycling state or job acceptance disabled
    if (!this.acceptingJobs) {
      return texts.map(text => estimateTokenCount(text));
    }
    
    // For small batches, process in parallel
    if (texts.length <= this.poolSize * 2) {
      return Promise.all(texts.map(text => this.countTokens(text, options)));
    }
    
    // For large batches, chunk and process
    const chunkSize = Math.ceil(texts.length / this.poolSize);
    const chunks: string[][] = [];
    
    for (let i = 0; i < texts.length; i += chunkSize) {
      chunks.push(texts.slice(i, i + chunkSize));
    }
    
    const chunkResults = await Promise.all(
      chunks.map(chunk => Promise.all(chunk.map(text => this.countTokens(text, options))))
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
  
  private async recoverWorker(workerId: number): Promise<void> {
    // Validate worker ID
    if (workerId < 0 || workerId >= this.poolSize) {
      console.error(`Invalid worker ID for recovery: ${workerId}`);
      return;
    }
    
    // Check if pool is being recycled
    if (this.isRecycling || this.recyclingLock || !this.acceptingJobs) {
      console.log(`Skipping recovery for worker ${workerId} - pool is recycling`);
      return;
    }
    
    // Check if worker is permanently failed
    if (this.workerPermanentlyFailed.has(workerId)) {
      console.log(`Skipping recovery for worker ${workerId} - permanently failed`);
      return;
    }
    
    // Try to acquire recovery lock
    const lockAcquired = await this.acquireRecoveryLock(workerId);
    if (!lockAcquired) {
      console.log(`Worker ${workerId} is already being recovered`);
      return;
    }
    
    // Create recovery promise for others to wait on
    const recoveryPromise = this.performWorkerRecovery(workerId);
    this.workerRecoveryQueue.set(workerId, recoveryPromise);
    
    try {
      await recoveryPromise;
    } finally {
      // Always release lock and clean up
      this.workerRecoveryLocks.delete(workerId);
      this.workerRecoveryQueue.delete(workerId);
    }
  }
  
  private async performWorkerRecovery(workerId: number): Promise<void> {
    // Double-check worker still needs recovery
    if (this.workerStatus[workerId] && await this.isWorkerHealthy(workerId)) {
      console.log(`Worker ${workerId} is already healthy, skipping recovery`);
      return;
    }
    
    console.log(`Starting recovery for worker ${workerId}`);
    
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
    try {
      await this.waitForWorkerMessage(
        worker,
        `recovery-ready-${workerId}`,
        2000,
        (event) => {
          if (event.data.type === 'WORKER_READY') {
            console.log(`[Pool] Recovered worker ${workerId} is ready, sending INIT`);
            this.workerReadyStatus[workerId] = true;
            worker.postMessage({ type: 'INIT', id: `init-recovery-${workerId}` });
            return true; // Signal success
          }
          return null;
        }
      );
    } catch (error) {
      console.error(`Worker ${workerId} failed to send READY signal during recovery:`, error);
      // Continue anyway
    }
    
    // Wait for initialization with timeout
    const initTimeout = 2000;
    const initStart = Date.now();
    let initialized = false;
    
    while (Date.now() - initStart < initTimeout && !initialized) {
      if (this.workerStatus[workerId]) {
        initialized = true;
        console.log(`Worker ${workerId} successfully recovered`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    if (!initialized) {
      console.error(`Worker ${workerId} failed to initialize after recovery`);
      this.markWorkerAsFailed(workerId);
    }
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
  
  /**
   * Get detailed recovery statistics for monitoring and debugging.
   */
  getRecoveryStats() {
    return {
      recoveryLocks: [...this.workerRecoveryLocks.entries()],
      pendingRecoveries: [...this.workerRecoveryQueue.keys()],
      failureCounts: [...this.workerFailureTimes.entries()].map(([id, times]) => ({
        workerId: id,
        recentFailures: times.filter(time => Date.now() - time < this.FAILURE_WINDOW_MS).length,
        lastFailure: times[times.length - 1] || null
      })),
      permanentlyFailed: [...this.workerPermanentlyFailed],
      healthyWorkers: this.getHealthyWorkerCount(),
      totalWorkers: this.poolSize
    };
  }
  
  /**
   * Validate internal state consistency for debugging.
   */
  validateInternalState(): boolean {
    try {
      // Check workers array consistency
      if (this.workers.length !== this.poolSize) {
        console.error(`Worker array size mismatch: ${this.workers.length} vs ${this.poolSize}`);
        return false;
      }
      
      // Check status arrays consistency
      if (this.workerStatus.length !== this.poolSize || this.workerReadyStatus.length !== this.poolSize) {
        console.error('Status arrays size mismatch');
        return false;
      }
      
      // Check for orphaned locks
      for (const [workerId] of this.workerRecoveryLocks) {
        if (workerId >= this.poolSize) {
          console.error(`Invalid worker ID in recovery locks: ${workerId}`);
          return false;
        }
      }
      
      // Check for active jobs with invalid worker IDs
      for (const [jobId, job] of this.activeJobs) {
        if (job.workerId >= this.poolSize) {
          console.error(`Invalid worker ID in active job ${jobId}: ${job.workerId}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error validating internal state:', error);
      return false;
    }
  }
  
  private isWorkerBusy(workerId: number): boolean {
    return [...this.activeJobs.values()].some(job => job.workerId === workerId);
  }
  
  private getAvailableWorkerCount(): number {
    let available = 0;
    for (let i = 0; i < this.poolSize; i++) {
      if (this.workerStatus[i] && !this.isWorkerBusy(i) && !this.workerPermanentlyFailed.has(i)) {
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
        
        try {
          // Send health check message
          worker.postMessage({ type: 'HEALTH_CHECK', id });
          
          // Wait for response using our utility method
          return await this.waitForWorkerMessage(
            worker,
            `health-check-${index}`,
            this.HEALTH_CHECK_TIMEOUT,
            (event) => {
              if (event.data.id === id && event.data.type === 'HEALTH_RESPONSE') {
                return {
                  workerId: index,
                  healthy: event.data.healthy === true,
                  responseTime: performance.now() - start
                };
              }
              return null;
            }
          );
        } catch {
          // Timeout or error occurred
          return {
            workerId: index,
            healthy: false,
            responseTime: Number.POSITIVE_INFINITY
          };
        }
      })
    );
  }
  
  async performHealthMonitoring() {
    if (this.isTerminated || this.isRecycling) return;
    
    const healthResults = await this.healthCheck();
    const unhealthyWorkers = healthResults.filter(r => !r.healthy);
    
    if (unhealthyWorkers.length > 0) {
      console.warn(`${unhealthyWorkers.length} unhealthy workers detected:`, unhealthyWorkers);
      
      // Attempt to recover unhealthy workers concurrently
      // The recovery lock will prevent race conditions
      await Promise.all(
        unhealthyWorkers.map(({ workerId }) => 
          this.recoverWorker(workerId).catch(error => {
            console.error(`Health monitor failed to recover worker ${workerId}:`, error);
          })
        )
      );
    }
    
    // Schedule next health check
    if (!this.isTerminated) {
      setTimeout(() => this.performHealthMonitoring(), 30_000); // Every 30 seconds
    }
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
    
    // Abort all active operations
    for (const [id, controller] of this.activeOperations) {
      controller.abort();
    }
    this.activeOperations.clear();
    
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