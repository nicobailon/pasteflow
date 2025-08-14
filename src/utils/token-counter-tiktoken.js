"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countTokens = void 0;
let encoder = null;
// Initialize tiktoken encoder
try {
    const tiktoken = require('tiktoken');
    encoder = tiktoken.get_encoding('o200k_base'); // gpt-4o encoding
}
catch (error) {
    console.error('Failed to initialize tiktoken encoder:', error);
    encoder = null;
}
/**
 * Sanitize text to remove special characters that can cause tiktoken issues
 */
function sanitizeTextForTokenCount(text) {
    // Remove null characters and other problematic special characters
    return text
        .replace(/\u0000/g, '') // Remove null characters
        .replace(/[\uFFF0-\uFFFF]/g, '') // Remove special use area
        .replace(/[\u{10000}-\u{10FFFF}]/gu, ''); // Remove supplementary private use area
}
/**
 * Count tokens using tiktoken with o200k_base encoding
 * Falls back to character-based estimation if tiktoken fails
 */
function countTokens(text) {
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
    }
    catch (error) {
        console.error('Error counting tokens:', error);
        // Fallback to character-based estimation on error
        return Math.ceil(text.length / 4);
    }
}
exports.countTokens = countTokens;
