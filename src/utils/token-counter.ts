/**
 * Estimates token count for a given text string.
 * This is a simple estimation based on character count.
 * @param text The text to count tokens for
 * @returns Estimated token count
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  // Simple estimation: ~4 characters per token on average
  return Math.ceil(text.length / 4);
} 