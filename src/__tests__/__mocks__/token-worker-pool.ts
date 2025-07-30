// Mock TokenWorkerPool that behaves like the real implementation
// This mock focuses on testing the behavioral contracts, not implementation details

export class TokenWorkerPool {
  private workers: MockWorker[] = [];
  private queue: Array<{ id: string; resolve: (value: number) => void; reject: (error: Error) => void; text: string }> = [];
  private activeJobs = new Map<string, { workerId: number }>();
  private pendingRequests = new Map<string, Promise<number>>();
  private droppedRequests = 0;
  private isTerminated = false;
  private isRecycling = false;
  private totalProcessed = 0;
  private failureCount = 0;
  
  constructor(private poolSize: number = 4) {
    this.initializeWorkers();
  }
  
  private initializeWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new MockWorker();
      this.workers.push(worker);
    }
  }
  
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < Math.min(text.length, 1000); i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${hash}-${text.length}`;
  }
  
  async countTokens(text: string): Promise<number> {
    if (this.isTerminated) {
      throw new Error('Worker pool has been terminated');
    }
    
    // Fast path for recycling state
    if (this.isRecycling) {
      return Math.ceil(text.length / 4); // Estimation fallback
    }
    
    // Input size validation - exact same as real implementation
    const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB
    if (text.length > MAX_TEXT_SIZE) {
      throw new Error('Text too large for processing');
    }
    
    // Request deduplication - exact same as real implementation
    const textHash = this.hashText(text);
    if (this.pendingRequests.has(textHash)) {
      return this.pendingRequests.get(textHash)!;
    }
    
    const promise = new Promise<number>((resolve, reject) => {
      const id = `count-${Date.now()}-${Math.random()}`;
      
      // Queue management - exact same as real implementation
      const MAX_QUEUE_SIZE = 1000;
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        const dropped = this.queue.shift();
        if (dropped) {
          this.droppedRequests++;
          dropped.resolve(Math.ceil(dropped.text.length / 4)); // Fallback estimation
        }
      }
      
      this.queue.push({ id, resolve, reject, text });
      this.processQueue();
    });
    
    this.pendingRequests.set(textHash, promise);
    promise.finally(() => {
      this.pendingRequests.delete(textHash);
    });
    
    return promise;
  }
  
  private processQueue() {
    if (this.queue.length === 0 || this.isTerminated || this.isRecycling) return;
    
    // Find available worker
    const availableWorkerIndex = this.workers.findIndex((_, index) => {
      return !Array.from(this.activeJobs.values()).some(job => job.workerId === index);
    });
    
    if (availableWorkerIndex === -1) return; // No available workers
    
    const job = this.queue.shift();
    if (!job) return;
    
    this.activeJobs.set(job.id, { workerId: availableWorkerIndex });
    const worker = this.workers[availableWorkerIndex];
    
    // Simulate real worker behavior with realistic timing and error handling
    let timeoutId: NodeJS.Timeout;
    
    const cleanup = () => {
      clearTimeout(timeoutId);
      this.activeJobs.delete(job.id);
      this.processQueue(); // Process next job
    };
    
    const messageHandler = (event: MessageEvent) => {
      if (event.data.id === job.id) {
        worker.removeEventListener('message', messageHandler);
        worker.removeEventListener('error', errorHandler);
        cleanup();
        
        if (event.data.type === 'TOKEN_COUNT') {
          this.totalProcessed++;
          job.resolve(event.data.result);
        } else if (event.data.type === 'ERROR') {
          this.failureCount++;
          job.reject(new Error(event.data.error));
        }
      }
    };
    
    const errorHandler = () => {
      worker.removeEventListener('message', messageHandler);
      worker.removeEventListener('error', errorHandler);
      cleanup();
      this.failureCount++;
      job.resolve(Math.ceil(job.text.length / 4)); // Fallback estimation
    };
    
    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);
    
    // Send message to worker
    worker.postMessage({ type: 'COUNT_TOKENS', id: job.id, payload: { text: job.text } });
    
    // Timeout handling - matches real implementation
    timeoutId = setTimeout(() => {
      worker.removeEventListener('message', messageHandler);
      worker.removeEventListener('error', errorHandler);
      cleanup();
      this.failureCount++;
      job.resolve(Math.ceil(job.text.length / 4)); // Timeout fallback
    }, 30000); // 30 second timeout
  }
  
  async healthCheck(): Promise<Array<{ workerId: number; healthy: boolean; responseTime: number }>> {
    if (this.isTerminated) {
      return this.workers.map((_, index) => ({ workerId: index, healthy: false, responseTime: -1 }));
    }
    
    const healthPromises = this.workers.map(async (worker, index) => {
      const startTime = Date.now();
      const id = `health-${Date.now()}-${index}`;
      
      return new Promise<{ workerId: number; healthy: boolean; responseTime: number }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ workerId: index, healthy: false, responseTime: -1 });
        }, 1000);
        
        const messageHandler = (event: MessageEvent) => {
          if (event.data.id === id) {
            clearTimeout(timeout);
            worker.removeEventListener('message', messageHandler);
            const responseTime = Date.now() - startTime;
            resolve({ workerId: index, healthy: true, responseTime });
          }
        };
        
        worker.addEventListener('message', messageHandler);
        worker.postMessage({ type: 'HEALTH_CHECK', id });
      });
    });
    
    return Promise.all(healthPromises);
  }
  
  getPerformanceStats() {
    return {
      totalProcessed: this.totalProcessed,
      failureCount: this.failureCount,
      droppedRequests: this.droppedRequests,
      queueLength: this.queue.length,
      activeJobs: this.activeJobs.size,
      maxQueueSize: 1000,
      poolSize: this.poolSize,
      availableWorkers: this.poolSize - this.activeJobs.size,
      isRecycling: this.isRecycling
    };
  }
  
  async forceRecycle(): Promise<void> {
    // Set recycling flag to prevent new jobs
    this.isRecycling = true;
    
    // Process any queued items with fallback
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.resolve(Math.ceil(item.text.length / 4)); // Estimation fallback
      }
    }
    
    // Wait for active jobs to complete with timeout
    const maxWaitTime = 100; // Short timeout for testing
    const startWait = Date.now();
    
    while (this.activeJobs.size > 0 && Date.now() - startWait < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Clear active jobs
    this.activeJobs.clear();
    
    // Simulate worker recreation
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.initializeWorkers();
    
    // Clear recycling flag
    this.isRecycling = false;
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
    // Fast path for recycling state
    if (this.isRecycling) {
      return texts.map(text => Math.ceil(text.length / 4));
    }
    
    return Promise.all(texts.map(text => this.countTokens(text)));
  }
  
  terminate() {
    this.isTerminated = true;
    this.workers.forEach(worker => worker.terminate());
    this.queue.forEach(job => {
      job.reject(new Error('Worker pool terminated'));
    });
    this.queue.length = 0;
    this.activeJobs.clear();
    this.pendingRequests.clear();
  }
}

// Mock Worker class that simulates real Worker behavior
class MockWorker {
  private messageHandlers: Array<(event: MessageEvent) => void> = [];
  private errorHandlers: Array<() => void> = [];
  private isHealthy = true;
  
  addEventListener(type: string, handler: (event: MessageEvent) => void | (() => void)) {
    if (type === 'message') {
      this.messageHandlers.push(handler as (event: MessageEvent) => void);
    } else if (type === 'error') {
      this.errorHandlers.push(handler as () => void);
    }
  }
  
  removeEventListener(type: string, handler: (event: MessageEvent) => void | (() => void)) {
    if (type === 'message') {
      const index = this.messageHandlers.indexOf(handler as (event: MessageEvent) => void);
      if (index > -1) this.messageHandlers.splice(index, 1);
    } else if (type === 'error') {
      const index = this.errorHandlers.indexOf(handler as () => void);
      if (index > -1) this.errorHandlers.splice(index, 1);
    }
  }
  
  postMessage(data: { type: string; id: string; payload?: { text: string } }) {
    // Simulate realistic async worker behavior
    setTimeout(() => {
      if (!this.isHealthy && Math.random() < 0.3) {
        // Simulate worker error
        this.errorHandlers.forEach(handler => handler());
        return;
      }
      
      if (data.type === 'COUNT_TOKENS' && data.payload) {
        // Simple token estimation: 4 chars per token
        const tokenCount = Math.ceil(data.payload.text.length / 4);
        const event = new MessageEvent('message', {
          data: { type: 'TOKEN_COUNT', id: data.id, result: tokenCount, fallback: false }
        });
        this.messageHandlers.forEach(handler => handler(event));
      } else if (data.type === 'HEALTH_CHECK') {
        const event = new MessageEvent('message', {
          data: { type: 'HEALTH_RESPONSE', id: data.id, healthy: true }
        });
        this.messageHandlers.forEach(handler => handler(event));
      }
    }, Math.random() * 20 + 5); // 5-25ms delay
  }
  
  terminate() {
    this.isHealthy = false;
    this.messageHandlers.length = 0;
    this.errorHandlers.length = 0;
  }
  
  // Test utility methods
  simulateError() {
    this.isHealthy = false;
    this.errorHandlers.forEach(handler => handler());
  }
  
  simulateHealthy() {
    this.isHealthy = true;
  }
}