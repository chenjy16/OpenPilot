import type Database from 'better-sqlite3';
import type { TradingGateway } from './TradingGateway';
import type { TradeNotifier } from './TradeNotifier';
import type { StopLossRecord, StopLossTriggerEvent } from './types';

// ─── Pure Function ──────────────────────────────────────────────────────────

/**
 * 纯函数：判断是否触发止盈止损
 * currentPrice <= stopLoss → 'stop_loss'
 * currentPrice >= takeProfit → 'take_profit'
 * otherwise → null
 */
export function checkStopLossTrigger(
  currentPrice: number,
  stopLoss: number,
  takeProfit: number,
): 'stop_loss' | 'take_profit' | null {
  if (currentPrice <= stopLoss) return 'stop_loss';
  if (currentPrice >= takeProfit) return 'take_profit';
  return null;
}

// ─── StopLossManager Class ──────────────────────────────────────────────────

export class StopLossManager {
  private db: Database.Database;
  private tradingGateway: TradingGateway;
  private tradeNotifier: TradeNotifier;
  private activeRecords: Map<number, StopLossRecord> = new Map();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: Database.Database,
    tradingGateway: TradingGateway,
    tradeNotifier: TradeNotifier,
  ) {
    this.db = db;
    this.tradingGateway = tradingGateway;
    this.tradeNotifier = tradeNotifier;
  }

  /** 注册止盈止损监控，写入 stop_loss_records 表 */
  register(record: Omit<StopLossRecord, 'id' | 'status' | 'created_at'>): StopLossRecord {
    const now = Math.floor(Date.now() / 1000);
    const hasTrailing = (record.trailing_percent && record.trailing_percent > 0)
      || (record.trailing_atr_multiplier && record.trailing_atr_multiplier > 0 && record.atr_value && record.atr_value > 0);
    const result = this.db.prepare(`
      INSERT INTO stop_loss_records (order_id, symbol, side, entry_price, stop_loss, take_profit, trailing_percent, trailing_atr_multiplier, atr_value, highest_price, status, created_at)
      VALUES (@order_id, @symbol, @side, @entry_price, @stop_loss, @take_profit, @trailing_percent, @trailing_atr_multiplier, @atr_value, @highest_price, 'active', @created_at)
    `).run({
      order_id: record.order_id,
      symbol: record.symbol,
      side: record.side,
      entry_price: record.entry_price,
      stop_loss: record.stop_loss,
      take_profit: record.take_profit,
      trailing_percent: record.trailing_percent ?? null,
      trailing_atr_multiplier: record.trailing_atr_multiplier ?? null,
      atr_value: record.atr_value ?? null,
      highest_price: hasTrailing ? record.entry_price : null,
      created_at: now,
    });

    const saved: StopLossRecord = {
      id: Number(result.lastInsertRowid),
      ...record,
      highest_price: hasTrailing ? record.entry_price : undefined,
      status: 'active',
      created_at: now,
    };

    this.activeRecords.set(saved.id!, saved);

    // Notify listener (e.g. QuoteService) to subscribe to this symbol
    if (this.onNewSymbol) {
      try { this.onNewSymbol(record.symbol); } catch { /* non-fatal */ }
    }

    return saved;
  }

  /** Price provider callback — set by QuoteService integration */
  private priceProvider: ((symbol: string) => Promise<number>) | null = null;

  /** Callback invoked when a new symbol is registered for stop-loss monitoring */
  private onNewSymbol: ((symbol: string) => void) | null = null;

  /** Set the price provider (called from index.ts after QuoteService is ready) */
  setPriceProvider(provider: (symbol: string) => Promise<number>): void {
    this.priceProvider = provider;
  }

  /** Set callback for when a new symbol is registered (used to subscribe to QuoteService) */
  setOnNewSymbol(callback: (symbol: string) => void): void {
    this.onNewSymbol = callback;
  }

  /** 启动定时检查，默认 30 秒间隔 */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => {
      if (this.priceProvider && this.activeRecords.size > 0) {
        this.checkAll(this.priceProvider).catch(err => {
          console.error(`[StopLossManager] checkAll error: ${err.message}`);
        });
      }
    }, intervalMs);
  }

  /** 停止定时检查 */
  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /** 检查所有活跃记录，触发止盈止损时生成市价卖出订单 */
  async checkAll(
    getCurrentPrice: (symbol: string) => Promise<number>,
  ): Promise<StopLossTriggerEvent[]> {
    const events: StopLossTriggerEvent[] = [];
    const records = Array.from(this.activeRecords.values());

    for (const record of records) {
      let currentPrice: number;
      try {
        currentPrice = await getCurrentPrice(record.symbol);
      } catch {
        // 获取价格失败，跳过本轮，下轮重试
        continue;
      }

      // Trailing stop: percentage-based or ATR-based (Chandelier Exit)
      const hasPercentTrailing = record.trailing_percent && record.trailing_percent > 0;
      const hasAtrTrailing = record.trailing_atr_multiplier && record.trailing_atr_multiplier > 0 && record.atr_value && record.atr_value > 0;

      if (hasPercentTrailing || hasAtrTrailing) {
        const prevHighest = record.highest_price ?? record.entry_price;
        if (currentPrice > prevHighest) {
          record.highest_price = currentPrice;

          let newStopLoss: number;
          if (hasAtrTrailing) {
            // Chandelier Exit: highest_price - multiplier × ATR
            newStopLoss = currentPrice - (record.trailing_atr_multiplier! * record.atr_value!);
          } else {
            // Percentage-based trailing
            newStopLoss = currentPrice * (1 - record.trailing_percent! / 100);
          }

          // Only raise stop_loss, never lower it
          if (newStopLoss > record.stop_loss) {
            record.stop_loss = Math.round(newStopLoss * 100) / 100;
          }
          // Persist trailing updates to DB
          this.db.prepare(`
            UPDATE stop_loss_records SET highest_price = @highest_price, stop_loss = @stop_loss WHERE id = @id
          `).run({ highest_price: record.highest_price, stop_loss: record.stop_loss, id: record.id });
        }
      }

      const triggerType = checkStopLossTrigger(currentPrice, record.stop_loss, record.take_profit);
      if (!triggerType) continue;

      // Estimate quantity from the original order
      const originalOrder = this.tradingGateway.getOrder(record.order_id);
      const quantity = originalOrder?.filled_quantity || originalOrder?.quantity || 1;
      // PnL direction depends on position side: long (buy) = current - entry, short (sell) = entry - current
      const pnlAmount = record.side === 'sell'
        ? (record.entry_price - currentPrice) * quantity
        : (currentPrice - record.entry_price) * quantity;

      const event: StopLossTriggerEvent = {
        record,
        trigger_type: triggerType,
        current_price: currentPrice,
        pnl_amount: pnlAmount,
      };

      try {
        // 1. Generate market sell order
        const sellOrder = await this.tradingGateway.placeOrder({
          symbol: record.symbol,
          side: 'sell',
          order_type: 'market',
          quantity,
        });

        // Check if order was rejected by risk control
        if (sellOrder.status === 'failed' || sellOrder.status === 'rejected') {
          const reason = sellOrder.reject_reason || 'Order rejected';
          await this.tradeNotifier.notifyUrgentAlert(
            `止盈止损订单被拒绝: ${record.symbol} ${triggerType} @ ${currentPrice}, reason: ${reason}`,
          );
          // Keep record active for retry
          continue;
        }

        // 2. Update record status in DB
        const newStatus = triggerType === 'stop_loss' ? 'triggered_sl' : 'triggered_tp';
        const now = Math.floor(Date.now() / 1000);
        this.db.prepare(`
          UPDATE stop_loss_records
          SET status = @status, triggered_at = @triggered_at, triggered_price = @triggered_price
          WHERE id = @id
        `).run({
          status: newStatus,
          triggered_at: now,
          triggered_price: currentPrice,
          id: record.id,
        });

        // 3. Remove from active records in memory
        this.activeRecords.delete(record.id!);

        // 4. Log to trading_audit_log
        const operation = triggerType === 'stop_loss' ? 'stop_loss_triggered' : 'take_profit_triggered';
        this.logAudit(operation, sellOrder.id, {
          record_id: record.id,
          symbol: record.symbol,
          entry_price: record.entry_price,
          trigger_price: currentPrice,
          pnl_amount: pnlAmount,
        });

        // 5. Notify via TradeNotifier
        await this.tradeNotifier.notifyStopLossTriggered(event);

        events.push(event);
      } catch (err: any) {
        // placeOrder threw — send urgent alert, keep record active for retry
        await this.tradeNotifier.notifyUrgentAlert(
          `止盈止损订单执行失败: ${record.symbol} ${triggerType} @ ${currentPrice}, error: ${err.message}`,
        );
      }
    }

    return events;
  }

  /** 从数据库加载 status='active' 的记录恢复监控 */
  restoreFromDb(): StopLossRecord[] {
    const rows = this.db.prepare(`
      SELECT id, order_id, symbol, side, entry_price, stop_loss, take_profit,
             trailing_percent, trailing_atr_multiplier, atr_value, highest_price,
             status, triggered_at, triggered_price, created_at
      FROM stop_loss_records
      WHERE status = 'active'
    `).all() as StopLossRecord[];

    this.activeRecords.clear();
    for (const row of rows) {
      this.activeRecords.set(row.id!, row);
    }

    return rows;
  }

  /** 返回内存中活跃记录列表 */
  getActiveRecords(): StopLossRecord[] {
    return Array.from(this.activeRecords.values());
  }

  /** 取消监控，更新记录状态为 cancelled */
  cancel(recordId: number): void {
    this.db.prepare(`
      UPDATE stop_loss_records SET status = 'cancelled' WHERE id = @id AND status = 'active'
    `).run({ id: recordId });

    this.activeRecords.delete(recordId);
  }

  /**
   * 收紧所有活跃止损记录的止损位 (用于 VIX 飙升等紧急风控场景)。
   * 对 ATR 模式: 将 multiplier 缩小到 newMultiplier (如从 2.0 → 1.0)
   * 对百分比模式: 将 trailing_percent 缩小到 newPercent
   * 止损位只升不降。
   */
  tightenAllStops(newAtrMultiplier?: number, newPercent?: number): number {
    let tightened = 0;
    for (const record of this.activeRecords.values()) {
      const highest = record.highest_price ?? record.entry_price;
      let newStopLoss: number | null = null;

      if (newAtrMultiplier != null && record.trailing_atr_multiplier && record.atr_value) {
        // Tighten ATR-based trailing
        record.trailing_atr_multiplier = Math.min(record.trailing_atr_multiplier, newAtrMultiplier);
        newStopLoss = highest - (record.trailing_atr_multiplier * record.atr_value);
      } else if (newPercent != null && record.trailing_percent) {
        record.trailing_percent = Math.min(record.trailing_percent, newPercent);
        newStopLoss = highest * (1 - record.trailing_percent / 100);
      }

      if (newStopLoss != null && newStopLoss > record.stop_loss) {
        record.stop_loss = Math.round(newStopLoss * 100) / 100;
        this.db.prepare(`
          UPDATE stop_loss_records SET stop_loss = @sl, trailing_atr_multiplier = @tam, trailing_percent = @tp WHERE id = @id
        `).run({
          sl: record.stop_loss,
          tam: record.trailing_atr_multiplier ?? null,
          tp: record.trailing_percent ?? null,
          id: record.id,
        });
        tightened++;
      }
    }
    return tightened;
  }

  /** 写入审计日志 */
  private logAudit(operation: string, orderId?: number, details?: any): void {
    this.db.prepare(`
      INSERT INTO trading_audit_log (timestamp, operation, order_id, request_params, response_result)
      VALUES (@timestamp, @operation, @order_id, @request_params, NULL)
    `).run({
      timestamp: Math.floor(Date.now() / 1000),
      operation,
      order_id: orderId ?? null,
      request_params: details ? JSON.stringify(details) : null,
    });
  }
}
