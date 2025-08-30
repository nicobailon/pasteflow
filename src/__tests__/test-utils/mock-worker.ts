import { TOKEN_COUNTING } from '@constants';

export interface MockWorkerOptions {
  autoRespond?: boolean;
  responseDelay?: number;
  errorOnMessage?: boolean;
  crashAfterMessages?: number;
}

export class MockWorker {
  private messageHandlers: ((event: MessageEvent) => void)[] = [];
  private errorHandlers: ((event: ErrorEvent) => void)[] = [];
  private messageCount = 0;
  public terminated = false;
  
  constructor(private options: MockWorkerOptions = {}) {}
  
  addEventListener(event: string, handler: Function): void {
    if (event === 'message') {
      this.messageHandlers.push(handler as (event: MessageEvent) => void);
    } else if (event === 'error') {
      this.errorHandlers.push(handler as (event: ErrorEvent) => void);
    }
  }
  
  removeEventListener(event: string, handler: Function): void {
    if (event === 'message') {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    } else if (event === 'error') {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    }
  }
  
  postMessage(data: { type: string; id?: string; payload?: { text: string } }): void {
    if (this.terminated) {
      throw new Error('Worker has been terminated');
    }
    
    this.messageCount++;
    
    if (this.options.crashAfterMessages && this.messageCount >= this.options.crashAfterMessages) {
      this.simulateError(new Error('Worker crashed'));
      return;
    }
    
    if (this.options.errorOnMessage) {
      this.simulateError(new Error('Worker error'));
      return;
    }
    
    if (this.options.autoRespond) {
      setTimeout(() => {
        if (!this.terminated) {
          if (data.type === 'INIT') {
            this.simulateMessage({ type: 'INIT_COMPLETE', id: data.id, success: true });
          } else if (data.type === 'HEALTH_CHECK') {
            this.simulateMessage({ type: 'HEALTH_RESPONSE', id: data.id, healthy: true });
          } else if (data.type === 'COUNT_TOKENS' && data.payload) {
            const tokenCount = Math.ceil(data.payload.text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
            this.simulateMessage({ 
              type: 'TOKEN_COUNT', 
              id: data.id, 
              result: tokenCount,
              fallback: false 
            });
          }
        }
      }, this.options.responseDelay || 0);
    }
  }
  
  simulateMessage(data: Record<string, unknown>): void {
    const event = new MessageEvent('message', { data });
    this.messageHandlers.forEach(handler => handler(event));
  }
  
  simulateError(error: Error): void {
    const event = new ErrorEvent('error', { error });
    this.errorHandlers.forEach(handler => handler(event));
  }
  
  terminate(): void {
    this.terminated = true;
    this.messageHandlers = [];
    this.errorHandlers = [];
  }
}

export const createMockWorker = (options?: MockWorkerOptions): MockWorker => new MockWorker(options);

export const createCrashingWorker = (): MockWorker => createMockWorker({ 
  crashAfterMessages: 1 
});

export const createSlowWorker = (delay: number): MockWorker => createMockWorker({ 
  autoRespond: true, 
  responseDelay: delay 
});

export const createFailingWorker = (): MockWorker => createMockWorker({ 
  errorOnMessage: true 
});