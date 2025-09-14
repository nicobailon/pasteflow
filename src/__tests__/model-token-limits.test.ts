import { getMaxOutputTokensForModel } from '../main/agent/models-catalog';
import { getEffectiveMaxOutputTokens } from '../main/agent/config';

describe('Model Token Limits', () => {
  describe('getMaxOutputTokensForModel', () => {
    it('should return correct limits for OpenAI models', () => {
      expect(getMaxOutputTokensForModel('openai', 'gpt-5')).toBe(128000);
      expect(getMaxOutputTokensForModel('openai', 'gpt-5-mini')).toBe(128000);
      expect(getMaxOutputTokensForModel('openai', 'gpt-5-nano')).toBe(128000);
      expect(getMaxOutputTokensForModel('openai', 'gpt-4o-mini')).toBe(16384);
      expect(getMaxOutputTokensForModel('openai', 'gpt-5-chat-latest')).toBe(128000);
    });

    it('should return correct limits for Anthropic models', () => {
      expect(getMaxOutputTokensForModel('anthropic', 'claude-sonnet-4-20250514')).toBe(128000);
      expect(getMaxOutputTokensForModel('anthropic', 'claude-opus-4-1-20250805')).toBe(128000);
      expect(getMaxOutputTokensForModel('anthropic', 'claude-3-5-haiku-20241022')).toBe(8192);
    });

    it('should return correct limits for OpenRouter models', () => {
      expect(getMaxOutputTokensForModel('openrouter', 'openai/gpt-5')).toBe(128000);
      expect(getMaxOutputTokensForModel('openrouter', 'openai/gpt-4o-mini')).toBe(16384);
      expect(getMaxOutputTokensForModel('openrouter', 'anthropic/claude-sonnet-4-20250514')).toBe(128000);
    });

    it('should return correct limits for Groq models', () => {
      expect(getMaxOutputTokensForModel('groq', 'moonshotai/kimi-k2-instruct-0905')).toBe(16384);
    });

    it('should use pattern matching for unknown models', () => {
      // Test OpenAI pattern matching
      expect(getMaxOutputTokensForModel('openai', 'gpt-5-new-model')).toBe(128000);
      expect(getMaxOutputTokensForModel('openai', 'gpt-4o-mini-new')).toBe(16384);
      
      // Test Anthropic pattern matching
      expect(getMaxOutputTokensForModel('anthropic', 'claude-sonnet-4-new')).toBe(128000);
      expect(getMaxOutputTokensForModel('anthropic', 'claude-haiku-new')).toBe(8192);
      
      // Test OpenRouter pattern matching
      expect(getMaxOutputTokensForModel('openrouter', 'openai/gpt-5-new')).toBe(128000);
      expect(getMaxOutputTokensForModel('openrouter', 'anthropic/claude-haiku-new')).toBe(8192);

      // Test Groq pattern matching
      expect(getMaxOutputTokensForModel('groq', 'moonshotai/kimi-k2-new')).toBe(16384);
      expect(getMaxOutputTokensForModel('groq', 'kimi-k2-test')).toBe(16384);
    });

    it('should return fallback for completely unknown models', () => {
      expect(getMaxOutputTokensForModel('openai', 'unknown-model', 5000)).toBe(5000);
      expect(getMaxOutputTokensForModel('anthropic', 'unknown-model', 3000)).toBe(3000);
      expect(getMaxOutputTokensForModel('openrouter', 'unknown-model', 2000)).toBe(2000);
      expect(getMaxOutputTokensForModel('groq', 'unknown-model', 1000)).toBe(1000);
    });
  });

  describe('getEffectiveMaxOutputTokens', () => {
    const mockConfig = {
      PROVIDER: 'openai' as const,
      DEFAULT_MODEL: 'gpt-4o-mini',
      MAX_CONTEXT_TOKENS: 120000,
      MAX_OUTPUT_TOKENS: 128000,
      MAX_TOOLS_PER_TURN: 8,
      MAX_RESULTS_PER_TOOL: 200,
      MAX_SEARCH_MATCHES: 500,
      TEMPERATURE: 0.3,
      ENABLE_FILE_WRITE: true,
      ENABLE_CODE_EXECUTION: true,
      APPROVAL_MODE: 'never' as const,
      RETRY_ATTEMPTS: 3,
      RETRY_BASE_MS: 1000,
      RETRY_MAX_MS: 10000,
    };

    it('should return model-specific limits when available', () => {
      expect(getEffectiveMaxOutputTokens(mockConfig, 'openai', 'gpt-5')).toBe(128000);
      expect(getEffectiveMaxOutputTokens(mockConfig, 'openai', 'gpt-4o-mini')).toBe(16384);
      expect(getEffectiveMaxOutputTokens(mockConfig, 'anthropic', 'claude-3-5-haiku-20241022')).toBe(8192);
      expect(getEffectiveMaxOutputTokens(mockConfig, 'groq', 'moonshotai/kimi-k2-instruct-0905')).toBe(16384);
    });

    it('should fall back to config value for unknown models', () => {
      expect(getEffectiveMaxOutputTokens(mockConfig, 'openai', 'unknown-model')).toBe(128000);
    });

    it('should respect custom fallback values', () => {
      const customConfig = { ...mockConfig, MAX_OUTPUT_TOKENS: 50000 };
      expect(getEffectiveMaxOutputTokens(customConfig, 'openai', 'unknown-model')).toBe(50000);
    });
  });

  describe('Model-specific behavior validation', () => {
    it('should ensure GPT-5 family models have 128K limits', () => {
      const gpt5Models = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest'];
      gpt5Models.forEach(model => {
        expect(getMaxOutputTokensForModel('openai', model)).toBe(128000);
      });
    });

    it('should ensure Claude Sonnet 4 and Opus 4 have 128K limits', () => {
      const claude4Models = ['claude-sonnet-4-20250514', 'claude-opus-4-1-20250805'];
      claude4Models.forEach(model => {
        expect(getMaxOutputTokensForModel('anthropic', model)).toBe(128000);
      });
    });

    it('should ensure Claude Haiku models have 8K limits', () => {
      expect(getMaxOutputTokensForModel('anthropic', 'claude-3-5-haiku-20241022')).toBe(8192);
    });

    it('should ensure GPT-4o-mini has 16K limits', () => {
      expect(getMaxOutputTokensForModel('openai', 'gpt-4o-mini')).toBe(16384);
    });

    it('should ensure Kimi K2 0905 has 16K limits', () => {
      expect(getMaxOutputTokensForModel('groq', 'moonshotai/kimi-k2-instruct-0905')).toBe(16384);
    });
  });
});
