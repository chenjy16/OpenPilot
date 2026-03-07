/**
 * Security middleware: rate limiting and input validation/sanitization
 * Requirements: 11.4, 11.5, 11.6, 11.7, 8.5, 9.1, 9.2
 */

import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max requests per session per minute (Req 11.4) */
const MAX_REQUESTS_PER_MINUTE = 20;

/** Max tokens per session per day (Req 11.5) */
const MAX_TOKENS_PER_DAY = 100_000;

/** Max tool calls per conversation (Req 11.6) */
export const MAX_TOOL_CALLS_PER_CONVERSATION = 10;

/** Max message content length in characters (Req 11.7) */
const MAX_MESSAGE_LENGTH = 10_000;

/** Allowed model names — dynamically set from ModelManager at startup */
let ALLOWED_MODELS: string[] = ['gpt-3.5-turbo', 'gpt-4', 'claude-3-sonnet', 'claude-3-opus', 'gemini-1.5-pro', 'gemini-1.5-flash'];

/**
 * Update the allowed models list. Called from server startup after ModelManager is initialized.
 */
export function setAllowedModels(models: string[]): void {
  ALLOWED_MODELS = models;
}

/** Session ID format: alphanumeric, hyphens, underscores, max 100 chars */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

// ---------------------------------------------------------------------------
// In-memory rate limit stores
// ---------------------------------------------------------------------------

interface RequestWindow {
  count: number;
  windowStart: number; // epoch ms
}

interface DailyTokenWindow {
  tokens: number;
  dayStart: number; // epoch ms (start of UTC day)
}

// Per-session request counts (rolling 1-minute window)
const requestWindows = new Map<string, RequestWindow>();

// Per-session daily token usage
const dailyTokenWindows = new Map<string, DailyTokenWindow>();

/** Max entries in rate limit maps before eviction sweep */
const MAX_RATE_LIMIT_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Evict stale entries from a rate limit map when it exceeds the max size.
 * Removes entries whose window has expired.
 */
function evictStaleEntries<V extends { windowStart?: number; dayStart?: number }>(
  map: Map<string, V>,
  now: number,
  windowMs: number,
): void {
  if (map.size <= MAX_RATE_LIMIT_ENTRIES) return;
  for (const [key, val] of map) {
    const start = (val as any).windowStart ?? (val as any).dayStart ?? 0;
    if (now - start > windowMs) {
      map.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Rate limiter: requests per minute
// ---------------------------------------------------------------------------

/**
 * Middleware that enforces 20 requests/minute per session.
 * Reads sessionId from req.body.
 */
export function requestRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const sessionId: unknown = req.body?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    // Let downstream validation handle missing sessionId
    next();
    return;
  }

  const now = Date.now();
  const windowMs = 60_000; // 1 minute

  // Evict stale entries periodically
  evictStaleEntries(requestWindows, now, windowMs);

  let window = requestWindows.get(sessionId);
  if (!window || now - window.windowStart >= windowMs) {
    window = { count: 0, windowStart: now };
  }

  window.count += 1;
  requestWindows.set(sessionId, window);

  if (window.count > MAX_REQUESTS_PER_MINUTE) {
    res.status(429).json({
      error: `Rate limit exceeded: maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute per session`,
    });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Rate limiter: tokens per day
// ---------------------------------------------------------------------------

/**
 * Check and record token usage for a session.
 * Returns true if the usage is within limits, false if exceeded.
 */
export function checkAndRecordTokenUsage(sessionId: string, tokensUsed: number): boolean {
  const now = Date.now();
  const dayStart = startOfUtcDay(now);

  // Evict stale daily entries
  evictStaleEntries(dailyTokenWindows, now, 86_400_000);

  let window = dailyTokenWindows.get(sessionId);
  if (!window || window.dayStart < dayStart) {
    window = { tokens: 0, dayStart };
  }

  window.tokens += tokensUsed;
  dailyTokenWindows.set(sessionId, window);

  return window.tokens <= MAX_TOKENS_PER_DAY;
}

/**
 * Get current daily token usage for a session (for pre-flight checks).
 */
export function getDailyTokenUsage(sessionId: string): number {
  const now = Date.now();
  const dayStart = startOfUtcDay(now);
  const window = dailyTokenWindows.get(sessionId);
  if (!window || window.dayStart < dayStart) return 0;
  return window.tokens;
}

// ---------------------------------------------------------------------------
// Rate limiter: tool calls per conversation
// ---------------------------------------------------------------------------

// Per-conversation tool call counts (keyed by sessionId for simplicity)
const toolCallCounts = new Map<string, number>();

/**
 * Increment tool call count for a session and check against limit.
 * Returns true if within limit, false if exceeded.
 */
export function checkAndIncrementToolCalls(sessionId: string, callCount: number): boolean {
  const current = toolCallCounts.get(sessionId) ?? 0;
  const updated = current + callCount;
  toolCallCounts.set(sessionId, updated);
  return updated <= MAX_TOOL_CALLS_PER_CONVERSATION;
}

/**
 * Reset tool call count for a session (e.g. when a new conversation starts).
 */
export function resetToolCallCount(sessionId: string): void {
  toolCallCounts.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Input validation and sanitization
// ---------------------------------------------------------------------------

/** Patterns that indicate malicious content */
const MALICIOUS_PATTERNS: RegExp[] = [
  /<script[\s\S]*?>/i,                        // script tags
  /javascript\s*:/i,                           // javascript: URIs
  /on\w+\s*=\s*["'][^"']*["']/i,              // inline event handlers
  /union\s+select/i,                           // SQL UNION SELECT
  /'\s*or\s+'?\d+'?\s*=\s*'?\d+/i,            // SQL OR injection
  /;\s*drop\s+table/i,                         // SQL DROP TABLE
  /;\s*delete\s+from/i,                        // SQL DELETE FROM
  /--\s*$/m,                                   // SQL comment terminator
];

/**
 * Returns true if the content contains obvious malicious patterns.
 */
export function containsMaliciousContent(content: string): boolean {
  return MALICIOUS_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Middleware that validates and sanitizes the POST /api/chat request body.
 * Checks: message length, malicious content, sessionId format, model name.
 */
export function inputValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { sessionId, message, model } = req.body ?? {};

  // Validate sessionId format
  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      res.status(400).json({
        error:
          'Invalid sessionId format: must be alphanumeric with hyphens/underscores, max 100 characters',
      });
      return;
    }
  }

  // Validate message content length
  if (typeof message === 'string') {
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({
        error: `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
      });
      return;
    }

    // Filter malicious content
    if (containsMaliciousContent(message)) {
      res.status(400).json({ error: 'Message contains invalid or potentially malicious content' });
      return;
    }
  }

  // Validate model name against allowed list
  if (typeof model === 'string' && model.trim() !== '') {
    // Accept both "provider/model" refs and legacy short names
    const isAllowed = ALLOWED_MODELS.includes(model)
      || ALLOWED_MODELS.some(m => m.endsWith('/' + model));
    if (!isAllowed) {
      res.status(400).json({
        error: `Invalid model: must be one of ${ALLOWED_MODELS.slice(0, 10).join(', ')}${ALLOWED_MODELS.length > 10 ? '...' : ''}`,
      });
      return;
    }
  }

  next();
}

// ---------------------------------------------------------------------------
// Exports for testing / reset
// ---------------------------------------------------------------------------

/** Clear all rate limit state (useful in tests). */
export function clearRateLimitState(): void {
  requestWindows.clear();
  dailyTokenWindows.clear();
  toolCallCounts.clear();
}
