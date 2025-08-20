import { StreamingWorkerBase } from '../../worker-base/streaming-worker-base';

// Types for test implementation
interface TestStartReq {
  files: string[];
  selectedFolder: string | null;
}

interface TestChunk {
  nodes: string[];
  progress: number;
}

interface TestDone {
  nodes: string[];
  progress: number;
}

// Mock Worker
type WorkerMessage = {
  type: string;
  id?: string;
  payload?: unknown;
  error?: string;
};

type MessageHandler = (event: MessageEvent) => void;
type ErrorHandler = (event: ErrorEvent) => void;

class MockWorker {
  private listeners = new Map<string, Array<MessageHandler | ErrorHandler>>();
  public terminated = false;
  public messages: WorkerMessage[] = [];
  
  constructor(public url: string | URL, public options?: WorkerOptions) {}
  
  addEventListener(type: string, listener: MessageHandler | ErrorHandler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)?.push(listener);
  }
  
  removeEventListener(type: string, listener: MessageHandler | ErrorHandler) {
    const handlers = this.listeners.get(type) || [];
    const index = handlers.indexOf(listener);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }
  
  postMessage(message: WorkerMessage) {
    this.messages.push(message);
    
    // Auto-respond to INIT
    if (message.type === 'INIT') {
      setTimeout(() => {
        this.emit('message', { data: { type: 'READY' } } as MessageEvent);
      }, 0);
    }
  }
  
  terminate() {
    this.terminated = true;
  }
  
  emit(type: string, event: MessageEvent | ErrorEvent) {
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      (handler as (e: MessageEvent | ErrorEvent) => void)(event);
    }
  }
  
  sendReady() {
    setTimeout(() => {
      this.emit('message', { data: { type: 'READY' } } as MessageEvent);
    }, 0);
  }
  
  sendChunk(id: string, chunk: TestChunk) {
    this.emit('message', { 
      data: { type: 'TREE_CHUNK', id, payload: chunk } 
    } as MessageEvent);
  }
  
  sendComplete(id: string, done: TestDone) {
    this.emit('message', { 
      data: { type: 'TREE_COMPLETE', id, payload: done } 
    } as MessageEvent);
  }
  
  sendError(id: string, error: string) {
    this.emit('message', { 
      data: { type: 'TREE_ERROR', id, error } 
    } as MessageEvent);
  }
  
  sendCancelled(id: string) {
    this.emit('message', { 
      data: { type: 'CANCELLED', id } 
    } as MessageEvent);
  }
}

// Test implementation
class TestStreamingWorker extends StreamingWorkerBase<TestStartReq, TestChunk, TestDone> {
  protected buildInitMessage() {
    return { type: 'INIT' };
  }
  
  protected buildStartMessage(req: TestStartReq, id: string) {
    return { 
      type: 'BUILD_TREE', 
      id,
      allFiles: req.files,
      selectedFolder: req.selectedFolder
    };
  }
  
  protected buildCancelMessage(id: string) {
    return { type: 'CANCEL', id };
  }
  
  protected parseChunk(event: MessageEvent, id: string): TestChunk | null {
    if (event.data?.type === 'TREE_CHUNK' && event.data?.id === id) {
      return event.data.payload as TestChunk;
    }
    return null;
  }
  
  protected parseComplete(event: MessageEvent, id: string): TestDone | null {
    if (event.data?.type === 'TREE_COMPLETE' && event.data?.id === id) {
      return event.data.payload as TestDone;
    }
    return null;
  }
  
  protected parseError(event: MessageEvent, id: string): Error | null {
    if (event.data?.type === 'TREE_ERROR' && event.data?.id === id) {
      return new Error(event.data.error || 'TREE_ERROR');
    }
    return null;
  }
  
  protected isCancelledAck(event: MessageEvent, id: string): boolean {
    return event.data?.type === 'CANCELLED' && event.data?.id === id;
  }
  
  protected hashRequest(req: TestStartReq): string {
    return `${req.files.sort().join('|')}:${req.selectedFolder || ''}`;
  }
}

describe('StreamingWorkerBase', () => {
  let originalWorker: typeof Worker;
  let mockWorkers: MockWorker[];
  
  beforeEach(() => {
    jest.useFakeTimers();
    mockWorkers = [];
    originalWorker = global.Worker as typeof Worker;
    
    (global as { Worker: unknown }).Worker = jest.fn((url: string | URL, options?: WorkerOptions) => {
      const worker = new MockWorker(url, options);
      mockWorkers.push(worker);
      worker.sendReady();
      return worker;
    });
  });
  
  afterEach(() => {
    jest.useRealTimers();
    global.Worker = originalWorker;
  });
  
  describe('cancel timeout', () => {
    it('should force cleanup after cancel timeout', async () => {
      const worker = new TestStreamingWorker(
        '../workers/test-worker.ts',
        {
          readySignalType: 'READY',
          initRequestType: 'INIT',
          initResponseType: 'READY',
          errorType: 'TREE_ERROR'
        },
        5000, // initTimeoutMs
        100 // Short cancel timeout
      );
      
      const chunks: TestChunk[] = [];
      const errors: Error[] = [];
      let completed = false;
      
      const handle = worker.startStreaming(
        { files: ['file1.ts', 'file2.ts'], selectedFolder: null },
        {
          onChunk: (chunk) => chunks.push(chunk),
          onComplete: () => { completed = true; },
          onError: (error) => errors.push(error)
        }
      );
      
      // Wait for initialization and start
      await jest.runOnlyPendingTimersAsync();
      
      // Send a chunk to confirm it's working
      const buildMessage = mockWorkers[0].messages.find(m => m.type === 'BUILD_TREE');
      expect(buildMessage).toBeDefined();
      
      mockWorkers[0].sendChunk(buildMessage!.id!, { 
        nodes: ['node1'], 
        progress: 50 
      });
      
      expect(chunks).toHaveLength(1);
      
      // Cancel but don't send CANCELLED ack
      await handle.cancel();
      
      // Should have sent CANCEL message
      const cancelMessage = mockWorkers[0].messages.find(m => m.type === 'CANCEL');
      expect(cancelMessage).toBeDefined();
      
      // Advance past cancel timeout
      await jest.advanceTimersByTimeAsync(150);
      
      // Should be cleaned up and ready for next
      // Queue another request to verify worker is ready
      const handle2 = worker.startStreaming(
        { files: ['file3.ts'], selectedFolder: null },
        {
          onChunk: () => {},
          onComplete: () => {},
          onError: () => {}
        }
      );
      
      await jest.runOnlyPendingTimersAsync();
      
      // Should have sent new BUILD_TREE message
      const newBuildMessage = mockWorkers[0].messages.filter(m => m.type === 'BUILD_TREE');
      expect(newBuildMessage).toHaveLength(2);
      
      await worker.terminate();
    });
  });
  
  describe('deduplication', () => {
    it('should replace queued identical request', async () => {
      const worker = new TestStreamingWorker(
        '../workers/test-worker.ts',
        {
          readySignalType: 'READY',
          initRequestType: 'INIT',
          initResponseType: 'READY',
          errorType: 'TREE_ERROR'
        },
        5000,
        2000
      );
      
      const request1Results: { chunks: TestChunk[]; completed: boolean } = {
        chunks: [],
        completed: false
      };
      
      const request2Results: { chunks: TestChunk[]; completed: boolean } = {
        chunks: [],
        completed: false
      };
      
      // Start first request
      worker.startStreaming(
        { files: ['file1.ts'], selectedFolder: null },
        {
          onChunk: (chunk) => request1Results.chunks.push(chunk),
          onComplete: () => { request1Results.completed = true; },
          onError: () => {}
        }
      );
      
      // Queue identical request (should replace first)
      worker.startStreaming(
        { files: ['file1.ts'], selectedFolder: null },
        {
          onChunk: (chunk) => request2Results.chunks.push(chunk),
          onComplete: () => { request2Results.completed = true; },
          onError: () => {}
        }
      );
      
      await jest.runOnlyPendingTimersAsync();
      
      // Complete the build
      const buildMessage = mockWorkers[0].messages.find(m => m.type === 'BUILD_TREE');
      mockWorkers[0].sendComplete(buildMessage!.id!, { 
        nodes: ['node1'], 
        progress: 100 
      });
      
      await jest.runOnlyPendingTimersAsync();
      
      // Only second request should have results
      expect(request1Results.completed).toBe(false);
      expect(request2Results.completed).toBe(true);
      
      await worker.terminate();
    });
  });
  
  describe('error handling', () => {
    it('should reset to uninitialized on error', async () => {
      const worker = new TestStreamingWorker(
        '../workers/test-worker.ts',
        {
          readySignalType: 'READY',
          initRequestType: 'INIT',
          initResponseType: 'READY',
          errorType: 'TREE_ERROR'
        },
        5000,
        2000
      );
      
      let errorReceived: Error | null = null;
      
      worker.startStreaming(
        { files: ['file1.ts'], selectedFolder: null },
        {
          onChunk: () => {},
          onComplete: () => {},
          onError: (error) => { errorReceived = error; }
        }
      );
      
      await jest.runOnlyPendingTimersAsync();
      
      // Send error
      const buildMessage = mockWorkers[0].messages.find(m => m.type === 'BUILD_TREE');
      mockWorkers[0].sendError(buildMessage!.id!, 'Test error');
      
      await jest.runOnlyPendingTimersAsync();
      
      expect(errorReceived).toEqual(new Error('Test error'));
      expect(mockWorkers[0].terminated).toBe(true);
      
      // Next request should trigger re-initialization
      worker.startStreaming(
        { files: ['file2.ts'], selectedFolder: null },
        {
          onChunk: () => {},
          onComplete: () => {},
          onError: () => {}
        }
      );
      
      await jest.runOnlyPendingTimersAsync();
      
      // Should have created a new worker
      expect(mockWorkers).toHaveLength(2);
      expect(mockWorkers[1].messages.some(m => m.type === 'INIT')).toBe(true);
      
      await worker.terminate();
    });
  });
});