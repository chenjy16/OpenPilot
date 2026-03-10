/**
 * Property-Based Tests for PositionSyncer
 *
 * Feature: quant-trading-broker-integration
 * Property 5: 持仓同步收敛与幂等
 *
 * Validates: Requirements 6.2, 6.4
 */

import Database from 'better-sqlite3';
import * as fc from 'fast-check';
import { PortfolioManager } from '../PortfolioManager';
import { PositionSyncer } from './PositionSyncer';
import { initTradingTables } from './tradingSchema';
import type { TradingGateway } from './TradingGateway';
import type { BrokerPosition, BrokerAccount } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SYMBOLS = [
  '600519.SH', '000001.SZ', '000858.SZ', '601318.SH',
  '600036.SH', '000333.SZ', '002415.SZ', '600276.SH',
];

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      quantity REAL NOT NULL,
      cost_price REAL NOT NULL,
      current_price REAL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);
  initTradingTables(db);
  return db;
}

function makeMockGateway(overrides?: {
  positions?: BrokerPosition[];
  account?: BrokerAccount;
  positionsError?: Error;
}): TradingGateway {
  return {
    getPositions: overrides?.positionsError
      ? jest.fn().mockRejectedValue(overrides.positionsError)
      : jest.fn().mockResolvedValue(overrides?.positions ?? []),
    getAccount: jest.fn().mockResolvedValue({
      total_assets: 1_000_000,
      available_cash: 500_000,
      frozen_cash: 100_000,
      currency: 'CNY',
    }),
  } as unknown as TradingGateway;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a unique subset of symbols */
const symbolSubsetArb = fc.shuffledSubarray(VALID_SYMBOLS, { minLength: 1, maxLength: VALID_SYMBOLS.length });

/** Generate a single BrokerPosition for a given symbol */
function brokerPositionArb(symbol: string): fc.Arbitrary<BrokerPosition> {
  return fc.record({
    symbol: fc.constant(symbol),
    quantity: fc.integer({ min: 1, max: 10000 }),
    avg_cost: fc.double({ min: 0.01, max: 5000, noNaN: true }),
    current_price: fc.double({ min: 0.01, max: 5000, noNaN: true }),
  }).map((p) => ({
    ...p,
    market_value: p.quantity * p.current_price,
  }));
}

/** Generate a list of BrokerPositions with unique symbols */
const brokerPositionsArb: fc.Arbitrary<BrokerPosition[]> = symbolSubsetArb.chain((symbols) =>
  fc.tuple(...symbols.map((s) => brokerPositionArb(s))),
);

// ---------------------------------------------------------------------------
// Property 5: 持仓同步收敛与幂等
// ---------------------------------------------------------------------------

describe('PositionSyncer Property Tests', () => {
  /**
   * Property 5.1: After sync, local positions match broker data
   *
   * For any set of broker positions, after executing sync(),
   * the local PortfolioManager positions should match the broker data
   * in symbol, quantity, cost_price, and current_price.
   *
   * **Validates: Requirements 6.2**
   */
  it('Property 5 (convergence): after sync, local positions match broker data', async () => {
    await fc.assert(
      fc.asyncProperty(brokerPositionsArb, async (brokerPositions) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);
          const gateway = makeMockGateway({ positions: brokerPositions });
          const syncer = new PositionSyncer(pm, gateway);

          await syncer.sync();

          const localPositions = pm.listPositions();
          expect(localPositions).toHaveLength(brokerPositions.length);

          for (const bp of brokerPositions) {
            const local = localPositions.find((lp) => lp.symbol === bp.symbol);
            expect(local).toBeDefined();
            expect(local!.quantity).toBe(bp.quantity);
            expect(local!.cost_price).toBe(bp.avg_cost);
            expect(local!.current_price).toBe(bp.current_price);
          }
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 5.2: Two consecutive syncs with same data produce no changes (idempotency)
   *
   * For any set of broker positions, after the first sync aligns local data,
   * a second sync with the same broker data should return an empty diffs array.
   *
   * **Validates: Requirements 6.2**
   */
  it('Property 5 (idempotency): second sync with same data returns empty diffs', async () => {
    await fc.assert(
      fc.asyncProperty(brokerPositionsArb, async (brokerPositions) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);
          const gateway = makeMockGateway({ positions: brokerPositions });
          const syncer = new PositionSyncer(pm, gateway);

          // First sync — aligns local with broker
          await syncer.sync();

          // Second sync — same data, should produce no diffs
          const diffs = await syncer.sync();
          expect(diffs).toHaveLength(0);

          // Local positions should still match broker
          const localPositions = pm.listPositions();
          expect(localPositions).toHaveLength(brokerPositions.length);
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 5.3: When API is unavailable, local data remains unchanged
   *
   * For any set of pre-existing local positions, if the broker API throws
   * an error during sync, the local positions should remain exactly as they were.
   *
   * **Validates: Requirements 6.4**
   */
  it('Property 5 (API failure): local data stays unchanged when getPositions throws', async () => {
    await fc.assert(
      fc.asyncProperty(brokerPositionsArb, async (brokerPositions) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);

          // Seed local positions from broker data
          for (const bp of brokerPositions) {
            pm.addPosition({
              symbol: bp.symbol,
              quantity: bp.quantity,
              cost_price: bp.avg_cost,
              current_price: bp.current_price,
            });
          }

          const positionsBefore = pm.listPositions();

          // Gateway that throws on getPositions
          const failingGateway = makeMockGateway({
            positionsError: new Error('Connection timeout'),
          });
          const syncer = new PositionSyncer(pm, failingGateway);

          const diffs = await syncer.sync();

          // Should return empty diffs (no changes made)
          expect(diffs).toHaveLength(0);

          // Local positions should be unchanged
          const positionsAfter = pm.listPositions();
          expect(positionsAfter).toHaveLength(positionsBefore.length);

          for (const before of positionsBefore) {
            const after = positionsAfter.find((p) => p.symbol === before.symbol);
            expect(after).toBeDefined();
            expect(after!.quantity).toBe(before.quantity);
            expect(after!.cost_price).toBe(before.cost_price);
            expect(after!.current_price).toBe(before.current_price);
          }
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });
});
