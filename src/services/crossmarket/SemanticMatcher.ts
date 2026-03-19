/**
 * SemanticMatcher — Uses AIRuntime to perform cross-platform market semantic matching
 * with Resolution Oracle verification, Zod validation, and dynamic caching.
 */

import type Database from 'better-sqlite3';
import type { AIRuntime } from '../../runtime/AIRuntime';
import { z } from 'zod';
import type {
  NormalizedMarket,
  MatchResult,
  MarketPair,
  Platform,
} from './types';

// ─── Zod Schema for LLM Response Validation ────────────────────────────────

const MatchResponseSchema = z.object({
  confidence: z.number().min(0).max(1),
  oracleMismatch: z.boolean(),
  oracleMismatchReason: z.string().optional(),
  reasoning: z.string(),
});

// ─── Exported Pure Functions (for property testing) ─────────────────────────

/**
 * Classify confidence grade based on score and oracle mismatch flag.
 *
 * - score >= 0.9 AND no oracle_mismatch → 'high'
 * - 0.7 <= score < 0.9 AND no oracle_mismatch → 'medium'
 * - else → 'low'
 * - oracle_mismatch === true forces 'low' regardless of score
 */
export function classifyConfidence(
  score: number,
  oracleMismatch: boolean,
): 'high' | 'medium' | 'low' {
  if (oracleMismatch) return 'low';
  if (score >= 0.9) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}

/**
 * Calculate cache expiry timestamp based on market end date.
 *
 * - endDate >= 48h away → 24h cache TTL
 * - endDate < 48h away → 1h cache TTL
 * - Market closed/settled (endDate in the past) → immediately expired (expiresAt <= now)
 */
export function calculateCacheExpiry(
  nowMs: number,
  endDate: string | null,
): number {
  const nowSec = Math.floor(nowMs / 1000);

  if (!endDate) {
    // No end date — use default 24h TTL
    return nowSec + 24 * 60 * 60;
  }

  const endMs = new Date(endDate).getTime();
  if (isNaN(endMs)) {
    // Invalid date — use default 24h TTL
    return nowSec + 24 * 60 * 60;
  }

  const hoursUntilEnd = (endMs - nowMs) / (1000 * 60 * 60);

  if (hoursUntilEnd <= 0) {
    // Market closed/settled — immediately expired
    return nowSec;
  }

  if (hoursUntilEnd < 48) {
    // Less than 48h to settlement — 1h TTL
    return nowSec + 1 * 60 * 60;
  }

  // 48h+ away — 24h TTL
  return nowSec + 24 * 60 * 60;
}

// ─── LLM Prompt Builder ────────────────────────────────────────────────────

function buildMatchPrompt(
  marketA: NormalizedMarket,
  marketB: NormalizedMarket,
): string {
  return [
    'You are a prediction market analyst. Determine if these two markets from different platforms are semantically equivalent (asking about the same event with compatible resolution criteria).',
    '',
    '=== Market A ===',
    `Platform: ${marketA.platform}`,
    `Question: ${marketA.question}`,
    `Resolution Source: ${marketA.resolutionSource}`,
    marketA.endDate ? `End Date: ${marketA.endDate}` : '',
    '',
    '=== Market B ===',
    `Platform: ${marketB.platform}`,
    `Question: ${marketB.question}`,
    `Resolution Source: ${marketB.resolutionSource}`,
    marketB.endDate ? `End Date: ${marketB.endDate}` : '',
    '',
    'Analyze:',
    '1. Are these markets asking about the same event?',
    '2. Are the resolution sources/oracles compatible? (e.g., same data source, similar timing)',
    '3. Could differences in resolution criteria lead to different outcomes?',
    '',
    'Respond in this exact JSON format only, no other text:',
    '{',
    '  "confidence": <0.0-1.0 how confident the markets are equivalent>,',
    '  "oracleMismatch": <true if resolution sources conflict>,',
    '  "oracleMismatchReason": "<reason if oracleMismatch is true>",',
    '  "reasoning": "<your analysis>"',
    '}',
  ].filter(Boolean).join('\n');
}

// ─── SemanticMatcher Class ─────────────────────────────────────────────────

export class SemanticMatcher {
  private db: Database.Database;
  private aiRuntime: AIRuntime;

  constructor(db: Database.Database, aiRuntime: AIRuntime) {
    this.db = db;
    this.aiRuntime = aiRuntime;
  }

  /**
   * Match two markets for semantic equivalence.
   * Checks cache first, falls back to LLM if cache miss or expired.
   */
  async matchMarkets(
    marketA: NormalizedMarket,
    marketB: NormalizedMarket,
  ): Promise<MatchResult> {
    // Normalize key ordering: always sort by platform+marketId for consistent cache keys
    const [first, second] = this.orderMarkets(marketA, marketB);

    // 1. Check cache
    try {
      const cached = this.lookupCache(first, second);
      if (cached) {
        return cached;
      }
    } catch (err: any) {
      // Cache lookup failure — fall through to LLM call
      console.warn(`[SemanticMatcher] Cache lookup failed: ${err.message}`);
    }

    // 2. Call LLM
    try {
      const prompt = buildMatchPrompt(marketA, marketB);
      const response = await this.aiRuntime.execute({
        sessionId: `semantic-match-${Date.now()}-${first.marketId}-${second.marketId}`,
        message: prompt,
        model: this.getModel(),
      });

      // 3. Parse and validate LLM response
      const parsed = this.parseLLMResponse(response.text);

      const confidence = classifyConfidence(
        parsed.confidence,
        parsed.oracleMismatch,
      );

      const result: MatchResult = {
        marketA: { platform: first.platform, marketId: first.marketId },
        marketB: { platform: second.platform, marketId: second.marketId },
        confidence,
        confidenceScore: parsed.confidence,
        oracleMismatch: parsed.oracleMismatch,
        oracleMismatchReason: parsed.oracleMismatchReason,
        fromCache: false,
      };

      // 4. Store in cache
      try {
        this.storeCache(result, first.endDate ?? second.endDate);
      } catch (err: any) {
        console.warn(`[SemanticMatcher] Cache store failed: ${err.message}`);
      }

      return result;
    } catch (err: any) {
      // LLM call failure — log and return low confidence
      console.error(`[SemanticMatcher] LLM call failed for ${first.marketId} vs ${second.marketId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Batch match all cross-platform pairs.
   * Returns only pairs with confidence === 'high' AND oracleMismatch === false.
   */
  async findMatchingPairs(
    markets: NormalizedMarket[],
  ): Promise<MarketPair[]> {
    const pairs: MarketPair[] = [];

    // Generate all cross-platform pairs
    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        const a = markets[i];
        const b = markets[j];

        // Only match across different platforms
        if (a.platform === b.platform) continue;

        try {
          const matchResult = await this.matchMarkets(a, b);

          if (matchResult.confidence === 'high' && !matchResult.oracleMismatch) {
            pairs.push({ marketA: a, marketB: b, matchResult });
          }
        } catch (err: any) {
          // LLM call failure — skip this pair
          console.error(`[SemanticMatcher] Skipping pair ${a.marketId} vs ${b.marketId}: ${err.message}`);
        }
      }
    }

    return pairs;
  }

  /**
   * Delete expired cache entries.
   */
  pruneExpiredCache(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    this.db.prepare(
      'DELETE FROM cross_market_match_cache WHERE expires_at <= ?',
    ).run(nowSec);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Order two markets deterministically for consistent cache keys.
   */
  private orderMarkets(
    a: NormalizedMarket,
    b: NormalizedMarket,
  ): [NormalizedMarket, NormalizedMarket] {
    const keyA = `${a.platform}:${a.marketId}`;
    const keyB = `${b.platform}:${b.marketId}`;
    return keyA <= keyB ? [a, b] : [b, a];
  }

  /**
   * Look up cache for a market pair. Returns null if miss or expired.
   */
  private lookupCache(
    marketA: NormalizedMarket,
    marketB: NormalizedMarket,
  ): MatchResult | null {
    const nowSec = Math.floor(Date.now() / 1000);

    const row = this.db.prepare(`
      SELECT * FROM cross_market_match_cache
      WHERE platform_a = ? AND market_id_a = ?
        AND platform_b = ? AND market_id_b = ?
    `).get(
      marketA.platform,
      marketA.marketId,
      marketB.platform,
      marketB.marketId,
    ) as any;

    if (!row) return null;

    // Check expiry
    if (row.expires_at <= nowSec) return null;

    return {
      marketA: { platform: row.platform_a, marketId: row.market_id_a },
      marketB: { platform: row.platform_b, marketId: row.market_id_b },
      confidence: row.confidence as 'high' | 'medium' | 'low',
      confidenceScore: row.confidence_score,
      oracleMismatch: row.oracle_mismatch === 1,
      oracleMismatchReason: row.oracle_mismatch_reason ?? undefined,
      fromCache: true,
    };
  }

  /**
   * Store match result in cache using a transaction.
   */
  private storeCache(
    result: MatchResult,
    marketEndDate: string | null,
  ): void {
    const nowMs = Date.now();
    const expiresAt = calculateCacheExpiry(nowMs, marketEndDate);

    const upsert = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO cross_market_match_cache
          (platform_a, market_id_a, platform_b, market_id_b,
           confidence, confidence_score, oracle_mismatch, oracle_mismatch_reason,
           market_end_date, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform_a, market_id_a, platform_b, market_id_b)
        DO UPDATE SET
          confidence = excluded.confidence,
          confidence_score = excluded.confidence_score,
          oracle_mismatch = excluded.oracle_mismatch,
          oracle_mismatch_reason = excluded.oracle_mismatch_reason,
          market_end_date = excluded.market_end_date,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `).run(
        result.marketA.platform,
        result.marketA.marketId,
        result.marketB.platform,
        result.marketB.marketId,
        result.confidence,
        result.confidenceScore,
        result.oracleMismatch ? 1 : 0,
        result.oracleMismatchReason ?? null,
        marketEndDate,
        Math.floor(nowMs / 1000),
        expiresAt,
      );
    });

    upsert();
  }

  /**
   * Parse LLM response text. Extracts JSON block and validates with Zod.
   * On validation failure, returns low-confidence defaults.
   */
  private parseLLMResponse(text: string): z.infer<typeof MatchResponseSchema> {
    try {
      // Extract JSON block from response (handles markdown-wrapped JSON)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[SemanticMatcher] No JSON block found in LLM response');
        return {
          confidence: 0,
          oracleMismatch: false,
          reasoning: 'Failed to parse LLM response: no JSON block found',
        };
      }

      const raw = JSON.parse(jsonMatch[0]);
      const validated = MatchResponseSchema.parse(raw);
      return validated;
    } catch (err: any) {
      console.warn(`[SemanticMatcher] Zod validation failed: ${err.message}`);
      return {
        confidence: 0,
        oracleMismatch: false,
        reasoning: `Failed to parse LLM response: ${err.message}`,
      };
    }
  }

  /**
   * Get the model to use for LLM calls.
   */
  private getModel(): string {
    try {
      const modelManager = this.aiRuntime.getModelManager();
      const configured = modelManager.getConfiguredModels();
      return (
        configured.find((m: string) => m.includes('gpt-4')) ||
        configured.find((m: string) => m.includes('claude')) ||
        configured.find((m: string) => m.includes('gemini')) ||
        configured[0] ||
        'gpt-4o-mini'
      );
    } catch {
      return 'gpt-4o-mini';
    }
  }
}

export { MatchResponseSchema };
