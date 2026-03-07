/**
 * Token Estimator
 *
 * Rough token count estimation for context window management.
 * Uses the ~4 chars per token heuristic (GPT/Claude average).
 * This avoids a hard dependency on tiktoken while being accurate
 * enough for context overflow prevention.
 *
 * OpenPilot equivalent: estimateMessagesTokens() in compaction.ts
 */

import { TranscriptMessage } from './types';

/** Average characters per token (conservative estimate) */
const CHARS_PER_TOKEN = 4;

/** Per-message overhead: role label, formatting, separators */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Tool call overhead per call (JSON structure, name, id) */
const TOOL_CALL_OVERHEAD_TOKENS = 20;

/**
 * Estimate token count for a single string.
 */
export function estimateStringTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count for a single transcript message.
 */
export function estimateMessageTokens(msg: TranscriptMessage): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS;
  tokens += estimateStringTokens(msg.content);

  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += TOOL_CALL_OVERHEAD_TOKENS;
      tokens += estimateStringTokens(tc.name);
      tokens += estimateStringTokens(JSON.stringify(tc.args));
    }
  }

  if (msg.toolResults) {
    for (const tr of msg.toolResults) {
      tokens += TOOL_CALL_OVERHEAD_TOKENS;
      const resultStr = tr.error ?? (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result ?? ''));
      tokens += estimateStringTokens(resultStr);
    }
  }

  return tokens;
}

/**
 * Estimate total token count for a transcript (system prompt + messages).
 */
export function estimateTranscriptTokens(
  systemPrompt: string,
  messages: TranscriptMessage[],
): number {
  let total = MESSAGE_OVERHEAD_TOKENS + estimateStringTokens(systemPrompt);
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

/**
 * Known context window sizes for common models.
 * Used as fallback when model config doesn't specify contextWindow.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-3.5-turbo': 16_385,
  'gpt-4': 8_192,
  'gpt-4-turbo': 128_000,
  'gpt-4o': 128_000,
  'claude-3-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
  'claude-3.5-sonnet': 200_000,
  'gemini-1.5-pro': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
};

/**
 * Get context window size for a model.
 * Returns the known size or a conservative default.
 */
export function getContextWindowTokens(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 128_000;
}

/**
 * Safety margin: trigger compaction when usage exceeds this fraction
 * of the context window.
 */
export const CONTEXT_USAGE_THRESHOLD = 0.85;
