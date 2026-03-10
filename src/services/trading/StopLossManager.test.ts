import Database from 'better-sqlite3';
import { checkStopLossTrigger, StopLossManager } from './StopLossManager';
import { initTradingTables } from './tradingSchema';
import type { StopLossRecord, TradingOrder } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

function insertTestOrder(db: Database.Database, overrides: Partial<TradingOrder> = {}): number {
  const result = db.prepare(`
    INSERT INTO trading_orders (local_order_id, symbol, side, order_type, quantity, status, trading_mode, filled_quantity, filled_price, created_at, updated_at)
    VALUES (@local_order_id, @symbol, @side, @order_type, @quantity, @status, @trading_mode, @filled_quantity, @filled_price, @created_at, @updated_at)
  `).run({
    local_order_id: overrides.local_order_id || `ORD-${Date.now()}`,
    symbol: overrides.symbol || '0700.HK',
    side: overrides.side || 'buy',
    order_type: overrides.order_type || 'market',
    quantity: overrides.quantity || 100,
    status: overrides.status || 'filled',
    trading_mode: overrides.trading_mode || 'paper',
    filled_quantity: overrides.filled_quantity || 100,
    filled_price: overrides.filled_price || 350,
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    updated_at: overrides.updated_at || Math.floor(Date.now() / 1000),
  });
  return Number(result.lastInsertRowid);
}

function makeRecord(orderId: number, overrides: Partial<StopLossRecord> = {}): Omit<StopLossRecord, 'id' | 'status' | 'created_at'> {
  return {
    order_id: orderId,
    symbol: '0700.HK',
    side: 'buy' as const,
    entry_price: 350,
    stop_loss: 330,
    take_profit: 400,
    ...overrides,
  };
}

function makeMockTradingGateway(overrides: any = {}) {
  return {
    placeOrder: jest.fn().mockResolvedValue({
      id: 99,
      symbol: '0700.HK',
      side: 'sell',
      order_type: 'market',
      quantity: 100,
      status: 'filled',
      trading_mode: 'paper',
      filled_quantity: 100,
      filled_price: 325,
      local_order_id: 'ORD-SL-001',
      created_at: Date.now(),
      updated_at: Date.now(),
    }),
    getOrder: jest.fn().mockReturnValue({
      id: 1,
      quantity: 100,
      filled_quantity: 100,
    }),
    ...overrides,
  } as any;
}

function makeMockTradeNotifier() {
  return {
    notifyStopLossTriggered: jest.fn().mockResolvedValue(undefined),
    notifyUrgentAlert: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─── checkStopLossTrigger (pure function) ───────────────────────────────────

describe('checkStopLossTrigger', () => {
  it('returns stop_loss when currentPrice <= stopLoss', () => {
    expect(checkStopLossTrigger(330, 330, 400)).toBe('stop_loss');
    expect(checkStopLossTrigger(320, 330, 400)).toBe('stop_loss');
  });

  it('returns take_profit when currentPrice >= takeProfit', () => {
    expect(checkStopLossTrigger(400, 330, 400)).toBe('take_profit');
    expect(checkStopLossTrigger(450, 330, 400)).toBe('take_profit');
  });

  it('returns null when price is between stopLoss and takeProfit', () => {
    expect(checkStopLossTrigger(350, 330, 400)).toBeNull();
    expect(checkStopLossTrigger(331, 330, 400)).toBeNull();
    expect(checkStopLossTrigger(399, 330, 400)).toBeNull();
  });

  it('returns stop_loss when currentPrice equals stopLoss exactly', () => {
    expect(checkStopLossTrigger(100, 100, 200)).toBe('stop_loss');
  });

  it('returns take_profit when currentPrice equals takeProfit exactly', () => {
    expect(checkStopLossTrigger(200, 100, 200)).toBe('take_profit');
  });
});

// ─── StopLossManager.register ───────────────────────────────────────────────

describe('StopLossManager.register', () => {
  it('inserts record into DB and returns it with id and status=active', () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const gw = makeMockTradingGateway();
    const tn = makeMockTradeNotifier();
    const mgr = new StopLossManager(db, gw, tn);

    const record = mgr.register(makeRecord(orderId));

    expect(record.id).toBeDefined();
    expect(record.status).toBe('active');
    expect(record.symbol).toBe('0700.HK');
    expect(record.stop_loss).toBe(330);
    expect(record.take_profit).toBe(400);

    // Verify in DB
    const row = db.prepare('SELECT * FROM stop_loss_records WHERE id = ?').get(record.id) as any;
    expect(row).toBeDefined();
    expect(row.status).toBe('active');
    expect(row.symbol).toBe('0700.HK');
  });

  it('adds record to active records in memory', () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    mgr.register(makeRecord(orderId));
    expect(mgr.getActiveRecords()).toHaveLength(1);
  });
});

// ─── StopLossManager.cancel ─────────────────────────────────────────────────

describe('StopLossManager.cancel', () => {
  it('updates record status to cancelled in DB and removes from memory', () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    const record = mgr.register(makeRecord(orderId));
    expect(mgr.getActiveRecords()).toHaveLength(1);

    mgr.cancel(record.id!);

    expect(mgr.getActiveRecords()).toHaveLength(0);
    const row = db.prepare('SELECT status FROM stop_loss_records WHERE id = ?').get(record.id) as any;
    expect(row.status).toBe('cancelled');
  });

  it('does nothing for non-existent recordId', () => {
    const db = createTestDb();
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());
    expect(() => mgr.cancel(9999)).not.toThrow();
  });
});

// ─── StopLossManager.restoreFromDb ──────────────────────────────────────────

describe('StopLossManager.restoreFromDb', () => {
  it('loads active records from DB into memory', () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    // Insert records directly into DB
    db.prepare(`
      INSERT INTO stop_loss_records (order_id, symbol, side, entry_price, stop_loss, take_profit, status, created_at)
      VALUES (?, '0700.HK', 'buy', 350, 330, 400, 'active', ?)
    `).run(orderId, Math.floor(Date.now() / 1000));

    db.prepare(`
      INSERT INTO stop_loss_records (order_id, symbol, side, entry_price, stop_loss, take_profit, status, created_at)
      VALUES (?, 'AAPL.US', 'buy', 150, 140, 170, 'triggered_sl', ?)
    `).run(orderId, Math.floor(Date.now() / 1000));

    const restored = mgr.restoreFromDb();

    expect(restored).toHaveLength(1);
    expect(restored[0].symbol).toBe('0700.HK');
    expect(mgr.getActiveRecords()).toHaveLength(1);
  });

  it('clears previous in-memory records before restoring', () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    mgr.register(makeRecord(orderId));
    expect(mgr.getActiveRecords()).toHaveLength(1);

    // Cancel in DB so restoreFromDb finds nothing active
    db.prepare(`UPDATE stop_loss_records SET status = 'cancelled'`).run();

    const restored = mgr.restoreFromDb();
    expect(restored).toHaveLength(0);
    expect(mgr.getActiveRecords()).toHaveLength(0);
  });
});

// ─── StopLossManager.checkAll ───────────────────────────────────────────────

describe('StopLossManager.checkAll', () => {
  it('triggers stop_loss when price drops below stop_loss', async () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    // Insert a second order to represent the sell order created by placeOrder
    const sellOrderId = insertTestOrder(db, { local_order_id: 'ORD-SL-001', side: 'sell', symbol: '0700.HK' });
    const gw = makeMockTradingGateway({
      placeOrder: jest.fn().mockResolvedValue({
        id: sellOrderId,
        symbol: '0700.HK',
        side: 'sell',
        order_type: 'market',
        quantity: 100,
        status: 'filled',
        trading_mode: 'paper',
        filled_quantity: 100,
        filled_price: 320,
        local_order_id: 'ORD-SL-001',
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
      getOrder: jest.fn().mockReturnValue({ id: orderId, quantity: 100, filled_quantity: 100 }),
    });
    const tn = makeMockTradeNotifier();
    const mgr = new StopLossManager(db, gw, tn);

    mgr.register(makeRecord(orderId));

    const events = await mgr.checkAll(async () => 320); // below stop_loss=330

    expect(events).toHaveLength(1);
    expect(events[0].trigger_type).toBe('stop_loss');
    expect(events[0].current_price).toBe(320);
    expect(gw.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: '0700.HK', side: 'sell', order_type: 'market' }),
    );
    expect(tn.notifyStopLossTriggered).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveRecords()).toHaveLength(0);

    // Verify audit log
    const audit = db.prepare(`SELECT * FROM trading_audit_log WHERE operation = 'stop_loss_triggered'`).get() as any;
    expect(audit).toBeDefined();
  });

  it('triggers take_profit when price rises above take_profit', async () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const sellOrderId = insertTestOrder(db, { local_order_id: 'ORD-TP-001', side: 'sell', symbol: '0700.HK' });
    const gw = makeMockTradingGateway({
      placeOrder: jest.fn().mockResolvedValue({
        id: sellOrderId,
        symbol: '0700.HK',
        side: 'sell',
        order_type: 'market',
        quantity: 100,
        status: 'filled',
        trading_mode: 'paper',
        filled_quantity: 100,
        filled_price: 410,
        local_order_id: 'ORD-TP-001',
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
      getOrder: jest.fn().mockReturnValue({ id: orderId, quantity: 100, filled_quantity: 100 }),
    });
    const tn = makeMockTradeNotifier();
    const mgr = new StopLossManager(db, gw, tn);

    mgr.register(makeRecord(orderId));

    const events = await mgr.checkAll(async () => 410); // above take_profit=400

    expect(events).toHaveLength(1);
    expect(events[0].trigger_type).toBe('take_profit');
    expect(events[0].pnl_amount).toBe((410 - 350) * 100); // (currentPrice - entryPrice) * quantity

    const audit = db.prepare(`SELECT * FROM trading_audit_log WHERE operation = 'take_profit_triggered'`).get() as any;
    expect(audit).toBeDefined();
  });

  it('does not trigger when price is between stop_loss and take_profit', async () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    mgr.register(makeRecord(orderId));

    const events = await mgr.checkAll(async () => 360);

    expect(events).toHaveLength(0);
    expect(mgr.getActiveRecords()).toHaveLength(1);
  });

  it('sends urgent alert when placeOrder returns rejected order', async () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const gw = makeMockTradingGateway({
      placeOrder: jest.fn().mockResolvedValue({
        id: 99,
        status: 'failed',
        reject_reason: 'risk limit exceeded',
        symbol: '0700.HK',
        side: 'sell',
        order_type: 'market',
        quantity: 100,
        trading_mode: 'paper',
        filled_quantity: 0,
        local_order_id: 'ORD-SL-002',
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
      getOrder: jest.fn().mockReturnValue({ id: 1, quantity: 100, filled_quantity: 100 }),
    });
    const tn = makeMockTradeNotifier();
    const mgr = new StopLossManager(db, gw, tn);

    mgr.register(makeRecord(orderId));

    const events = await mgr.checkAll(async () => 320);

    expect(events).toHaveLength(0); // no successful trigger
    expect(tn.notifyUrgentAlert).toHaveBeenCalledTimes(1);
    expect(tn.notifyUrgentAlert.mock.calls[0][0]).toContain('risk limit exceeded');
    expect(mgr.getActiveRecords()).toHaveLength(1); // record stays active
  });

  it('sends urgent alert when placeOrder throws', async () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const gw = makeMockTradingGateway({
      placeOrder: jest.fn().mockRejectedValue(new Error('network timeout')),
      getOrder: jest.fn().mockReturnValue({ id: 1, quantity: 100, filled_quantity: 100 }),
    });
    const tn = makeMockTradeNotifier();
    const mgr = new StopLossManager(db, gw, tn);

    mgr.register(makeRecord(orderId));

    const events = await mgr.checkAll(async () => 320);

    expect(events).toHaveLength(0);
    expect(tn.notifyUrgentAlert).toHaveBeenCalledTimes(1);
    expect(tn.notifyUrgentAlert.mock.calls[0][0]).toContain('network timeout');
    expect(mgr.getActiveRecords()).toHaveLength(1);
  });

  it('skips record when getCurrentPrice throws', async () => {
    const db = createTestDb();
    const orderId = insertTestOrder(db);
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    mgr.register(makeRecord(orderId));

    const events = await mgr.checkAll(async () => { throw new Error('price unavailable'); });

    expect(events).toHaveLength(0);
    expect(mgr.getActiveRecords()).toHaveLength(1); // record stays active
  });
});

// ─── StopLossManager.startMonitoring / stopMonitoring ───────────────────────

describe('StopLossManager monitoring', () => {
  it('startMonitoring and stopMonitoring manage the timer', () => {
    const db = createTestDb();
    const mgr = new StopLossManager(db, makeMockTradingGateway(), makeMockTradeNotifier());

    mgr.startMonitoring(60000);
    // calling again should not create a second timer
    mgr.startMonitoring(60000);

    mgr.stopMonitoring();
    // calling again should be safe
    mgr.stopMonitoring();
  });
});
