import { DiscreteWorkerPoolBase } from '../../worker-base/discrete-worker-pool-base';
import type { HandshakeConfig } from '../../worker-base/worker-common';

// Mock Worker class
type WorkerMessage = {
  type: string;
  id?: string;
  payload?: unknown;
  result?: number;
  results?: number[];
  healthy?: boolean;
};

type MessageHandler = (event: MessageEvent) => void;
type ErrorHandler = (event: ErrorEvent) => void;
type Handler = MessageHandler | ErrorHandler;

class MockWorker {
  private listeners: Map<string, Handler[]> = new Map();
  public terminated = false;
  public messages: WorkerMessage[] = [];
  
  constructor(public url: string | URL, public options?: WorkerOptions) {}
  
  addEventListener(type: string, listener: Handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)?.push(listener);
  }
  
  removeEventListener(type: string, listener: Handler) {
    const handlers = this.listeners.get(type) || [];
    const index = handlers.indexOf(listener);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }
  
  postMessage(message: WorkerMessage) {
    this.messages.push(message);
    
    // Auto-respond to handshake
    if (message.type === 'INIT') {
      setTimeout(() => {
        this.emit('message', { data: { type: 'INIT_COMPLETE', id: message.id } } as MessageEvent);
      }, 0);
    }
    
    // Auto-respond to health check
    if (message.type === 'HEALTH_CHECK') {
      setTimeout(() => {
        this.emit('message', { data: { type: 'HEALTH_RESPONSE', healthy: true } } as MessageEvent);
      }, 0);
    }
  }
  
  terminate() {
    this.terminated = true;
  }
  
  emit(type: string, event: MessageEvent | ErrorEvent) {
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      handler(event as MessageEvent & ErrorEvent);
    }
  }
  
  // Helper to send ready signal
  sendReady() {
    setTimeout(() => {
      this.emit('message', { data: { type: 'WORKER_READY' } });
    }, 0);
  }
}

// Test implementation
class TestWorkerPool extends DiscreteWorkerPoolBase<{ text: string }, number> {
  public mockWorkers: MockWorker[] = [];
  
  protected buildJobMessage(request: { text: string }, id: string) {
    return { type: 'COUNT_TOKENS', id, payload: { text: request.text } };
  }
  
  protected parseJobResult(event: MessageEvent, request: { text: string }) {
    if (event.data?.type === 'TOKEN_COUNT' && event.data?.id) {
      return { value: event.data.result ?? 0, usedFallback: false };
    }
    return null;
  }
  
  protected buildBatchJobMessage(requests: { text: string }[], id: string) {
    return { type: 'BATCH_COUNT', id, payload: { texts: requests.map(r => r.text) } };
  }
  
  protected parseBatchJobResult(event: MessageEvent, requests: { text: string }[]) {
    if (event.data?.type === 'BATCH_RESULT') {
      return event.data.results as number[];
    }
    return null;
  }
  
  protected fallbackValue(request: { text: string }) {
    return Math.ceil(request.text.length / 4);
  }
  
  protected hashRequest(request: { text: string }) {
    return `${request.text.length}-${request.text}`;
  }
}

describe('DiscreteWorkerPoolBase', () => {
  let originalWorker: typeof Worker;
  let mockWorkers: MockWorker[];
  
  beforeEach(() => {
    jest.useFakeTimers();
    mockWorkers = [];
    originalWorker = global.Worker as typeof Worker;
    
    // Mock Worker constructor
    (global as any).Worker = jest.fn((url: string | URL, options?: WorkerOptions) => {
      const worker = new MockWorker(url, options);
      mockWorkers.push(worker);
      // Auto-send ready signal
      worker.sendReady();
      return worker;
    });
  });
  
  afterEach(() => {
    jest.useRealTimers();
    global.Worker = originalWorker;
  });
  
  describe('deduplication', () => {
    it('should return same promise for identical hash', async () => {
      const pool = new TestWorkerPool(
        2, // poolSize
        '../workers/test-worker.ts',
        {
          readySignalType: 'WORKER_READY',
          initRequestType: 'INIT',
          initResponseType: 'INIT_COMPLETE',
          errorType: 'ERROR',
          healthCheckType: 'HEALTH_CHECK',
          healthResponseType: 'HEALTH_RESPONSE'
        },
        30_000, // operationTimeoutMs
        1000, // healthCheckTimeoutMs
        30, // healthMonitorIntervalSec
        100 // queueMaxSize
      );
      
      // Wait for initialization
      await jest.runOnlyPendingTimersAsync();
      
      const request = { text: 'test content' };
      const promise1 = pool.countOne(request);
      const promise2 = pool.countOne(request);
      
      // Should be the same promise instance
      expect(promise1).toBe(promise2);
      
      // Simulate worker response
      setTimeout(() => {
        mockWorkers[0].emit('message', {
          data: { type: 'TOKEN_COUNT', id: mockWorkers[0].messages[1]?.id, result: 3 }
        });
      }, 10);
      
      await jest.runOnlyPendingTimersAsync();
      
      const result1 = await promise1;
      const result2 = await promise2;
      
      expect(result1).toBe(3);
      expect(result2).toBe(3);
      
      // Only one job message should be sent (after init)
      const jobMessages = mockWorkers.flatMap(w => w.messages).filter(m => m.type === 'COUNT_TOKENS');
      expect(jobMessages).toHaveLength(1);
    });
  });
  
  describe('queue management', () => {
    it('should drop lowest priority when queue full', async () => {
      const pool = new TestWorkerPool(
        1, // Only 1 worker
        '../workers/test-worker.ts',
        {
          readySignalType: 'WORKER_READY',
          initRequestType: 'INIT',
          initResponseType: 'INIT_COMPLETE',
          errorType: 'ERROR'
        },
        30_000,
        1000,
        30,
        2 // Small queue size
      );
      
      // Wait for initialization
      await jest.runOnlyPendingTimersAsync();
      
      // Block the worker with a job
      const blockingPromise = pool.countOne({ text: 'blocking' });
      
      // Add 3 more jobs with different priorities (queue max is 2)
      const promise1 = pool.countOne({ text: 'priority0' }, { priority: 0 });
      const promise2 = pool.countOne({ text: 'priority10a' }, { priority: 10 });
      const promise3 = pool.countOne({ text: 'priority10b' }, { priority: 10 });
      
      // The last job with priority 10 should be dropped and resolved with fallback
      const result3 = await promise3;
      expect(result3).toBe(Math.ceil('priority10b'.length / 4)); // Fallback value
      
      pool.terminate();
    });
  });
  
  describe('timeout handling', () => {
    it('should resolve with fallback on timeout', async () => {
      const pool = new TestWorkerPool(
        1,
        '../workers/test-worker.ts',
        {
          readySignalType: 'WORKER_READY',
          initRequestType: 'INIT',
          initResponseType: 'INIT_COMPLETE',
          errorType: 'ERROR'
        },
        100, // Short timeout
        1000,
        30,
        100
      );
      
      // Wait for initialization
      await jest.runOnlyPendingTimersAsync();
      
      const request = { text: 'timeout test' };
      const promise = pool.countOne(request);
      
      // Don't respond, let it timeout
      await jest.advanceTimersByTimeAsync(150);
      
      const result = await promise;
      expect(result).toBe(Math.ceil(request.text.length / 4)); // Fallback value
      
      pool.terminate();
    });
  });
  
  describe('recovery lock', () => {
    it('should prevent duplicate recoveries', async () => {
      const pool = new TestWorkerPool(
        2,
        '../workers/test-worker.ts',
        {
          readySignalType: 'WORKER_READY',
          initRequestType: 'INIT',
          initResponseType: 'INIT_COMPLETE',
          errorType: 'ERROR',
          healthCheckType: 'HEALTH_CHECK',
          healthResponseType: 'HEALTH_RESPONSE'
        },
        30_000,
        100, // Short health check timeout
        30,
        100
      );
      
      // Wait for initialization
      await jest.runOnlyPendingTimersAsync();
      
      const workersBefore = mockWorkers.length;
      
      // Make first worker unhealthy by not responding to health check
      mockWorkers[0].postMessage = jest.fn();
      
      // Trigger multiple health checks concurrently
      const promise1 = pool.performHealthMonitoring();
      const promise2 = pool.performHealthMonitoring();
      
      await jest.advanceTimersByTimeAsync(200);
      await Promise.all([promise1, promise2]);
      
      // Should only create one new worker for recovery
      const workersAfter = mockWorkers.length;
      expect(workersAfter - workersBefore).toBe(1);
      
      pool.terminate();
    });
  });
});