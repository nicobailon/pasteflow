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
 * Sanitize text to remove special characters that can cause tiktoken issues
 */
function sanitizeTextForTokenCount(text: string): string {
  // Remove null characters and other problematic special characters
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '') // Remove null characters
    .replace(/[\uFFF0-\uFFFF]/g, '') // Remove special use area
    .replace(/[\u{10000}-\u{10FFFF}]/gu, ''); // Remove supplementary private use area
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
    return Math.ceil(text.length / 4);
  }
  
  // Simple fallback implementation if encoder fails
  if (!encoder) {
    // Very rough estimate: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  }

  try {
    // Add sanitization to remove problematic tokens that cause tiktoken to fail
    const sanitizedText = sanitizeTextForTokenCount(text);
    
    // If the sanitization removed a significant portion of the text, fall back to estimation
    if (sanitizedText.length < text.length * 0.9) {
      console.warn('Text contained many special tokens, using estimation instead');
      return Math.ceil(text.length / 4);
    }
    
    const tokens = encoder.encode(sanitizedText);
    return tokens.length;
  } catch (error) {
    console.error('Error counting tokens:', error);
    // Fallback to character-based estimation on error
    return Math.ceil(text.length / 4);
  }
}