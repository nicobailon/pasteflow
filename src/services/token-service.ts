import { TOKEN_COUNTING } from '@constants';

export type TokenCountingBackend = 'worker-pool' | 'tiktoken' | 'estimate';

export interface TokenCountResult {
  count: number;
  backend: TokenCountingBackend;
}

export interface TokenServiceConfig {
  preferredBackend?: TokenCountingBackend;
  fallbackToEstimate?: boolean;
  maxTextSize?: number;
}

export interface TokenServiceBackend {
  name: TokenCountingBackend;
  isAvailable(): boolean | Promise<boolean>;
  countTokens(text: string): Promise<number>;
  countTokensBatch?(texts: string[]): Promise<number[]>;
  cleanup?(): void | Promise<void>;
}

export class TokenService {
  private backends: Map<TokenCountingBackend, TokenServiceBackend> = new Map();
  private config: Required<TokenServiceConfig>;
  private textEncoder: InstanceType<typeof TextEncoder> | null = null;
  
  constructor(config?: TokenServiceConfig) {
    this.config = {
      preferredBackend: config?.preferredBackend ?? 'worker-pool',
      fallbackToEstimate: config?.fallbackToEstimate ?? true,
      maxTextSize: config?.maxTextSize ?? (10 * 1024 * 1024), // 10MB default
    };
  }
  
  private getTextEncoder(): InstanceType<typeof TextEncoder> {
    if (!this.textEncoder) {
      this.textEncoder = new TextEncoder();
    }
    return this.textEncoder;
  }
  
  registerBackend(backend: TokenServiceBackend): void {
    this.backends.set(backend.name, backend);
  }
  
  async countTokens(text: string): Promise<TokenCountResult> {
    if (!text) {
      return { count: 0, backend: 'estimate' };
    }
    
    // Check byte size instead of character count for better memory estimation
    const byteSize = this.getTextEncoder().encode(text).length;
    if (byteSize > this.config.maxTextSize) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`Text exceeds max size (${byteSize} bytes > ${this.config.maxTextSize}), using estimation`);
      }
      return {
        count: Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN),
        backend: 'estimate'
      };
    }
    
    const preferredBackend = this.backends.get(this.config.preferredBackend);
    if (preferredBackend) {
      try {
        if (await preferredBackend.isAvailable()) {
          const count = await preferredBackend.countTokens(text);
          return { count, backend: preferredBackend.name };
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Preferred backend ${preferredBackend.name} failed:`, error);
        }
      }
    }
    
    for (const [name, backend] of this.backends) {
      if (name === this.config.preferredBackend) continue;
      if (name === 'estimate') continue;
      
      try {
        if (await backend.isAvailable()) {
          const count = await backend.countTokens(text);
          return { count, backend: backend.name };
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Backend ${backend.name} failed:`, error);
        }
      }
    }
    
    if (this.config.fallbackToEstimate) {
      const estimateBackend = this.backends.get('estimate');
      if (estimateBackend) {
        const count = await estimateBackend.countTokens(text);
        return { count, backend: 'estimate' };
      }
      
      return {
        count: Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN),
        backend: 'estimate'
      };
    }
    
    throw new Error('No token counting backend available');
  }
  
  async countTokensBatch(texts: string[]): Promise<number[]> {
    // Find a backend that supports batch counting
    const preferredBackend = this.backends.get(this.config.preferredBackend);
    
    // Try preferred backend first if it supports batch
    if (preferredBackend?.countTokensBatch) {
      try {
        if (await preferredBackend.isAvailable()) {
          return await preferredBackend.countTokensBatch(texts);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Preferred backend ${preferredBackend.name} batch failed:`, error);
        }
      }
    }
    
    // Try other backends with batch support
    for (const backend of this.backends.values()) {
      if (backend.countTokensBatch && backend !== preferredBackend) {
        try {
          if (await backend.isAvailable()) {
            return await backend.countTokensBatch(texts);
          }
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`Backend ${backend.name} batch failed:`, error);
          }
        }
      }
    }
    
    // Fallback to individual counting
    return Promise.all(texts.map(text => this.countTokens(text).then(r => r.count)));
  }
  
  async cleanup(): Promise<void> {
    const cleanupPromises: Promise<void>[] = [];
    
    for (const backend of this.backends.values()) {
      if (backend.cleanup) {
        cleanupPromises.push(
          Promise.resolve(backend.cleanup()).catch(error => {
            if (process.env.NODE_ENV !== 'production') {
              console.error(`Error cleaning up backend ${backend.name}:`, error);
            }
          })
        );
      }
    }
    
    await Promise.all(cleanupPromises);
  }
  
  getAvailableBackends(): TokenCountingBackend[] {
    return [...this.backends.keys()];
  }
  
  async getActiveBackend(): Promise<TokenCountingBackend | null> {
    const preferredBackend = this.backends.get(this.config.preferredBackend);
    if (preferredBackend) {
      try {
        if (await preferredBackend.isAvailable()) {
          return preferredBackend.name;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Error checking availability of ${preferredBackend.name}:`, error);
        }
      }
    }
    
    for (const [name, backend] of this.backends) {
      if (name === 'estimate') continue;
      try {
        if (await backend.isAvailable()) {
          return name;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Error checking availability of ${name}:`, error);
        }
      }
    }
    
    return this.config.fallbackToEstimate ? 'estimate' : null;
  }
}

export const createTokenService = (config?: TokenServiceConfig): TokenService => {
  return new TokenService(config);
};