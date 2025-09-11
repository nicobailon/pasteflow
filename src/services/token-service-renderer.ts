import { TokenWorkerPool } from '../workers/pools/token-worker-pool';
import { estimateTokenCount } from '../utils/token-utils';

import { TokenServiceBackend, TokenService } from './token-service';

let globalWorkerPool: TokenWorkerPool | null = null;
let poolRefCount = 0;

class WorkerPoolBackend implements TokenServiceBackend {
  name = 'worker-pool' as const;
  private hasIncrementedRef = false;
  
  private getOrCreatePool(): TokenWorkerPool {
    // JavaScript is single-threaded, so synchronous creation is safe
    if (!globalWorkerPool) {
      globalWorkerPool = new TokenWorkerPool();
    }
    
    // Only increment ref count once per backend instance
    if (!this.hasIncrementedRef) {
      poolRefCount++;
      this.hasIncrementedRef = true;
    }
    
    return globalWorkerPool;
  }
  
  isAvailable(): boolean {
    return typeof Worker !== 'undefined' && typeof window !== 'undefined' && 'Worker' in window;
  }
  
  async countTokens(text: string): Promise<number> {
    try {
      const pool = this.getOrCreatePool();
      return await pool.countTokens(text);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Worker pool token counting failed:', error);
      }
      throw error;
    }
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
    try {
      const pool = this.getOrCreatePool();
      // Check if pool has batch support
      if ('countTokensBatch' in pool && typeof pool.countTokensBatch === 'function') {
        return await pool.countTokensBatch(texts);
      }
      // Fallback to individual counting
      return Promise.all(texts.map(text => pool.countTokens(text)));
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Worker pool batch counting failed:', error);
      }
      throw error;
    }
  }
  
  cleanup(): void {
    if (this.hasIncrementedRef) {
      poolRefCount--;
      this.hasIncrementedRef = false;
      
      if (poolRefCount <= 0 && globalWorkerPool) {
        globalWorkerPool.terminate();
        globalWorkerPool = null;
        poolRefCount = 0;
      }
    }
  }
}

class EstimateBackend implements TokenServiceBackend {
  name = 'estimate' as const;
  
  isAvailable(): boolean {
    return true;
  }
  
  async countTokens(text: string): Promise<number> {
    return estimateTokenCount(text);
  }
}

export function createRendererTokenService(): TokenService {
  const service = new TokenService({
    preferredBackend: 'worker-pool',
    fallbackToEstimate: true,
  });
  
  service.registerBackend(new WorkerPoolBackend());
  service.registerBackend(new EstimateBackend());
  
  return service;
}

let singletonService: TokenService | null = null;

export function getRendererTokenService(): TokenService {
  if (!singletonService) {
    singletonService = createRendererTokenService();
  }
  return singletonService;
}

export async function cleanupRendererTokenService(): Promise<void> {
  if (singletonService) {
    await singletonService.cleanup();
    singletonService = null;
  }
}
