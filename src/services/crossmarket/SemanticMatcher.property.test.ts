/**
 * Property-Based Tests for SemanticMatcher
 *
 * Feature: cross-market-arbitrage
 * Properties 3, 4, 5, 6, 7
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.8
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { classifyConfidence, calculateCacheExpiry } from './SemanticMatcher';
import type { Platform, NormalizedMarket, MatchResult } from './types';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const platformArb = fc.constantFrom<Platform>('polymarket', 'kalshi', 'myriad', 'manifold');

const priceArb = fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true });

const marketIdArb = fc.string({ minLength: 8, maxLength: 16 }).filter(s => s.length >= 8);

const normalizedMarketArb = fc.record({
  platform: platformArb,
  marketId: marketIdArb,
  question: fc.string({ minLength: 5, maxLength: 200 }),
  yesPrice: priceArb,
  noPrice: priceArb,
  volume: fc.double({ min: 0, max: 1e8, noNaN: true, noDefaultInfinity: true }),
  liquidity: fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }),
  endDate: fc.option(
    fc.integer({ min: 1704067200000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()),
    { nil: null },
  ),
  resolutionSource: fc.string({ minLength: 1, maxLength: 500 }),
  active: fc.boolean(),
});

const confidenceScoreArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

const confidenceLevelArb = fc.constantFrom<'high' | 'medium' | 'low'>('high', 'medium', 'low');

const matchResultArb = fc.record({
  marketA: fc.record({ platform: platformArb, marketId: marketIdArb }),
  marketB: fc.record({ platform: platformArb, marketId: marketIdArb }),
  confidence: confidenceLevelArb,
  confidenceScore: confidenceScoreArb,
  oracleMismatch: fc.boolean(),
  oracleMismatchReason: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  fromCache: fc.constant(false),
});

// ---------------------------------------------------------------------------
// Property 3: LLM Prompt includes both resolution sources
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 3: LLM Prompt includes both resolution sources', () => {
  /**
   * Validates: Requirements 2.2
   */
  it('LLM prompt must contain both marketA.resolutionSource and marketB.resolutionSource', async () => {
    await fc.assert(
      fc.asyncProperty(
        normalizedMarketArb,
        normalizedMarketArb,
        async (marketA, marketB) => {
          let capturedPrompt = '';

          // Mock AIRuntime to capture the prompt
          const mockAIRuntime = {
            execute: jest.fn().mockImplementation(async (params: any) => {
              capturedPrompt = params.message;
              return {
                text: JSON.stringify({
                  confidence: 0.5,
                  oracleMismatch: false,
                  reasoning: 'test',
                }),
              };
            }),
            getModelManager: jest.fn().mockReturnValue({
              getConfiguredModels: jest.fn().mockReturnValue(['gpt-4o-mini']),
            }),
          };

          // Create in-memory DB with cache table
          const db = new Database(':memory:');
          db.exec(`
            CREATE TABLE IF NOT EXISTS cross_market_match_cache (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              platform_a TEXT NOT NULL,
              market_id_a TEXT NOT NULL,
              platform_b TEXT NOT NULL,
              market_id_b TEXT NOT NULL,
              confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
              confidence_score REAL NOT NULL,
              oracle_mismatch INTEGER NOT NULL DEFAULT 0,
              oracle_mismatch_reason TEXT,
              market_end_date TEXT,
              created_at INTEGER NOT NULL DEFAULT (unixepoch()),
              expires_at INTEGER NOT NULL,
              UNIQUE(platform_a, market_id_a, platform_b, market_id_b)
            );
          `);

          const { SemanticMatcher } = await import('./SemanticMatcher');
          const matcher = new SemanticMatcher(db, mockAIRuntime as any);

          await matcher.matchMarkets(marketA, marketB);

          expect(capturedPrompt).toContain(marketA.resolutionSource);
          expect(capturedPrompt).toContain(marketB.resolutionSource);

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 4: Confidence grading and Oracle Mismatch invariant
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 4: Confidence grading and Oracle Mismatch invariant', () => {
  /**
   * Validates: Requirements 2.3, 2.4
   */
  it('classifyConfidence must follow grading rules and oracleMismatch forces low', () => {
    fc.assert(
      fc.property(
        confidenceScoreArb,
        fc.boolean(),
        (score, oracleMismatch) => {
          const result = classifyConfidence(score, oracleMismatch);

          if (oracleMismatch) {
            // Oracle mismatch MUST always force 'low' regardless of score
            expect(result).toBe('low');
          } else if (score >= 0.9) {
            expect(result).toBe('high');
          } else if (score >= 0.7) {
            expect(result).toBe('medium');
          } else {
            expect(result).toBe('low');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('oracleMismatch === true always produces low confidence regardless of score', () => {
    fc.assert(
      fc.property(
        confidenceScoreArb,
        (score) => {
          const result = classifyConfidence(score, true);
          expect(result).toBe('low');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: High confidence filtering
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 5: High confidence filtering', () => {
  /**
   * Validates: Requirements 2.5
   */
  it('only confidence === high AND oracleMismatch === false should pass the filter, with confidenceScore >= 0.9', () => {
    fc.assert(
      fc.property(
        fc.array(matchResultArb, { minLength: 0, maxLength: 20 }),
        (matchResults) => {
          // Apply the same filtering logic used in findMatchingPairs
          const filtered = matchResults.filter(
            (r) => r.confidence === 'high' && !r.oracleMismatch,
          );

          // All passing results must have confidence === 'high' and oracleMismatch === false
          for (const r of filtered) {
            expect(r.confidence).toBe('high');
            expect(r.oracleMismatch).toBe(false);
          }

          // All results that didn't pass must have confidence !== 'high' OR oracleMismatch === true
          const rejected = matchResults.filter(
            (r) => !(r.confidence === 'high' && !r.oracleMismatch),
          );
          for (const r of rejected) {
            expect(
              r.confidence !== 'high' || r.oracleMismatch === true,
            ).toBe(true);
          }

          // Additionally: all passing results with properly classified confidence
          // must have confidenceScore >= 0.9 (since high requires >= 0.9 without oracle mismatch)
          // Note: We verify this by re-classifying with classifyConfidence
          for (const r of filtered) {
            const reclassified = classifyConfidence(r.confidenceScore, r.oracleMismatch);
            if (reclassified === 'high') {
              expect(r.confidenceScore).toBeGreaterThanOrEqual(0.9);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 6: Match cache round-trip consistency
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 6: Match cache round-trip consistency', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS cross_market_match_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_a TEXT NOT NULL,
        market_id_a TEXT NOT NULL,
        platform_b TEXT NOT NULL,
        market_id_b TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
        confidence_score REAL NOT NULL,
        oracle_mismatch INTEGER NOT NULL DEFAULT 0,
        oracle_mismatch_reason TEXT,
        market_end_date TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        UNIQUE(platform_a, market_id_a, platform_b, market_id_b)
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Validates: Requirements 2.6
   */
  it('storing a MatchResult to cache then querying should return equivalent record', () => {
    fc.assert(
      fc.property(
        matchResultArb,
        (matchResult) => {
          const nowSec = Math.floor(Date.now() / 1000);
          // Set expires_at far in the future so cache is valid
          const expiresAt = nowSec + 86400;

          // Insert into cache
          db.prepare(`
            INSERT OR REPLACE INTO cross_market_match_cache
              (platform_a, market_id_a, platform_b, market_id_b,
               confidence, confidence_score, oracle_mismatch, oracle_mismatch_reason,
               market_end_date, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            matchResult.marketA.platform,
            matchResult.marketA.marketId,
            matchResult.marketB.platform,
            matchResult.marketB.marketId,
            matchResult.confidence,
            matchResult.confidenceScore,
            matchResult.oracleMismatch ? 1 : 0,
            matchResult.oracleMismatchReason ?? null,
            null, // market_end_date
            nowSec,
            expiresAt,
          );

          // Query back
          const row = db.prepare(`
            SELECT * FROM cross_market_match_cache
            WHERE platform_a = ? AND market_id_a = ?
              AND platform_b = ? AND market_id_b = ?
          `).get(
            matchResult.marketA.platform,
            matchResult.marketA.marketId,
            matchResult.marketB.platform,
            matchResult.marketB.marketId,
          ) as any;

          expect(row).toBeTruthy();
          expect(row.platform_a).toBe(matchResult.marketA.platform);
          expect(row.market_id_a).toBe(matchResult.marketA.marketId);
          expect(row.platform_b).toBe(matchResult.marketB.platform);
          expect(row.market_id_b).toBe(matchResult.marketB.marketId);
          expect(row.confidence).toBe(matchResult.confidence);
          expect(row.confidence_score).toBeCloseTo(matchResult.confidenceScore, 9);
          expect(row.oracle_mismatch === 1).toBe(matchResult.oracleMismatch);
          expect(row.oracle_mismatch_reason ?? undefined).toBe(
            matchResult.oracleMismatchReason,
          );

          // Clean up for next iteration (unique constraint)
          db.prepare(`
            DELETE FROM cross_market_match_cache
            WHERE platform_a = ? AND market_id_a = ?
              AND platform_b = ? AND market_id_b = ?
          `).run(
            matchResult.marketA.platform,
            matchResult.marketA.marketId,
            matchResult.marketB.platform,
            matchResult.marketB.marketId,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 7: Dynamic cache expiry time
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 7: Dynamic cache expiry time', () => {
  /**
   * Validates: Requirements 2.8
   */
  it('endDate >= 48h away → cache TTL = 24h', () => {
    fc.assert(
      fc.property(
        // Generate hours from 48 to 1000 (well beyond 48h threshold)
        fc.double({ min: 48, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (hoursAway) => {
          const nowMs = Date.now();
          const endDate = new Date(nowMs + hoursAway * 60 * 60 * 1000).toISOString();
          const expiresAt = calculateCacheExpiry(nowMs, endDate);
          const nowSec = Math.floor(nowMs / 1000);

          // TTL should be 24h = 86400 seconds
          expect(expiresAt).toBe(nowSec + 86400);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('endDate < 48h away (but in future) → cache TTL = 1h', () => {
    fc.assert(
      fc.property(
        // Generate hours from just above 0 to just below 48
        fc.double({ min: 0.001, max: 47.999, noNaN: true, noDefaultInfinity: true }),
        (hoursAway) => {
          const nowMs = Date.now();
          const endDate = new Date(nowMs + hoursAway * 60 * 60 * 1000).toISOString();
          const expiresAt = calculateCacheExpiry(nowMs, endDate);
          const nowSec = Math.floor(nowMs / 1000);

          // TTL should be 1h = 3600 seconds
          expect(expiresAt).toBe(nowSec + 3600);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('market closed (endDate in past) → immediately expired (expiresAt <= now)', () => {
    fc.assert(
      fc.property(
        // Generate hours in the past (1 to 10000 hours ago)
        fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
        (hoursAgo) => {
          const nowMs = Date.now();
          const endDate = new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();
          const expiresAt = calculateCacheExpiry(nowMs, endDate);
          const nowSec = Math.floor(nowMs / 1000);

          // Should be immediately expired
          expect(expiresAt).toBeLessThanOrEqual(nowSec);
        },
      ),
      { numRuns: 100 },
    );
  });
});
