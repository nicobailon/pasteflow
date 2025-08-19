// Mock token counter worker for testing

import { TOKEN_COUNTING } from '@constants';

// Worker message types based on real implementation
interface WorkerInitMessage {
  type: 'INIT';
  id: string;
}

interface WorkerCountTokensMessage {
  type: 'COUNT_TOKENS';
  id: string;
  payload: { text: string };
}

interface WorkerBatchCountMessage {
  type: 'BATCH_COUNT';
  id: string;
  payload: { texts: string[] };
}

interface WorkerHealthCheckMessage {
  type: 'HEALTH_CHECK';
  id: string;
}

type WorkerIncomingMessage = 
  | WorkerInitMessage 
  | WorkerCountTokensMessage 
  | WorkerBatchCountMessage 
  | WorkerHealthCheckMessage;

// Worker response types
interface WorkerInitCompleteResponse {
  type: 'INIT_COMPLETE';
  id: string;
  success: boolean;
}

interface WorkerTokenCountResponse {
  type: 'TOKEN_COUNT';
  id: string;
  result: number;
  fallback: boolean;
}

interface WorkerBatchResultResponse {
  type: 'BATCH_RESULT';
  id: string;
  results: number[];
}

interface WorkerHealthCheckResponse {
  type: 'HEALTH_RESPONSE';
  id: string;
  healthy: boolean;
}

interface WorkerErrorResponse {
  type: 'ERROR';
  id: string;
  error: string;
}

type WorkerOutgoingMessage = 
  | WorkerInitCompleteResponse 
  | WorkerTokenCountResponse 
  | WorkerBatchResultResponse 
  | WorkerHealthCheckResponse 
  | WorkerErrorResponse;

export default class TokenCounterWorker {
  onmessage: ((event: MessageEvent<WorkerOutgoingMessage>) => void) | null = null;
  
  postMessage(data: WorkerIncomingMessage): void {
    // Simulate worker behavior with realistic timing
    setTimeout(() => {
      if (this.onmessage) {
        switch (data.type) {
          case 'INIT':
            this.onmessage(new MessageEvent('message', {
              data: { type: 'INIT_COMPLETE', id: data.id, success: true } satisfies WorkerInitCompleteResponse
            }));
            break;
            
          case 'COUNT_TOKENS':
            // Simple approximation using constant
            const tokenCount = Math.ceil(data.payload.text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
            this.onmessage(new MessageEvent('message', {
              data: { type: 'TOKEN_COUNT', id: data.id, result: tokenCount, fallback: false } satisfies WorkerTokenCountResponse
            }));
            break;
            
          case 'BATCH_COUNT':
            const results = data.payload.texts.map(text => Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN));
            this.onmessage(new MessageEvent('message', {
              data: { type: 'BATCH_RESULT', id: data.id, results } satisfies WorkerBatchResultResponse
            }));
            break;
            
          case 'HEALTH_CHECK':
            this.onmessage(new MessageEvent('message', {
              data: { type: 'HEALTH_RESPONSE', id: data.id, healthy: true } satisfies WorkerHealthCheckResponse
            }));
            break;
        }
      }
    }, 10);
  }
  
  terminate(): void {
    // Mock terminate method
  }
}