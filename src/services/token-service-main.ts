import { TokenServiceBackend, TokenService } from './token-service';
import { TOKEN_COUNTING } from '@constants';

interface TiktokenEncoder {
  encode(text: string): Uint32Array;
}

let encoder: TiktokenEncoder | null = null;
let initPromise: Promise<TiktokenEncoder | null> | null = null;

class TiktokenBackend implements TokenServiceBackend {
  name = 'tiktoken' as const;
  
  private async initializeEncoder(): Promise<TiktokenEncoder | null> {
    if (encoder) return encoder;
    
    try {
      const tiktoken = await import('tiktoken');
      encoder = tiktoken.get_encoding('o200k_base');
      return encoder;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to initialize tiktoken encoder:', error);
      }
      encoder = null;
      return null;
    }
  }
  
  private ensureEncoderInitialized(): Promise<TiktokenEncoder | null> {
    if (!initPromise) {
      initPromise = this.initializeEncoder();
    }
    return initPromise;
  }
  
  private sanitizeTextForTokenCount(text: string): string {
    return text
      .replace(/<\|[^>|]+\|>/g, '')
      .replace(/\u0000/g, '')
      .replace(/[\uFFF0-\uFFFF]/g, '')
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '');
  }
  
  async isAvailable(): Promise<boolean> {
    const enc = await this.ensureEncoderInitialized();
    return enc !== null;
  }
  
  async countTokens(text: string): Promise<number> {
    const enc = await this.ensureEncoderInitialized();
    
    if (!enc) {
      throw new Error('Tiktoken encoder not available');
    }
    
    try {
      const sanitizedText = this.sanitizeTextForTokenCount(text);
      
      if (sanitizedText.length < text.length * TOKEN_COUNTING.MIN_TEXT_RETENTION_RATIO) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('Text contained many special tokens, using estimation instead');
        }
        throw new Error('Too many special tokens for accurate counting');
      }
      
      const tokens = enc.encode(sanitizedText);
      return tokens.length;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Error counting tokens with tiktoken:', error);
      }
      throw error;
    }
  }
  
  cleanup(): void {
    encoder = null;
    initPromise = null;
  }
}

class EstimateBackend implements TokenServiceBackend {
  name = 'estimate' as const;
  
  isAvailable(): boolean {
    return true;
  }
  
  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }
}

export function createMainTokenService(): TokenService {
  const service = new TokenService({
    preferredBackend: 'tiktoken',
    fallbackToEstimate: true,
  });
  
  service.registerBackend(new TiktokenBackend());
  service.registerBackend(new EstimateBackend());
  
  return service;
}

let singletonService: TokenService | null = null;

export function getMainTokenService(): TokenService {
  if (!singletonService) {
    singletonService = createMainTokenService();
  }
  return singletonService;
}

export async function cleanupMainTokenService(): Promise<void> {
  if (singletonService) {
    await singletonService.cleanup();
    singletonService = null;
  }
}