import {
  formatOrderNotification,
  formatStopLossNotification,
  formatRiskAlert,
  TradeNotifier,
} from './TradeNotifier';
import type { TradingOrder, RiskCheckResult, StopLossTriggerEvent, StopLossRecord } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<TradingOrder> = {}): TradingOrder {
  return {
    id: 1,
    local_order_id: 'ORD-001',
    symbol: 'AAPL.US',
    side: 'buy',
    order_type: 'limit',
    quantity: 100,
    price: 150.5,
    status: 'filled',
    trading_mode: 'paper',
    filled_quantity: 100,
    filled_price: 150.25,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeStopLossRecord(overrides: Partial<StopLossRecord> = {}): StopLossRecord {
  return {
    id: 1,
    order_id: 1,
    symbol: '0700.HK',
    side: 'buy',
    entry_price: 350,
    stop_loss: 330,
    take_profit: 400,
    status: 'active',
    created_at: Date.now(),
    ...overrides,
  };
}

function makeStopLossEvent(overrides: Partial<StopLossTriggerEvent> = {}): StopLossTriggerEvent {
  return {
    record: makeStopLossRecord(),
    trigger_type: 'stop_loss',
    current_price: 325,
    pnl_amount: -2500,
    ...overrides,
  };
}

function makeMockNotificationService() {
  return {
    sendSystemAlert: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─── formatOrderNotification ────────────────────────────────────────────────

describe('formatOrderNotification', () => {
  it('formats created notification with symbol, side, quantity, price, mode', () => {
    const order = makeOrder();
    const msg = formatOrderNotification(order, 'created');

    expect(msg).toContain('AAPL.US');
    expect(msg).toContain('buy');
    expect(msg).toContain('100');
    expect(msg).toContain('150.5');
    expect(msg).toContain('paper');
    expect(msg).toContain('订单创建');
  });

  it('formats filled notification with filled_price and filled_quantity', () => {
    const order = makeOrder();
    const msg = formatOrderNotification(order, 'filled');

    expect(msg).toContain('AAPL.US');
    expect(msg).toContain('buy');
    expect(msg).toContain('100');       // filled_quantity
    expect(msg).toContain('150.25');    // filled_price
    expect(msg).toContain('paper');
    expect(msg).toContain('成交');
  });

  it('formats failed notification with reject_reason', () => {
    const order = makeOrder({ status: 'rejected', reject_reason: 'risk limit exceeded' });
    const msg = formatOrderNotification(order, 'failed');

    expect(msg).toContain('AAPL.US');
    expect(msg).toContain('risk limit exceeded');
    expect(msg).toContain('失败');
  });

  it('shows "unknown" when reject_reason is missing on failed', () => {
    const order = makeOrder({ status: 'failed' });
    const msg = formatOrderNotification(order, 'failed');

    expect(msg).toContain('unknown');
  });

  it('shows "market" when price is undefined on created', () => {
    const order = makeOrder({ price: undefined });
    const msg = formatOrderNotification(order, 'created');

    expect(msg).toContain('market');
  });
});

// ─── formatStopLossNotification ─────────────────────────────────────────────

describe('formatStopLossNotification', () => {
  it('formats stop_loss trigger with correct fields', () => {
    const event = makeStopLossEvent();
    const msg = formatStopLossNotification(event);

    expect(msg).toContain('0700.HK');
    expect(msg).toContain('stop_loss');
    expect(msg).toContain('325');
    expect(msg).toContain('-2500.00');
    expect(msg).toContain('止损');
  });

  it('formats take_profit trigger with positive pnl', () => {
    const event = makeStopLossEvent({
      trigger_type: 'take_profit',
      current_price: 410,
      pnl_amount: 6000,
    });
    const msg = formatStopLossNotification(event);

    expect(msg).toContain('take_profit');
    expect(msg).toContain('410');
    expect(msg).toContain('+6000.00');
    expect(msg).toContain('止盈');
  });
});

// ─── formatRiskAlert ────────────────────────────────────────────────────────

describe('formatRiskAlert', () => {
  it('formats all violation rule_names and details', () => {
    const violations: RiskCheckResult['violations'] = [
      {
        rule_type: 'max_order_amount',
        rule_name: 'Max Order Amount',
        threshold: 50000,
        current_value: 75000,
        message: 'Order amount 75000 exceeds limit 50000',
      },
      {
        rule_type: 'max_daily_trades',
        rule_name: 'Max Daily Trades',
        threshold: 10,
        current_value: 12,
        message: 'Daily trades 12 exceeds limit 10',
      },
    ];

    const msg = formatRiskAlert(violations);

    expect(msg).toContain('Max Order Amount');
    expect(msg).toContain('Max Daily Trades');
    expect(msg).toContain('75000');
    expect(msg).toContain('50000');
    expect(msg).toContain('风控告警');
  });

  it('handles empty violations array', () => {
    const msg = formatRiskAlert([]);
    expect(msg).toContain('风控告警');
  });
});

// ─── TradeNotifier class ────────────────────────────────────────────────────

describe('TradeNotifier', () => {
  let mockNS: ReturnType<typeof makeMockNotificationService>;
  let notifier: TradeNotifier;

  beforeEach(() => {
    mockNS = makeMockNotificationService();
    notifier = new TradeNotifier(mockNS);
  });

  it('notifyOrderCreated calls sendSystemAlert', async () => {
    await notifier.notifyOrderCreated(makeOrder());
    expect(mockNS.sendSystemAlert).toHaveBeenCalledTimes(1);
    expect(mockNS.sendSystemAlert.mock.calls[0][0]).toContain('订单创建');
  });

  it('notifyOrderFilled calls sendSystemAlert', async () => {
    await notifier.notifyOrderFilled(makeOrder());
    expect(mockNS.sendSystemAlert).toHaveBeenCalledTimes(1);
    expect(mockNS.sendSystemAlert.mock.calls[0][0]).toContain('成交');
  });

  it('notifyOrderFailed calls sendSystemAlert', async () => {
    await notifier.notifyOrderFailed(makeOrder({ reject_reason: 'timeout' }));
    expect(mockNS.sendSystemAlert).toHaveBeenCalledTimes(1);
    expect(mockNS.sendSystemAlert.mock.calls[0][0]).toContain('失败');
  });

  it('notifyRiskRejected includes both order and risk info', async () => {
    const violations: RiskCheckResult['violations'] = [
      {
        rule_type: 'max_order_amount',
        rule_name: 'Max Order',
        threshold: 10000,
        current_value: 20000,
        message: 'Exceeded',
      },
    ];
    await notifier.notifyRiskRejected(makeOrder(), violations);
    expect(mockNS.sendSystemAlert).toHaveBeenCalledTimes(1);
    const msg = mockNS.sendSystemAlert.mock.calls[0][0];
    expect(msg).toContain('AAPL.US');
    expect(msg).toContain('Max Order');
    expect(msg).toContain('风控告警');
  });

  it('notifyStopLossTriggered calls sendSystemAlert', async () => {
    await notifier.notifyStopLossTriggered(makeStopLossEvent());
    expect(mockNS.sendSystemAlert).toHaveBeenCalledTimes(1);
    expect(mockNS.sendSystemAlert.mock.calls[0][0]).toContain('止损');
  });

  it('notifyUrgentAlert calls sendSystemAlert with urgent prefix', async () => {
    await notifier.notifyUrgentAlert('SL order rejected by risk');
    expect(mockNS.sendSystemAlert).toHaveBeenCalledTimes(1);
    const msg = mockNS.sendSystemAlert.mock.calls[0][0];
    expect(msg).toContain('紧急告警');
    expect(msg).toContain('SL order rejected by risk');
  });

  it('silently catches errors from sendSystemAlert', async () => {
    mockNS.sendSystemAlert.mockRejectedValue(new Error('network error'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await notifier.notifyOrderCreated(makeOrder());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('notifyOrderCreated failed'),
    );
    warnSpy.mockRestore();
  });
});
