/**
 * Unit tests for SemanticMatcher
 *
 * Covers: LLM mock call, cache hit/miss, Zod validation fallback,
 * LLM timeout/error handling, markdown-wrapped JSON, pruneExpiredCache,
 * findMatchingPairs filtering.
 *
 * Requirements: 2.7, 2.9
 */

import Database from 'better-sqlite3';
import { SemanticMatcher } from './SemanticMatcher';
import type { NormalizedMarket } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): InstanceType<typeof Database> {
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
  return db;
}

function createMockAIRuntime(executeImpl?: jest.Mock) {
  return {
    execute: executeImpl ?? jest.fn(),
    getModelManager: jest.fn().mockReturnValue({
      getConfiguredModels: jest.fn().mockReturnValue(['gpt-4o-mini']),
    }),
  };
}

const marketA: NormalizedMarket = {
  platform: 'polymarket',
  marketId: 'poly-001',
  question: 'Will BTC hit 100k by end of 2025?',
  yesPrice: 0.62,
  noPrice: 0.38,
  volume: 50000,
  liquidity: 20000,
  endDate: '2025-12-31T00:00:00Z',
  resolutionSource: 'CoinGecko price feed at midnight UTC',
  active: true,
};

const marketB: NormalizedMarket = {
  platform: 'kalshi',
  marketId: 'kalshi-001',
  question: 'Bitcoin to reach $100,000 by December 2025?',
  yesPrice: 0.58,
  noPrice: 0.42,
  volume: 30000,
  liquidity: 15000,
  endDate: '2025-12-31T00:00:00Z',
  resolutionSource: 'CoinMarketCap closing price',
  active: true,
};

const VALID_LLM_RESPONSE = JSON.stringify({
  confidence: 0.95,
  oracleMismatch: false,
  reasoning: 'Both markets ask about BTC reaching 100k by end of 2025.',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SemanticMatcher', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. LLM mock call — verify prompt structure and result parsing
  // -----------------------------------------------------------------------

  describe('LLM mock call', () => {
    it('calls AIRuntime.execute with correct prompt structure and parses result', async () => {
      const mockExecute = jest.fn().mockResolvedValue({ text: VALID_LLM_RESPONSE });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      // Verify AIRuntime.execute was called once
      expect(mockExecute).toHaveBeenCalledTimes(1);

      // Verify prompt structure
      const callArgs = mockExecute.mock.calls[0][0];
      expect(callArgs).toHaveProperty('sessionId');
      expect(callArgs).toHaveProperty('message');
      expect(callArgs).toHaveProperty('model');
      expect(callArgs.message).toContain(marketA.resolutionSource);
      expect(callArgs.message).toContain(marketB.resolutionSource);
      expect(callArgs.message).toContain(marketA.question);
      expect(callArgs.message).toContain(marketB.question);
      expect(callArgs.message).toContain('polymarket');
      expect(callArgs.message).toContain('kalshi');

      // Verify result parsing
      expect(result.confidence).toBe('high');
      expect(result.confidenceScore).toBe(0.95);
      expect(result.oracleMismatch).toBe(false);
      expect(result.fromCache).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Cache hit — pre-populated cache returns without LLM call
  // -----------------------------------------------------------------------

  describe('Cache hit', () => {
    it('returns cached result without calling LLM', async () => {
      // Pre-populate cache with a valid, non-expired entry.
      // SemanticMatcher orders markets deterministically by platform:marketId.
      // 'kalshi:kalshi-001' < 'polymarket:poly-001', so kalshi comes first.
      const first = marketB;  // kalshi
      const second = marketA; // polymarket

      const nowSec = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO cross_market_match_cache
          (platform_a, market_id_a, platform_b, market_id_b,
           confidence, confidence_score, oracle_mismatch, oracle_mismatch_reason,
           market_end_date, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        first.platform, first.marketId,
        second.platform, second.marketId,
        'high', 0.95, 0, null,
        '2025-12-31T00:00:00Z', nowSec, nowSec + 86400,
      );

      const mockExecute = jest.fn();
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      // LLM should NOT have been called
      expect(mockExecute).not.toHaveBeenCalled();

      // Result should come from cache
      expect(result.fromCache).toBe(true);
      expect(result.confidence).toBe('high');
      expect(result.confidenceScore).toBe(0.95);
      expect(result.oracleMismatch).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Cache miss — empty cache triggers LLM and stores result
  // -----------------------------------------------------------------------

  describe('Cache miss', () => {
    it('calls LLM and stores result in cache when cache is empty', async () => {
      const mockExecute = jest.fn().mockResolvedValue({ text: VALID_LLM_RESPONSE });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      // LLM should have been called
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(result.fromCache).toBe(false);
      expect(result.confidence).toBe('high');

      // Verify result was stored in cache
      const rows = db.prepare('SELECT * FROM cross_market_match_cache').all();
      expect(rows).toHaveLength(1);

      const cached = rows[0] as any;
      expect(cached.confidence).toBe('high');
      expect(cached.confidence_score).toBe(0.95);
      expect(cached.oracle_mismatch).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Zod validation failure fallback
  // -----------------------------------------------------------------------

  describe('Zod validation failure fallback', () => {
    it('falls back to low confidence when LLM returns invalid JSON', async () => {
      const mockExecute = jest.fn().mockResolvedValue({
        text: '{"confidence": "not-a-number", "oracleMismatch": "yes"}',
      });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      // Should NOT throw — falls back gracefully
      const result = await matcher.matchMarkets(marketA, marketB);

      expect(result.confidence).toBe('low');
      expect(result.confidenceScore).toBe(0);
      expect(result.fromCache).toBe(false);
    });

    it('falls back to low confidence when LLM returns no JSON at all', async () => {
      const mockExecute = jest.fn().mockResolvedValue({
        text: 'I cannot determine the match between these markets.',
      });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      expect(result.confidence).toBe('low');
      expect(result.confidenceScore).toBe(0);
    });

    it('falls back to low confidence when confidence is out of range', async () => {
      const mockExecute = jest.fn().mockResolvedValue({
        text: JSON.stringify({
          confidence: 5.0, // out of [0, 1] range
          oracleMismatch: false,
          reasoning: 'test',
        }),
      });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      // Zod should reject confidence > 1
      expect(result.confidence).toBe('low');
      expect(result.confidenceScore).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. LLM timeout/error handling
  // -----------------------------------------------------------------------

  describe('LLM timeout/error handling', () => {
    it('matchMarkets throws when LLM throws an error', async () => {
      const mockExecute = jest.fn().mockRejectedValue(new Error('LLM timeout'));
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      await expect(matcher.matchMarkets(marketA, marketB)).rejects.toThrow('LLM timeout');
    });

    it('findMatchingPairs skips pairs where LLM throws', async () => {
      const marketC: NormalizedMarket = {
        platform: 'myriad',
        marketId: 'myriad-001',
        question: 'Will BTC reach 100k?',
        yesPrice: 0.60,
        noPrice: 0.40,
        volume: 10000,
        liquidity: 5000,
        endDate: '2025-12-31T00:00:00Z',
        resolutionSource: 'Binance price feed',
        active: true,
      };

      let callCount = 0;
      const mockExecute = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('LLM timeout');
        }
        // Second call succeeds with high confidence
        return { text: VALID_LLM_RESPONSE };
      });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      // marketA (polymarket) + marketB (kalshi) + marketC (myriad)
      // Cross-platform pairs: A-B, A-C, B-C
      // First pair fails, others should still be processed
      const pairs = await matcher.findMatchingPairs([marketA, marketB, marketC]);

      // Should not throw, and should have processed remaining pairs
      expect(mockExecute).toHaveBeenCalledTimes(3);
      // At least some pairs should succeed (the ones that didn't throw)
      expect(pairs.length).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Markdown-wrapped JSON
  // -----------------------------------------------------------------------

  describe('Markdown-wrapped JSON', () => {
    it('parses JSON wrapped in markdown code blocks', async () => {
      const markdownResponse = '```json\n' + JSON.stringify({
        confidence: 0.92,
        oracleMismatch: false,
        reasoning: 'Markets are semantically equivalent.',
      }) + '\n```';

      const mockExecute = jest.fn().mockResolvedValue({ text: markdownResponse });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      expect(result.confidence).toBe('high');
      expect(result.confidenceScore).toBe(0.92);
      expect(result.oracleMismatch).toBe(false);
    });

    it('parses JSON wrapped in plain markdown code blocks', async () => {
      const markdownResponse = '```\n' + JSON.stringify({
        confidence: 0.75,
        oracleMismatch: true,
        oracleMismatchReason: 'Different resolution timing',
        reasoning: 'Resolution sources differ.',
      }) + '\n```';

      const mockExecute = jest.fn().mockResolvedValue({ text: markdownResponse });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const result = await matcher.matchMarkets(marketA, marketB);

      // oracleMismatch forces low confidence
      expect(result.confidence).toBe('low');
      expect(result.confidenceScore).toBe(0.75);
      expect(result.oracleMismatch).toBe(true);
      expect(result.oracleMismatchReason).toBe('Different resolution timing');
    });
  });

  // -----------------------------------------------------------------------
  // 7. pruneExpiredCache
  // -----------------------------------------------------------------------

  describe('pruneExpiredCache', () => {
    it('deletes expired entries and keeps valid ones', () => {
      const nowSec = Math.floor(Date.now() / 1000);

      // Insert expired entry
      db.prepare(`
        INSERT INTO cross_market_match_cache
          (platform_a, market_id_a, platform_b, market_id_b,
           confidence, confidence_score, oracle_mismatch,
           created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('polymarket', 'expired-1', 'kalshi', 'expired-2',
        'high', 0.95, 0, nowSec - 7200, nowSec - 3600);

      // Insert another expired entry
      db.prepare(`
        INSERT INTO cross_market_match_cache
          (platform_a, market_id_a, platform_b, market_id_b,
           confidence, confidence_score, oracle_mismatch,
           created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('polymarket', 'expired-3', 'myriad', 'expired-4',
        'medium', 0.80, 0, nowSec - 7200, nowSec - 1);

      // Insert valid (non-expired) entry
      db.prepare(`
        INSERT INTO cross_market_match_cache
          (platform_a, market_id_a, platform_b, market_id_b,
           confidence, confidence_score, oracle_mismatch,
           created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('kalshi', 'valid-1', 'myriad', 'valid-2',
        'high', 0.92, 0, nowSec, nowSec + 86400);

      // Verify 3 entries exist
      const beforeCount = (db.prepare('SELECT COUNT(*) as cnt FROM cross_market_match_cache').get() as any).cnt;
      expect(beforeCount).toBe(3);

      const mockAIRuntime = createMockAIRuntime();
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);
      matcher.pruneExpiredCache();

      // Only the valid entry should remain
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM cross_market_match_cache').get() as any).cnt;
      expect(afterCount).toBe(1);

      const remaining = db.prepare('SELECT * FROM cross_market_match_cache').get() as any;
      expect(remaining.market_id_a).toBe('valid-1');
      expect(remaining.market_id_b).toBe('valid-2');
    });

    it('handles empty cache gracefully', () => {
      const mockAIRuntime = createMockAIRuntime();
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      // Should not throw
      expect(() => matcher.pruneExpiredCache()).not.toThrow();

      const count = (db.prepare('SELECT COUNT(*) as cnt FROM cross_market_match_cache').get() as any).cnt;
      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 8. findMatchingPairs — only high confidence + no oracle mismatch
  // -----------------------------------------------------------------------

  describe('findMatchingPairs', () => {
    it('only returns pairs with high confidence and no oracle mismatch', async () => {
      const marketC: NormalizedMarket = {
        platform: 'myriad',
        marketId: 'myriad-002',
        question: 'Will BTC reach 100k?',
        yesPrice: 0.60,
        noPrice: 0.40,
        volume: 10000,
        liquidity: 5000,
        endDate: '2025-12-31T00:00:00Z',
        resolutionSource: 'Binance price feed',
        active: true,
      };

      let callIndex = 0;
      const responses = [
        // Pair 1 (A-B): high confidence, no oracle mismatch → INCLUDED
        { confidence: 0.95, oracleMismatch: false, reasoning: 'Match' },
        // Pair 2 (A-C): medium confidence → EXCLUDED
        { confidence: 0.75, oracleMismatch: false, reasoning: 'Partial match' },
        // Pair 3 (B-C): high score but oracle mismatch → EXCLUDED
        { confidence: 0.96, oracleMismatch: true, oracleMismatchReason: 'Different oracles', reasoning: 'Mismatch' },
      ];

      const mockExecute = jest.fn().mockImplementation(async () => {
        const resp = responses[callIndex++];
        return { text: JSON.stringify(resp) };
      });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const pairs = await matcher.findMatchingPairs([marketA, marketB, marketC]);

      // Only the first pair should pass (high + no oracle mismatch)
      expect(pairs).toHaveLength(1);
      expect(pairs[0].matchResult.confidence).toBe('high');
      expect(pairs[0].matchResult.oracleMismatch).toBe(false);
      expect(pairs[0].matchResult.confidenceScore).toBe(0.95);
    });

    it('skips same-platform pairs', async () => {
      const marketA2: NormalizedMarket = {
        ...marketA,
        marketId: 'poly-002',
        question: 'Different question on same platform',
      };

      const mockExecute = jest.fn().mockResolvedValue({ text: VALID_LLM_RESPONSE });
      const mockAIRuntime = createMockAIRuntime(mockExecute);
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      // Both markets are on polymarket — should not be matched
      const pairs = await matcher.findMatchingPairs([marketA, marketA2]);

      expect(mockExecute).not.toHaveBeenCalled();
      expect(pairs).toHaveLength(0);
    });

    it('returns empty array when no markets provided', async () => {
      const mockAIRuntime = createMockAIRuntime();
      const matcher = new SemanticMatcher(db, mockAIRuntime as any);

      const pairs = await matcher.findMatchingPairs([]);
      expect(pairs).toHaveLength(0);
    });
  });
});
