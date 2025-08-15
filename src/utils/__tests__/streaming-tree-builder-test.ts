import { StreamingTreeBuilder } from '../streaming-tree-builder';
import type { FileData } from '../../types/file-types';
import type { TreeChunk } from '../streaming-tree-builder';

// Mock Worker
type MessageHandler = (event: MessageEvent) => void;
type ErrorHandler = (event: ErrorEvent) => void;
type EventHandler = MessageHandler | ErrorHandler;

class MockWorker {
  private listeners: Map<string, EventHandler[]> = new Map();
  public terminated = false;

  addEventListener(event: string, handler: EventHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  removeEventListener(event: string, handler: EventHandler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  postMessage(data: {
    allFiles: FileData[];
    chunkSize: number;
    selectedFolder?: string | null;
    expandedNodes?: Record<string, boolean>;
    id: string;
  }) {
    // Simulate async processing
    setTimeout(() => {
      if (this.terminated) return;

      const handlers = this.listeners.get('message');
      if (handlers) {
        // Simulate chunk processing
        const chunk: TreeChunk = {
          nodes: [{ 
            id: 'test-id',
            name: 'test', 
            path: '/test', 
            type: 'directory' as const,
            level: 0,
            children: [] 
          }],
          progress: 50,
        };

        for (const handler of handlers) {
          (handler as MessageHandler)(new MessageEvent('message', {
            data: {
              type: 'TREE_CHUNK',
              id: data.id,
              payload: chunk,
            },
          }));
        }

        // Simulate completion
        setTimeout(() => {
          if (this.terminated) return;
          for (const handler of handlers) {
            (handler as MessageHandler)(new MessageEvent('message', {
              data: {
                type: 'TREE_COMPLETE',
                id: data.id,
              },
            }));
          }
        }, 10);
      }
    }, 10);
  }

  terminate() {
    this.terminated = true;
    this.listeners.clear();
  }

  triggerError(error: string, id: string) {
    const handlers = this.listeners.get('message');
    if (handlers && !this.terminated) {
      for (const handler of handlers) {
        (handler as MessageHandler)(new MessageEvent('message', {
          data: {
            type: 'TREE_ERROR',
            id,
            error,
          },
        }));
      }
    }
  }

  triggerWorkerError(message: string) {
    const handlers = this.listeners.get('error');
    if (handlers && !this.terminated) {
      for (const handler of handlers) {
        (handler as ErrorHandler)(new ErrorEvent('error', { message }));
      }
    }
  }
}

// Mock the Worker constructor
const originalWorker = global.Worker;
beforeAll(() => {
  Object.defineProperty(global, 'Worker', {
    writable: true,
    configurable: true,
    value: MockWorker,
  });
});

afterAll(() => {
  Object.defineProperty(global, 'Worker', {
    writable: true,
    configurable: true,
    value: originalWorker,
  });
});

// Helper function to create mock file data
const createMockFile = (path: string, options: Partial<FileData> = {}): FileData => ({
  name: path.split('/').pop() || '',
  path,
  isDirectory: false,
  size: 100,
  isBinary: false,
  isSkipped: false,
  isContentLoaded: false,
  tokenCount: 0,
  ...options,
});

describe('StreamingTreeBuilder', () => {

  describe('start', () => {
    it('should process files and call onChunk callback', (done) => {
      const files = [
        createMockFile('/src/file1.ts'),
        createMockFile('/src/file2.ts'),
      ];

      const builder = new StreamingTreeBuilder(files, 500);
      const chunks: TreeChunk[] = [];

      builder.start(
        (chunk) => {
          chunks.push(chunk);
          expect(chunk.nodes).toBeDefined();
          expect(chunk.progress).toBeGreaterThanOrEqual(0);
          expect(chunk.progress).toBeLessThanOrEqual(100);
        },
        () => {
          expect(chunks.length).toBeGreaterThan(0);
          done();
        },
        (error) => {
          done(error);
        }
      );
    });

    it('should call onComplete when processing finishes', (done) => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      let completeCalled = false;

      builder.start(
        () => {},
        () => {
          completeCalled = true;
          expect(completeCalled).toBe(true);
          done();
        },
        (error) => {
          done(error);
        }
      );
    });

    it('should handle errors from worker', (done) => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      builder.start(
        () => {},
        () => {
          done(new Error('Should not complete'));
        },
        (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toContain('Test error');
          done();
        }
      );

      // Trigger error after a delay
      setTimeout(() => {
        const builderPrivate = builder as unknown as { worker: MockWorker | null; id: string };
        if (builderPrivate.worker instanceof MockWorker) {
          builderPrivate.worker.triggerError('Test error', builderPrivate.id);
        }
      }, 5);
    });

    it('should handle worker errors', (done) => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      builder.start(
        () => {},
        () => {
          done(new Error('Should not complete'));
        },
        (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toContain('Worker error');
          done();
        }
      );

      // Trigger worker error after a delay
      setTimeout(() => {
        const worker = (builder as any).worker as MockWorker;
        worker.triggerWorkerError('Worker crashed');
      }, 5);
    });

    it('should pass configuration to worker', (done) => {
      const files = [createMockFile('/test.ts')];
      const selectedFolder = '/src';
      const expandedNodes = { '/src': true, '/test': false };
      const chunkSize = 1000;

      const builder = new StreamingTreeBuilder(files, chunkSize, selectedFolder, expandedNodes);

      // Override postMessage to check data
      const worker = new MockWorker();
      const originalPostMessage = worker.postMessage;
      worker.postMessage = function(data: any) {
        expect(data.allFiles).toEqual(files);
        expect(data.chunkSize).toBe(chunkSize);
        expect(data.selectedFolder).toBe(selectedFolder);
        expect(data.expandedNodes).toEqual(expandedNodes);
        expect(data.id).toBeDefined();
        done();
        originalPostMessage.call(this, data);
      };

      (builder as any).worker = worker;
      builder.start(() => {}, () => {}, () => {});
    });

    it('should ignore messages from other instances', (done) => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      let chunkReceived = false;

      builder.start(
        () => {
          chunkReceived = true;
        },
        () => {
          expect(chunkReceived).toBe(true);
          done();
        },
        (error) => {
          done(error);
        }
      );

      // Send message with wrong ID
      setTimeout(() => {
        const worker = (builder as any).worker as MockWorker;
        const handlers = (worker as any).listeners.get('message');
        if (handlers) {
          for (const handler of handlers) {
            handler({
              data: {
                type: 'TREE_CHUNK',
                id: 'wrong-id',
                payload: { nodes: [], progress: 0 },
              },
            });
          }
        }
      }, 5);
    });
  });

  describe('cancel', () => {
    it('should abort processing and cleanup resources', (done) => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      let chunkCount = 0;

      builder.start(
        () => {
          chunkCount++;
        },
        () => {
          done(new Error('Should not complete after cancel'));
        },
        () => {
          done(new Error('Should not error after cancel'));
        }
      );

      setTimeout(() => {
        builder.cancel();
        const worker = (builder as any).worker;
        expect(worker).toBeNull();

        // Wait to ensure no callbacks are called
        setTimeout(() => {
          expect(chunkCount).toBe(0);
          done();
        }, 50);
      }, 5);
    });

    it('should terminate worker when cancelled', () => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      builder.start(() => {}, () => {}, () => {});

      const worker = (builder as any).worker as MockWorker;
      expect(worker.terminated).toBe(false);

      builder.cancel();

      expect(worker.terminated).toBe(true);
      const builderPrivate = builder as unknown as { worker: MockWorker | null };
      expect(builderPrivate.worker).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners before terminating worker', (done) => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      builder.start(
        () => {},
        () => {
          // Check that handlers were cleaned up
          const messageHandler = (builder as any).messageHandler;
          const errorHandler = (builder as any).errorHandler;
          
          expect(messageHandler).toBeNull();
          expect(errorHandler).toBeNull();
          done();
        },
        (error) => {
          done(error);
        }
      );
    });

    it('should handle cleanup when worker creation fails', () => {
      // Temporarily replace Worker to throw
      Object.defineProperty(global, 'Worker', {
        writable: true,
        configurable: true,
        value: function() {
          throw new Error('Worker creation failed');
        },
      });

      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      let errorCalled = false;

      builder.start(
        () => {},
        () => {},
        (error) => {
          errorCalled = true;
          expect(error.message).toContain('Worker creation failed');
        }
      );

      expect(errorCalled).toBe(true);
      const builderPrivate = builder as unknown as { worker: MockWorker | null };
      expect(builderPrivate.worker).toBeNull();

      // Restore MockWorker
      (global as any).Worker = MockWorker;
    });

    it('should handle multiple cancel calls gracefully', () => {
      const files = [createMockFile('/test.ts')];
      const builder = new StreamingTreeBuilder(files);

      builder.start(() => {}, () => {}, () => {});

      // Cancel multiple times
      builder.cancel();
      builder.cancel();
      builder.cancel();

      const builderPrivate = builder as unknown as { worker: MockWorker | null };
      expect(builderPrivate.worker).toBeNull();
    });
  });
});