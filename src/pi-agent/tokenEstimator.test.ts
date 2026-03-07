/**
 * Tests for token estimation utilities
 */

import {
  estimateStringTokens,
  estimateMessageTokens,
  estimateTranscriptTokens,
  getContextWindowTokens,
  MODEL_CONTEXT_WINDOWS,
  CONTEXT_USAGE_THRESHOLD,
} from './tokenEstimator';
import { TranscriptMessage } from './types';

describe('tokenEstimator', () => {
  describe('estimateStringTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateStringTokens('')).toBe(0);
    });

    it('returns 0 for null/undefined', () => {
      expect(estimateStringTokens(null as any)).toBe(0);
      expect(estimateStringTokens(undefined as any)).toBe(0);
    });

    it('estimates ~1 token per 4 chars', () => {
      expect(estimateStringTokens('abcd')).toBe(1);
      expect(estimateStringTokens('abcdefgh')).toBe(2);
      // 5 chars → ceil(5/4) = 2
      expect(estimateStringTokens('hello')).toBe(2);
    });

    it('handles long strings', () => {
      const longStr = 'a'.repeat(1000);
      expect(estimateStringTokens(longStr)).toBe(250);
    });
  });

  describe('estimateMessageTokens', () => {
    it('includes message overhead', () => {
      const msg: TranscriptMessage = { role: 'user', content: '' };
      // 4 overhead + 0 content = 4
      expect(estimateMessageTokens(msg)).toBe(4);
    });

    it('estimates content tokens', () => {
      const msg: TranscriptMessage = { role: 'user', content: 'Hello world!' };
      // 4 overhead + ceil(12/4) = 4 + 3 = 7
      expect(estimateMessageTokens(msg)).toBe(7);
    });

    it('includes tool call overhead', () => {
      const msg: TranscriptMessage = {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'readFile', args: { path: '/tmp/test.txt' } }],
      };
      const tokens = estimateMessageTokens(msg);
      // Should be > just overhead (4) due to tool call
      expect(tokens).toBeGreaterThan(4);
    });

    it('includes tool result overhead', () => {
      const msg: TranscriptMessage = {
        role: 'user',
        content: '',
        toolResults: [{ id: 'tc1', result: 'file contents here' }],
      };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(4);
    });
  });

  describe('estimateTranscriptTokens', () => {
    it('includes system prompt', () => {
      const tokens = estimateTranscriptTokens('You are a helpful assistant.', []);
      expect(tokens).toBeGreaterThan(0);
    });

    it('sums all messages', () => {
      const messages: TranscriptMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const tokens = estimateTranscriptTokens('System prompt', messages);
      const systemOnly = estimateTranscriptTokens('System prompt', []);
      expect(tokens).toBeGreaterThan(systemOnly);
    });
  });

  describe('getContextWindowTokens', () => {
    it('returns known window for gpt-3.5-turbo', () => {
      expect(getContextWindowTokens('gpt-3.5-turbo')).toBe(16_385);
    });

    it('returns known window for claude-3-sonnet', () => {
      expect(getContextWindowTokens('claude-3-sonnet')).toBe(200_000);
    });

    it('returns known window for gemini-1.5-pro', () => {
      expect(getContextWindowTokens('gemini-1.5-pro')).toBe(1_000_000);
    });

    it('returns default for unknown model', () => {
      expect(getContextWindowTokens('unknown-model')).toBe(128_000);
    });
  });

  describe('CONTEXT_USAGE_THRESHOLD', () => {
    it('is 0.85', () => {
      expect(CONTEXT_USAGE_THRESHOLD).toBe(0.85);
    });
  });
});
