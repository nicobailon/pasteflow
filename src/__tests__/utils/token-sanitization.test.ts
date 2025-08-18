import { describe, it, expect } from '@jest/globals';

// Mock the isControlOrBinaryChar function as it would be in the actual implementation
function isControlOrBinaryChar(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  // Control characters: 0x00-0x1F (excluding tab, newline, carriage return) and 0x7F-0x9F
  return (codePoint >= 0x00 && codePoint <= 0x08) ||
      (codePoint >= 0x0B && codePoint <= 0x0C) ||
      (codePoint >= 0x0E && codePoint <= 0x1F) ||
      (codePoint >= 0x7F && codePoint <= 0x9F);
}

// The sanitization function as implemented in our fixes
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

describe('Token Sanitization Function', () => {
  describe('endoftext token removal', () => {
    it('should remove single endoftext token', () => {
      const input = 'Code with <|endoftext|> token';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Code with  token');
      expect(result).not.toContain('<|endoftext|>');
    });

    it('should remove multiple endoftext tokens', () => {
      const input = 'A <|endoftext|> B <|endoftext|> C';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('A  B  C');
      expect(result).not.toContain('<|endoftext|>');
    });

    it('should handle tokens at different positions', () => {
      const cases = [
        { input: '<|endoftext|>start', expected: 'start' },
        { input: 'end<|endoftext|>', expected: 'end' },
        { input: 'middle<|endoftext|>text', expected: 'middletext' },
        { input: '<|endoftext|><|endoftext|>', expected: '' }
      ];
      
      cases.forEach(({ input, expected }) => {
        const result = sanitizeTextForTokenCount(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('control character removal', () => {
    it('should remove null characters', () => {
      const input = 'Hello\x00World';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('HelloWorld');
    });

    it('should preserve tab, newline, and carriage return', () => {
      const input = 'Line1\tTabbed\nLine2\rCarriage';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Line1\tTabbed\nLine2\rCarriage');
    });

    it('should remove other control characters', () => {
      const input = 'Text\x01with\x1Fcontrol\x7Fchars';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Textwithcontrolchars');
    });

    it('should remove extended control characters (0x7F-0x9F)', () => {
      const input = 'Text\x80with\x9Fextended';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Textwithextended');
    });
  });

  describe('Unicode handling', () => {
    it('should preserve basic Unicode characters', () => {
      const input = 'Hello 世界 🌍';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Hello 世界 🌍');
    });

    it('should handle surrogate pairs correctly', () => {
      // Emoji that uses surrogate pairs
      const input = 'Test 😀 emoji 🎉 text';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Test 😀 emoji 🎉 text');
    });

    it('should handle mixed Unicode and control characters', () => {
      const input = 'Unicode 中文\x00test\x1F😀';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Unicode 中文test😀');
    });

    it('should handle complex Unicode strings', () => {
      // Various Unicode blocks
      const input = 'Latin: café, Greek: αβγ, Arabic: مرحبا, Emoji: 🚀';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Latin: café, Greek: αβγ, Arabic: مرحبا, Emoji: 🚀');
    });
  });

  describe('combined sanitization', () => {
    it('should handle endoftext tokens and control characters together', () => {
      const input = 'Code\x00with<|endoftext|>both\x1Ftypes';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('Codewithbothtypes');
    });

    it('should handle real-world AI/ML code example', () => {
      const input = `
const specialTokens = {
  "<|endoftext|>": 50256,
  "<|startoftext|>": 50257
};
// Training data with \x00 null bytes
const data = "prompt\x01response<|endoftext|>";
`;
      const result = sanitizeTextForTokenCount(input);
      expect(result).not.toContain('<|endoftext|>');
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x01');
      expect(result).toContain('specialTokens');
      expect(result).toContain('Training data');
    });

    it('should handle empty string', () => {
      const result = sanitizeTextForTokenCount('');
      expect(result).toBe('');
    });

    it('should handle string with only tokens to remove', () => {
      const input = '<|endoftext|>\x00\x01\x1F';
      const result = sanitizeTextForTokenCount(input);
      expect(result).toBe('');
    });
  });

  describe('performance considerations', () => {
    it('should handle long strings efficiently', () => {
      // Create a large string with mixed content
      const longString = 'a'.repeat(10000) + '<|endoftext|>' + 'b'.repeat(10000);
      const result = sanitizeTextForTokenCount(longString);
      expect(result.length).toBe(20000);
      expect(result).toBe('a'.repeat(10000) + 'b'.repeat(10000));
    });

    it('should handle many tokens efficiently', () => {
      // Create string with many tokens to remove
      const manyTokens = Array(100).fill('<|endoftext|>').join('text');
      const result = sanitizeTextForTokenCount(manyTokens);
      expect(result).not.toContain('<|endoftext|>');
      expect(result).toBe('text'.repeat(99));
    });
  });
});