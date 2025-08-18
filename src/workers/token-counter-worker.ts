// Web Worker script using correct tiktoken imports
import { Tiktoken } from 'tiktoken/lite';
import o200k_base from 'tiktoken/encoders/o200k_base.json';

let encoder: Tiktoken | null = null;

// Port control character detection from main process
function isControlOrBinaryChar(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  // Control characters: 0x00-0x1F (excluding tab, newline, carriage return) and 0x7F-0x9F
  return (codePoint >= 0x00 && codePoint <= 0x08) ||
      (codePoint >= 0x0B && codePoint <= 0x0C) ||
      (codePoint >= 0x0E && codePoint <= 0x1F) ||
      (codePoint >= 0x7F && codePoint <= 0x9F);
}

// Port sanitization function from main process
function sanitizeTextForTokenCount(text: string): string {
  // Remove special tiktoken end-of-text markers
  const sanitizedText = text.replace(/<\|endoftext\|>/g, "");
  
  // Remove control and binary characters except tab, newline, carriage return
  let result = "";
  let i = 0;
  while (i < sanitizedText.length) {
    const codePoint = sanitizedText.codePointAt(i);
    if (codePoint === undefined) {
      i++;
      continue;
    }
    
    // Check if it's a control character we want to keep or not a control char
    if (!isControlOrBinaryChar(codePoint) || 
        codePoint === 9 || codePoint === 10 || codePoint === 13) {
      // For surrogate pairs (codePoint > 0xFFFF), we need to copy both characters
      if (codePoint > 0xFFFF) {
        result += sanitizedText[i] + sanitizedText[i + 1];
        i += 2;
      } else {
        result += sanitizedText[i];
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
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
});