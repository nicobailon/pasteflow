// Web Worker script using correct tiktoken imports
import { Tiktoken } from 'tiktoken/lite';
import o200k_base from 'tiktoken/encoders/o200k_base.json';

let encoder: Tiktoken | null = null;

// Port control character detection from main process
function isControlOrBinaryChar(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  // Control characters: 0x00-0x1F (excluding tab, newline, carriage return) and 0x7F-0x9F
  if ((codePoint >= 0x00 && codePoint <= 0x08) ||
      (codePoint >= 0x0B && codePoint <= 0x0C) ||
      (codePoint >= 0x0E && codePoint <= 0x1F) ||
      (codePoint >= 0x7F && codePoint <= 0x9F)) {
    return true;
  }
  // Additional ranges for other non-printable or binary-indicative characters
  if (codePoint > 0xFF_FF) return false;
  return false;
}

// Port sanitization function from main process
function sanitizeTextForTokenCount(text: string): string {
  // Remove special tiktoken end-of-text markers
  const sanitizedText = text.replace(/<\|endoftext\|>/g, "");
  
  // Remove control and binary characters except tab, newline, carriage return
  let result = "";
  for (let i = 0; i < sanitizedText.length; i++) {
    const codePoint = sanitizedText.codePointAt(i);
    if (!isControlOrBinaryChar(codePoint) || 
        codePoint === 9 || codePoint === 10 || codePoint === 13) {
      result += sanitizedText[i];
    }
  }
  return result;
}

// Initialize encoder with proper error handling
async function initializeEncoder(): Promise<boolean> {
  try {
    console.log('[Worker] Starting tiktoken initialization...');
    console.log('[Worker] o200k_base available:', !!o200k_base);
    console.log('[Worker] bpe_ranks available:', !!o200k_base?.bpe_ranks);
    
    encoder = new Tiktoken(
      o200k_base.bpe_ranks,
      o200k_base.special_tokens,
      o200k_base.pat_str
    );
    console.log('[Worker] Tiktoken encoder initialized successfully');
    return true;
  } catch (error) {
    console.error('[Worker] Failed to initialize tiktoken encoder:', error);
    encoder = null;
    return false;
  }
}

// Security: Input validation
const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB limit

// Send READY signal immediately when worker script loads
console.log('[Worker] Worker script loaded, sending READY signal');
self.postMessage({ type: 'WORKER_READY' });

self.onmessage = async (event) => {
  const { type, payload, id } = event.data;
  
  console.log('[Worker] Received message:', { type, id });
  
  try {
    switch (type) {
      case 'INIT': {
        console.log('[Worker] Processing INIT message...');
        const success = await initializeEncoder();
        console.log('[Worker] Sending INIT_COMPLETE with success:', success);
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
};