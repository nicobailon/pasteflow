// Web Worker script using correct tiktoken imports
import { Tiktoken } from 'tiktoken/lite';
import o200k_base from 'tiktoken/encoders/o200k_base.json';

let encoder: Tiktoken | null = null;

// Constants for token counting
const CHARS_PER_TOKEN = 4;
const MIN_TEXT_RETENTION_RATIO = 0.9;

// Port sanitization function from main process
function sanitizeTextForTokenCount(text: string): string {
  // Remove problematic characters that cause tiktoken to fail
  return text
    .replace(/<\|[^>|]+\|>/g, '') // Remove special tokens with <|...|> pattern
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '') // Remove null characters
    .replace(/[\uFFF0-\uFFFF]/g, '') // Remove special use area
    .replace(/[\u{10000}-\u{10FFFF}]/gu, ''); // Remove supplementary private use area
}

// Initialize encoder with proper error handling
async function initializeEncoder(): Promise<boolean> {
  try {
    encoder = new Tiktoken(
      o200k_base.bpe_ranks,
      o200k_base.special_tokens,
      o200k_base.pat_str
    );
    return true;
  } catch {
    encoder = null;
    return false;
  }
}

// Security: Input validation
const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB limit

// Send READY signal immediately when worker script loads
self.postMessage({ type: 'WORKER_READY' });

self.addEventListener('message', async (event) => {
  const { type, payload, id } = event.data;
  
  try {
    switch (type) {
      case 'INIT': {
        const success = await initializeEncoder();
        self.postMessage({ type: 'INIT_COMPLETE', id, success });
        break;
      }
        
      case 'HEALTH_CHECK': {
        self.postMessage({ 
          type: 'HEALTH_RESPONSE', 
          id, 
          healthy: encoder !== null 
        });
        break;
      }
        
      case 'COUNT_TOKENS': {
        // Validate input size
        if (payload.text.length > MAX_TEXT_SIZE) {
          self.postMessage({ 
            type: 'ERROR', 
            id, 
            error: 'Text too large for processing' 
          });
          return;
        }
        
        const sanitizedText = sanitizeTextForTokenCount(payload.text);
        
        // If the sanitization removed a significant portion of the text, fall back to estimation
        if (sanitizedText.length < payload.text.length * MIN_TEXT_RETENTION_RATIO) {
          console.warn('Text contained many special tokens, using estimation instead');
          const estimatedCount = Math.ceil(payload.text.length / CHARS_PER_TOKEN);
          self.postMessage({ 
            type: 'TOKEN_COUNT', 
            id, 
            result: estimatedCount,
            fallback: true 
          });
          break;
        }
        
        const count = encoder ? encoder.encode(sanitizedText).length : -1;
        
        self.postMessage({ 
          type: 'TOKEN_COUNT', 
          id, 
          result: count,
          fallback: count === -1 
        });
        break;
      }
        
      case 'BATCH_COUNT': {
        const results = await Promise.all(
          payload.texts.map((text: string) => {
            const sanitized = sanitizeTextForTokenCount(text);
            
            // If the sanitization removed a significant portion, use estimation
            if (sanitized.length < text.length * MIN_TEXT_RETENTION_RATIO) {
              console.warn('Text contained many special tokens, using estimation instead');
              return Math.ceil(text.length / CHARS_PER_TOKEN);
            }
            
            return encoder ? encoder.encode(sanitized).length : -1;
          })
        );
        self.postMessage({ type: 'BATCH_RESULT', id, results });
        break;
      }
    }
  } catch (error) {
    self.postMessage({ 
      type: 'ERROR', 
      id, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});