import { TOKEN_COUNTING } from '../constants/app-constants';

/**
 * Estimates token count for a given text string.
 * This is a simple estimation based on character count.
 * @param text The text to count tokens for
 * @returns Estimated token count
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  // Simple estimation using centralized constant
  return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
} 