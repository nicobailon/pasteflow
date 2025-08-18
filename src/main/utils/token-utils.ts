import { TOKEN_COUNTING } from '../../constants/app-constants';

interface TiktokenEncoder {
  encode(text: string): Uint32Array;
}

let encoder: TiktokenEncoder | null = null;

// Initialize tiktoken encoder dynamically
async function initializeEncoder() {
  if (encoder) return encoder;
  
  try {
    const tiktoken = await import('tiktoken');
    encoder = tiktoken.get_encoding('o200k_base'); // gpt-4o encoding
    return encoder;
  } catch (error) {
    console.error('Failed to initialize tiktoken encoder:', error);
    encoder = null;
    return null;
  }
}

// Initialize encoder on first use
let initPromise: Promise<TiktokenEncoder | null> | null = null;

function ensureEncoderInitialized(): Promise<TiktokenEncoder | null> {
  if (!initPromise) {
    initPromise = initializeEncoder();
  }
  return initPromise;
}

/**
 * Check if a character is a control or binary character
 */
function isControlOrBinaryChar(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  // Control characters: 0x00-0x1F (excluding tab, newline, carriage return) and 0x7F-0x9F
  return (codePoint >= 0x00 && codePoint <= 0x08) ||
      (codePoint >= 0x0B && codePoint <= 0x0C) ||
      (codePoint >= 0x0E && codePoint <= 0x1F) ||
      (codePoint >= 0x7F && codePoint <= 0x9F);
}

/**
 * Sanitize text to remove special characters that can cause tiktoken issues
 */
function sanitizeTextForTokenCount(text: string): string {
  // Remove special tiktoken end-of-text markers
  let sanitizedText = text.replace(/<\|endoftext\|>/g, '');
  
  // Remove control and binary characters except tab, newline, carriage return
  let result = '';
  let i = 0;
  while (i < sanitizedText.length) {
    const codePoint = sanitizedText.codePointAt(i);
    if (codePoint === undefined) {
      i++;
      continue;
    }
    
    // Check if it's a control character we want to remove
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

/**
 * Count tokens using tiktoken with o200k_base encoding
 * Falls back to character-based estimation if tiktoken fails
 */
export function countTokens(text: string): number {
  // Try to initialize encoder synchronously if not done yet
  if (!encoder && !initPromise) {
    // Start initialization but don't wait for it
    ensureEncoderInitialized();
    // Use fallback for this call
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }
  
  // Simple fallback implementation if encoder fails
  if (!encoder) {
    // Very rough estimate using centralized constant
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }

  try {
    // Add sanitization to remove problematic tokens that cause tiktoken to fail
    const sanitizedText = sanitizeTextForTokenCount(text);
    
    // If the sanitization removed a significant portion of the text, fall back to estimation
    if (sanitizedText.length < text.length * TOKEN_COUNTING.MIN_TEXT_RETENTION_RATIO) {
      console.warn('Text contained many special tokens, using estimation instead');
      return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
    }
    
    const tokens = encoder.encode(sanitizedText);
    return tokens.length;
  } catch (error) {
    console.error('Error counting tokens:', error);
    // Fallback to character-based estimation on error
    return Math.ceil(text.length / 4);
  }
}