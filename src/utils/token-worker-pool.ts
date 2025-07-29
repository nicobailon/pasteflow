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
}

export class TokenWorkerPool {
  private workers: Worker[] = [];
  private queue: QueueItem[] = [];
  private activeJobs = new Map<string, ActiveJob>();
  private workerStatus: boolean[] = [];
  private workerReadyStatus: boolean[] = [];
  private isTerminated = false;
  
  // Queue management
  private readonly MAX_QUEUE_SIZE = 1000;
  private droppedRequests = 0;
  
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
        
        worker.onerror = (error) => {
          console.error(`Worker ${i} error:`, error);
          this.workerStatus[i] = false;
        };
        
        worker.onmessage = (event) => {
          this.handleWorkerMessage(i, event);
        };
        
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
    this.workers.forEach((worker, i) => {
      if (this.workerReadyStatus[i]) {
        console.log(`[Pool] Sending INIT message to worker ${i}`);
        worker.postMessage({ type: 'INIT', id: `init-${i}` });
      }
    });
    
    // Wait for workers to initialize
    await this.waitForWorkerInit();
    
    // Start health monitoring
    this.performHealthMonitoring();
  }
  
  private async waitForWorkersReady(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const readyCount = this.workerReadyStatus.filter(Boolean).length;
      console.log(`[Pool] ${readyCount}/${this.workers.length} workers ready`);
      
      if (readyCount === this.workers.length) {
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
      if (this.workerStatus.filter(Boolean).length > 0) {
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
      case 'WORKER_READY':
        console.log(`[Pool] Worker ${workerId} is ready`);
        this.workerReadyStatus[workerId] = true;
        break;
        
      case 'INIT_COMPLETE':
        console.log(`[Pool] Worker ${workerId} initialization complete, success: ${success}`);
        this.workerStatus[workerId] = success;
        break;
        
      case 'TOKEN_COUNT':
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
        
      case 'ERROR':
        this.performanceStats.failureCount++;
        this.activeJobs.delete(id);
        this.processNextInQueue(workerId);
        break;
    }
  }
  
  private processNextInQueue(workerId: number) {
    if (this.queue.length === 0) return;
    
    const item = this.queue.shift();
    if (!item) return;
    
    this.activeJobs.set(item.id, {
      workerId,
      startTime: Date.now(),
      size: item.text.length
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
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${hash}-${text.length}`;
  }
  
  async countTokens(text: string): Promise<number> {
    // Fast path for terminated or no workers
    if (this.isTerminated || this.workers.length === 0) {
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
    // Find available worker
    const availableWorkerIndex = this.workerStatus.findIndex(
      (status, index) => status && !Array.from(this.activeJobs.values())
        .some(job => job.workerId === index)
    );
    
    return new Promise((resolve, reject) => {
      const id = `count-${Date.now()}-${Math.random()}`;
      
      if (availableWorkerIndex !== -1) {
        // Direct processing
        this.activeJobs.set(id, {
          workerId: availableWorkerIndex,
          startTime: Date.now(),
          size: text.length
        });
        
        const worker = this.workers[availableWorkerIndex];
        
        // Set up cleanup function for proper resource management
        let timeoutId: NodeJS.Timeout;
        let errorHandler: (event: ErrorEvent) => void;
        
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
        
        // Set up message handler
        const messageHandler = (event: MessageEvent) => {
          if (event.data.id === id) {
            cleanup();
            
            if (event.data.type === 'TOKEN_COUNT') {
              resolve(event.data.fallback ? estimateTokenCount(text) : event.data.result);
            } else if (event.data.type === 'ERROR') {
              console.warn('Worker error, falling back:', event.data.error);
              resolve(estimateTokenCount(text));
            }
            
            const job = this.activeJobs.get(id);
            if (job) {
              const duration = Date.now() - job.startTime;
              this.performanceStats.totalProcessed++;
              this.performanceStats.totalTime += duration;
            }
          }
        };
        
        // Set up error handler
        errorHandler = (event: ErrorEvent) => {
          console.error('Worker crashed:', event);
          cleanup();
          
          // Attempt to recover the worker
          this.recoverWorker(availableWorkerIndex);
          
          // Fallback to estimation
          resolve(estimateTokenCount(text));
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
        
        // Set timeout for cleanup
        timeoutId = setTimeout(() => {
          cleanup();
          console.warn(`Token counting timeout for request ${id}`);
          resolve(estimateTokenCount(text));
        }, 5000);
      } else {
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
      }
    });
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
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
          if (memory.bytes > 500 * 1024 * 1024) { // 500MB threshold
            this.recycleWorkers();
          }
        } catch (error) {
          // Memory API might not be available
        }
      }, 30000); // Check every 30 seconds
    }
  }
  
  private async recycleWorkers() {
    // Wait for active jobs to complete
    while (this.activeJobs.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Terminate and recreate workers
    this.terminate();
    this.workers = [];
    this.workerStatus = [];
    this.isTerminated = false;
    await this.initializeWorkers();
  }
  
  private async recoverWorker(workerId: number) {
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
    
    // Set up the worker's message handler
    worker.addEventListener('message', (event) => {
      this.handleWorkerMessage(workerId, event);
    });
    
    // Wait for worker to be ready before sending INIT
    await new Promise<void>((resolve) => {
      const readyTimeout = setTimeout(() => {
        console.error(`Worker ${workerId} failed to send READY signal during recovery`);
        resolve(); // Continue anyway
      }, 2000);
      
      const readyHandler = (event: MessageEvent) => {
        if (event.data.type === 'WORKER_READY') {
          clearTimeout(readyTimeout);
          worker.removeEventListener('message', readyHandler);
          console.log(`[Pool] Recovered worker ${workerId} is ready, sending INIT`);
          this.workerReadyStatus[workerId] = true;
          worker.postMessage({ type: 'INIT', id: `init-recovery-${workerId}` });
          resolve();
        }
      };
      
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
      availableWorkers: this.getAvailableWorkerCount()
    };
  }
  
  private isWorkerBusy(workerId: number): boolean {
    return Array.from(this.activeJobs.values()).some(job => job.workerId === workerId);
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
          const timeout = setTimeout(() => {
            resolve({ 
              workerId: index, 
              healthy: false, 
              responseTime: Infinity 
            });
          }, 1000);
          
          const handler = (e: MessageEvent) => {
            if (e.data.id === id && e.data.type === 'HEALTH_RESPONSE') {
              clearTimeout(timeout);
              worker.removeEventListener('message', handler);
              resolve({
                workerId: index,
                healthy: e.data.healthy === true, // Require explicit true from worker
                responseTime: performance.now() - start
              });
            }
          };
          
          worker.addEventListener('message', handler);
          worker.postMessage({ type: 'HEALTH_CHECK', id });
          
          // Clean up listener after timeout
          setTimeout(() => {
            worker.removeEventListener('message', handler);
          }, 1100);
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
    setTimeout(() => this.performHealthMonitoring(), 30000); // Every 30 seconds
  }
  
  terminate() {
    this.isTerminated = true;
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.queue = [];
    this.activeJobs.clear();
  }
}