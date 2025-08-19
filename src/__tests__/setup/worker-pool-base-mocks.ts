/**
 * Consolidated mocks for worker pool base classes
 */

const CHARS_PER_TOKEN = 4;

// Mock Worker class for tests
export class MockWorker {
  private listeners = new Map<string, Array<(event: MessageEvent | ErrorEvent) => void>>();
  public terminated = false;
  public messages: Array<{ type: string; id?: string; payload?: unknown }> = [];
  public url: string | URL;
  public options?: WorkerOptions;

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    
    // Auto-send ready signal after construction
    setTimeout(() => {
      this.emit('message', { 
        data: { type: this.getReadyType() } 
      } as MessageEvent);
    }, 0);
  }

  private getReadyType(): string {
    // Determine ready type based on worker URL
    const urlStr = typeof this.url === 'string' ? this.url : this.url.toString();
    if (urlStr.includes('token-counter')) {
      return 'WORKER_READY';
    } else if (urlStr.includes('tree-builder')) {
      return 'READY';
    }
    return 'READY';
  }

  addEventListener(type: string, listener: (event: MessageEvent | ErrorEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)?.push(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent | ErrorEvent) => void) {
    const handlers = this.listeners.get(type) || [];
    const index = handlers.indexOf(listener);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }

  postMessage(message: { type: string; id?: string; payload?: unknown }) {
    this.messages.push(message);
    
    // Handle different message types
    switch (message.type) {
      case 'INIT':
        setTimeout(() => {
          if (this.url.toString().includes('token-counter')) {
            this.emit('message', { 
              data: { type: 'INIT_COMPLETE', id: message.id } 
            } as MessageEvent);
          } else {
            this.emit('message', { 
              data: { type: 'READY' } 
            } as MessageEvent);
          }
        }, 0);
        break;
        
      case 'COUNT_TOKENS':
        if (message.payload && typeof (message.payload as { text?: string }).text === 'string') {
          const text = (message.payload as { text: string }).text;
          setTimeout(() => {
            this.emit('message', {
              data: {
                type: 'TOKEN_COUNT',
                id: message.id,
                result: Math.ceil(text.length / CHARS_PER_TOKEN),
                fallback: false
              }
            } as MessageEvent);
          }, 10);
        }
        break;
        
      case 'BATCH_COUNT':
        if (message.payload && Array.isArray((message.payload as { texts?: string[] }).texts)) {
          const texts = (message.payload as { texts: string[] }).texts;
          setTimeout(() => {
            this.emit('message', {
              data: {
                type: 'BATCH_RESULT',
                id: message.id,
                results: texts.map(t => Math.ceil(t.length / CHARS_PER_TOKEN))
              }
            } as MessageEvent);
          }, 10);
        }
        break;
        
      case 'HEALTH_CHECK':
        setTimeout(() => {
          this.emit('message', {
            data: { type: 'HEALTH_RESPONSE', healthy: true }
          } as MessageEvent);
        }, 0);
        break;
        
      case 'BUILD_TREE':
        // Emit a few chunks then complete
        setTimeout(() => {
          this.emit('message', {
            data: {
              type: 'TREE_CHUNK',
              id: message.id,
              payload: { nodes: [], progress: 33 }
            }
          } as MessageEvent);
        }, 10);
        
        setTimeout(() => {
          this.emit('message', {
            data: {
              type: 'TREE_CHUNK',
              id: message.id,
              payload: { nodes: [], progress: 66 }
            }
          } as MessageEvent);
        }, 20);
        
        setTimeout(() => {
          this.emit('message', {
            data: {
              type: 'TREE_COMPLETE',
              id: message.id,
              payload: { nodes: [], progress: 100 }
            }
          } as MessageEvent);
        }, 30);
        break;
        
      case 'CANCEL':
        // Optionally emit CANCELLED ack
        if (!this.terminated) {
          setTimeout(() => {
            this.emit('message', {
              data: { type: 'CANCELLED', id: message.id }
            } as MessageEvent);
          }, 5);
        }
        break;
    }
  }

  terminate() {
    this.terminated = true;
    this.listeners.clear();
  }

  emit(type: string, event: MessageEvent | ErrorEvent) {
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      handler(event);
    }
  }

  // Test helper methods
  simulateCrash() {
    this.emit('error', new ErrorEvent('error', { message: 'Worker crashed' }));
    this.terminated = true;
  }

  simulateError(id: string, errorMessage: string) {
    this.emit('message', {
      data: { type: 'ERROR', id, error: errorMessage }
    } as MessageEvent);
  }

  simulateTreeError(id: string, errorMessage: string) {
    this.emit('message', {
      data: { type: 'TREE_ERROR', id, error: errorMessage }
    } as MessageEvent);
  }
}

// Mock TokenWorkerPool for tests that need the pool directly
export class MockTokenWorkerPool {
  private mockWorkers: MockWorker[] = [];
  
  constructor(private poolSize = 2) {
    // Create mock workers
    for (let i = 0; i < poolSize; i++) {
      this.mockWorkers.push(new MockWorker('/mock/token-counter-worker.ts'));
    }
  }

  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  async countTokensBatch(texts: string[]): Promise<number[]> {
    return texts.map(text => Math.ceil(text.length / CHARS_PER_TOKEN));
  }

  async healthCheck() {
    return this.mockWorkers.map((_, i) => ({
      workerId: i,
      healthy: true,
      responseTime: 10
    }));
  }

  async performHealthMonitoring() {
    // No-op for mock
  }

  terminate() {
    for (const worker of this.mockWorkers) {
      worker.terminate();
    }
  }

  cleanup() {
    this.terminate();
  }

  getPerformanceStats() {
    return {
      totalProcessed: 0,
      totalTime: 0,
      failureCount: 0,
      averageTime: 0
    };
  }

  getStatus() {
    return {
      isHealthy: true,
      activeJobs: 0,
      queueLength: 0,
      workerCount: this.poolSize
    };
  }
}

// Mock TreeBuilderWorkerPool for tests
export class MockTreeBuilderWorkerPool {
  private mockWorker: MockWorker | null = null;
  private initError: Error | null = null;
  
  constructor(options?: { failInit?: boolean }) {
    if (options?.failInit) {
      this.initError = new Error('Initialization failed');
    } else {
      this.mockWorker = new MockWorker('/mock/tree-builder-worker.ts');
    }
  }

  buildTree(
    files: unknown[],
    callbacks: {
      onChunk: (chunk: { nodes: unknown[]; progress: number }) => void;
      onComplete: () => void;
      onError: (error: Error) => void;
    }
  ) {
    if (this.initError) {
      setTimeout(() => callbacks.onError(this.initError!), 0);
      return { cancel: async () => {} };
    }

    let cancelled = false;
    
    // Simulate chunks
    setTimeout(() => {
      if (!cancelled) callbacks.onChunk({ nodes: [], progress: 50 });
    }, 10);
    
    setTimeout(() => {
      if (!cancelled) callbacks.onComplete();
    }, 20);
    
    return {
      cancel: async () => {
        cancelled = true;
      }
    };
  }

  isReady() {
    return !this.initError;
  }

  getInitializationError() {
    return this.initError;
  }

  async waitForInitialization() {
    if (this.initError) {
      throw this.initError;
    }
  }

  getStatus() {
    return {
      state: this.isReady() ? 'ready' : 'error',
      queueLength: 0,
      hasActiveBuild: false
    };
  }

  async retryInitialization() {
    this.initError = null;
    this.mockWorker = new MockWorker('/mock/tree-builder-worker.ts');
  }

  async cleanup() {
    if (this.mockWorker) {
      this.mockWorker.terminate();
    }
  }

  async terminate() {
    await this.cleanup();
  }
}

// Helper to install mock Worker globally
export function installMockWorker() {
  const originalWorker = global.Worker;
  
  (global as { Worker: unknown }).Worker = MockWorker as unknown as typeof Worker;
  
  return () => {
    global.Worker = originalWorker;
  };
}

// Re-export for backward compatibility
export { MockWorker as MockStreamingWorker };