// Declare jest global for test environment detection with precise type
declare const jest: { fn?: unknown } | undefined;

import { WORKER_POOL } from '@constants';
import { DiscreteWorkerPoolBase } from './worker-base/discrete-worker-pool-base';
import { estimateTokenCount } from './token-utils';

interface TokenRequest {
  text: string;
}

export class TokenWorkerPool extends DiscreteWorkerPoolBase<TokenRequest, number> {
  private performanceStats = {
    totalProcessed: 0,
    totalTime: 0,
    failureCount: 0,
    fallbackCount: 0
  };

  constructor(poolSize?: number) {
    super(
      poolSize ?? Math.min(navigator.hardwareConcurrency || WORKER_POOL.DEFAULT_WORKERS, WORKER_POOL.MAX_WORKERS),
      {
        readySignalType: 'WORKER_READY',
        initRequestType: 'INIT',
        initResponseType: 'INIT_COMPLETE',
        errorType: 'ERROR',
        healthCheckType: 'HEALTH_CHECK',
        healthResponseType: 'HEALTH_RESPONSE'
      },
      WORKER_POOL.OPERATION_TIMEOUT_MS,
      WORKER_POOL.HEALTH_CHECK_TIMEOUT_MS,
      WORKER_POOL.HEALTH_MONITOR_INTERVAL_SECONDS,
      WORKER_POOL.MAX_QUEUE_SIZE
    );
  }

  /**
   * Create the token counter worker with Vite-compatible static import
   */
  protected createWorker(): Worker {
    return new Worker(
      new URL('../workers/token-counter-worker.ts', import.meta.url),
      { type: 'module' }
    );
  }

  protected buildJobMessage(req: TokenRequest, id: string) {
    return {
      type: 'COUNT_TOKENS',
      id,
      payload: { text: req.text }
    };
  }

  protected parseJobResult(event: MessageEvent, req: TokenRequest) {
    if (!event?.data || event.data.id === undefined) {
      return null;
    }

    if (event.data.type === 'TOKEN_COUNT') {
      const usedFallback = !!event.data.fallback;
      const value = usedFallback ? this.fallbackValue(req) : Number(event.data.result ?? 0);
      if (usedFallback) {
        this.performanceStats.fallbackCount++;
      }
      return { value, usedFallback };
    }

    if (event.data.type === 'ERROR') {
      this.performanceStats.fallbackCount++;
      return { value: this.fallbackValue(req), usedFallback: true };
    }

    return null;
  }

  protected buildBatchJobMessage(reqs: TokenRequest[], id: string) {
    return {
      type: 'BATCH_COUNT',
      id,
      payload: { texts: reqs.map(r => r.text) }
    };
  }

  protected parseBatchJobResult(event: MessageEvent, _reqs: TokenRequest[]) {
    if (event?.data?.type === 'BATCH_RESULT' && Array.isArray(event.data.results)) {
      return event.data.results as number[];
    }
    return null;
  }

  protected fallbackValue(req: TokenRequest) {
    return estimateTokenCount(req.text);
  }

  protected hashRequest(req: TokenRequest): string {
    const text = req.text ?? '';
    let hash = 0;
    for (let i = 0; i < Math.min(text.length, 1024); i++) {
      hash = (hash << 5) - hash + (text.codePointAt(i) ?? 0);
      hash |= 0;
    }
    return `${text.length}-${hash}`;
  }

  protected onWorkerRecovered(workerId: number): void {
    // Optional: Track recovery metrics
    this.performanceStats.failureCount++;
  }

  // Public API methods that match the existing interface
  async countTokens(text: string, options?: { signal?: AbortSignal; priority?: number }): Promise<number> {
    if (this.getStats().isTerminated) {
      throw new Error('Worker pool has been terminated');
    }
    
    // Large input guard
    const size = new TextEncoder().encode(text).length;
    if (size > 10 * 1024 * 1024) {
      throw new Error('Text too large for processing');
    }
    
    const startTime = Date.now();
    
    try {
      const result = await this.countOne({ text }, options);
      this.performanceStats.totalProcessed++;
      this.performanceStats.totalTime += Date.now() - startTime;
      return result;
    } catch (error) {
      this.performanceStats.failureCount++;
      throw error;
    }
  }

  async countTokensBatch(texts: string[], options?: { signal?: AbortSignal; priority?: number }): Promise<number[]> {
    if (this.getStats().isTerminated) {
      throw new Error('Worker pool has been terminated');
    }
    
    const startTime = Date.now();
    
    try {
      const results = await this.countBatch(texts.map(text => ({ text })), options);
      this.performanceStats.totalProcessed += texts.length;
      this.performanceStats.totalTime += Date.now() - startTime;
      return results;
    } catch (error) {
      this.performanceStats.failureCount++;
      throw error;
    }
  }

  // Compatibility methods for existing tests/UI
  getPerformanceStats() {
    const s = this.getStats();
    return {
      ...this.performanceStats,
      averageTime: this.performanceStats.totalProcessed > 0 
        ? this.performanceStats.totalTime / this.performanceStats.totalProcessed 
        : 0,
      queueLength: s.queueLength,
      activeJobs: s.activeJobs,
      poolSize: s.workerCount,
      fallbackCount: this.performanceStats.fallbackCount,
      fallbackRate: this.performanceStats.totalProcessed > 0
        ? this.performanceStats.fallbackCount / this.performanceStats.totalProcessed
        : 0
    };
  }

  getStatus() {
    const s = this.getStats();
    return {
      isHealthy: s.healthyWorkers === s.workerCount && s.workerCount > 0,
      activeJobs: s.activeJobs,
      queueLength: s.queueLength,
      workerCount: s.workerCount
    };
  }

  // Delegate to base class terminate
  async cleanup() {
    this.terminate();
  }
}