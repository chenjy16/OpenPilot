import Database from 'better-sqlite3';
import { PortfolioManager } from '../PortfolioManager';
import { PositionSyncer } from './PositionSyncer';
import { initTradingTables } from './tradingSchema';
import type { TradingGateway } from './TradingGateway';
import type { BrokerAccount, BrokerPosition } from './types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  // Create referenced tables for foreign keys
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  // Create portfolio_positions table
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
  accountError?: Error;
}): TradingGateway {
  return {
    getPositions: overrides?.positionsError
      ? jest.fn().mockRejectedValue(overrides.positionsError)
      : jest.fn().mockResolvedValue(overrides?.positions ?? []),
    getAccount: overrides?.accountError
      ? jest.fn().mockRejectedValue(overrides.accountError)
      : jest.fn().mockResolvedValue(
          overrides?.account ?? {
            total_assets: 1_000_000,
            available_cash: 500_000,
            frozen_cash: 100_000,
            currency: 'CNY',
          },
        ),
  } as unknown as TradingGateway;
}

describe('PositionSyncer', () => {
  let db: Database.Database;
  let pm: PortfolioManager;

  beforeEach(() => {
    db = createTestDb();
    pm = new PortfolioManager(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('sync()', () => {
    it('should add broker positions not in local', async () => {
      const brokerPositions: BrokerPosition[] = [
        { symbol: '600519.SH', quantity: 100, avg_cost: 1800, current_price: 1900, market_value: 190000 },
      ];
      const gateway = makeMockGateway({ positions: brokerPositions });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({
        symbol: '600519.SH',
        local_quantity: 0,
        broker_quantity: 100,
        action: 'add',
      });

      const locals = pm.listPositions();
      expect(locals).toHaveLength(1);
      expect(locals[0].symbol).toBe('600519.SH');
      expect(locals[0].quantity).toBe(100);
      expect(locals[0].cost_price).toBe(1800);
      expect(locals[0].current_price).toBe(1900);
    });

    it('should update local positions when broker data differs', async () => {
      pm.addPosition({ symbol: '600519.SH', quantity: 50, cost_price: 1700, current_price: 1800 });

      const brokerPositions: BrokerPosition[] = [
        { symbol: '600519.SH', quantity: 100, avg_cost: 1800, current_price: 1900, market_value: 190000 },
      ];
      const gateway = makeMockGateway({ positions: brokerPositions });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({
        symbol: '600519.SH',
        local_quantity: 50,
        broker_quantity: 100,
        action: 'update',
      });

      const locals = pm.listPositions();
      expect(locals).toHaveLength(1);
      expect(locals[0].quantity).toBe(100);
      expect(locals[0].cost_price).toBe(1800);
      expect(locals[0].current_price).toBe(1900);
    });

    it('should remove local positions not in broker', async () => {
      pm.addPosition({ symbol: '600519.SH', quantity: 100, cost_price: 1800 });
      pm.addPosition({ symbol: '000001.SZ', quantity: 200, cost_price: 15 });

      const brokerPositions: BrokerPosition[] = [
        { symbol: '600519.SH', quantity: 100, avg_cost: 1800, current_price: 1900, market_value: 190000 },
      ];
      const gateway = makeMockGateway({ positions: brokerPositions });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      const removeDiff = diffs.find((d) => d.action === 'remove');
      expect(removeDiff).toEqual({
        symbol: '000001.SZ',
        local_quantity: 200,
        broker_quantity: 0,
        action: 'remove',
      });

      const locals = pm.listPositions();
      expect(locals).toHaveLength(1);
      expect(locals[0].symbol).toBe('600519.SH');
    });

    it('should return empty diffs when local matches broker exactly', async () => {
      pm.addPosition({ symbol: '600519.SH', quantity: 100, cost_price: 1800, current_price: 1900 });

      const brokerPositions: BrokerPosition[] = [
        { symbol: '600519.SH', quantity: 100, avg_cost: 1800, current_price: 1900, market_value: 190000 },
      ];
      const gateway = makeMockGateway({ positions: brokerPositions });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(0);
      expect(pm.listPositions()).toHaveLength(1);
    });

    it('should handle mixed add/update/remove in a single sync', async () => {
      pm.addPosition({ symbol: 'KEEP.SH', quantity: 50, cost_price: 10, current_price: 11 });
      pm.addPosition({ symbol: 'UPDATE.SH', quantity: 100, cost_price: 20 });
      pm.addPosition({ symbol: 'REMOVE.SH', quantity: 200, cost_price: 30 });

      const brokerPositions: BrokerPosition[] = [
        { symbol: 'KEEP.SH', quantity: 50, avg_cost: 10, current_price: 11, market_value: 550 },
        { symbol: 'UPDATE.SH', quantity: 150, avg_cost: 22, current_price: 25, market_value: 3750 },
        { symbol: 'NEW.SH', quantity: 300, avg_cost: 5, current_price: 6, market_value: 1800 },
      ];
      const gateway = makeMockGateway({ positions: brokerPositions });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(3);
      expect(diffs.find((d) => d.action === 'update')?.symbol).toBe('UPDATE.SH');
      expect(diffs.find((d) => d.action === 'add')?.symbol).toBe('NEW.SH');
      expect(diffs.find((d) => d.action === 'remove')?.symbol).toBe('REMOVE.SH');

      const locals = pm.listPositions();
      expect(locals).toHaveLength(3);
      const symbols = locals.map((p) => p.symbol).sort();
      expect(symbols).toEqual(['KEEP.SH', 'NEW.SH', 'UPDATE.SH']);
    });

    it('should keep local data unchanged when broker API fails', async () => {
      pm.addPosition({ symbol: '600519.SH', quantity: 100, cost_price: 1800 });

      const gateway = makeMockGateway({
        positionsError: new Error('Connection timeout'),
      });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(0);
      const locals = pm.listPositions();
      expect(locals).toHaveLength(1);
      expect(locals[0].quantity).toBe(100);
    });

    it('should sync account-level info', async () => {
      const account: BrokerAccount = {
        total_assets: 2_000_000,
        available_cash: 800_000,
        frozen_cash: 200_000,
        currency: 'CNY',
      };
      const gateway = makeMockGateway({ account });
      const syncer = new PositionSyncer(pm, gateway);

      await syncer.sync();

      const accountSync = syncer.getLastAccountSync();
      expect(accountSync).toEqual({
        total_assets: 2_000_000,
        available_cash: 800_000,
        frozen_cash: 200_000,
      });
    });

    it('should handle empty broker positions (clear all local)', async () => {
      pm.addPosition({ symbol: '600519.SH', quantity: 100, cost_price: 1800 });
      pm.addPosition({ symbol: '000001.SZ', quantity: 200, cost_price: 15 });

      const gateway = makeMockGateway({ positions: [] });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(2);
      expect(diffs.every((d) => d.action === 'remove')).toBe(true);
      expect(pm.listPositions()).toHaveLength(0);
    });

    it('should handle empty local positions with broker data', async () => {
      const brokerPositions: BrokerPosition[] = [
        { symbol: 'A.SH', quantity: 100, avg_cost: 10, current_price: 11, market_value: 1100 },
        { symbol: 'B.SH', quantity: 200, avg_cost: 20, current_price: 22, market_value: 4400 },
      ];
      const gateway = makeMockGateway({ positions: brokerPositions });
      const syncer = new PositionSyncer(pm, gateway);

      const diffs = await syncer.sync();

      expect(diffs).toHaveLength(2);
      expect(diffs.every((d) => d.action === 'add')).toBe(true);
      expect(pm.listPositions()).toHaveLength(2);
    });
  });

  describe('start() / stop()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start periodic sync at configured interval', async () => {
      const gateway = makeMockGateway({ positions: [] });
      const syncer = new PositionSyncer(pm, gateway, 5000);

      syncer.start();

      // Advance timer by one interval
      jest.advanceTimersByTime(5000);
      // getPositions should have been called once by the interval
      expect(gateway.getPositions).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(5000);
      expect(gateway.getPositions).toHaveBeenCalledTimes(2);

      syncer.stop();
    });

    it('should stop periodic sync', () => {
      const gateway = makeMockGateway({ positions: [] });
      const syncer = new PositionSyncer(pm, gateway, 5000);

      syncer.start();
      syncer.stop();

      jest.advanceTimersByTime(10000);
      expect(gateway.getPositions).not.toHaveBeenCalled();
    });

    it('should not start multiple timers if start() called twice', () => {
      const gateway = makeMockGateway({ positions: [] });
      const syncer = new PositionSyncer(pm, gateway, 5000);

      syncer.start();
      syncer.start(); // second call should be no-op

      jest.advanceTimersByTime(5000);
      expect(gateway.getPositions).toHaveBeenCalledTimes(1);

      syncer.stop();
    });

    it('should use default 60s interval when not specified', () => {
      const gateway = makeMockGateway({ positions: [] });
      const syncer = new PositionSyncer(pm, gateway);

      syncer.start();

      jest.advanceTimersByTime(59999);
      expect(gateway.getPositions).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(gateway.getPositions).toHaveBeenCalledTimes(1);

      syncer.stop();
    });
  });
});
