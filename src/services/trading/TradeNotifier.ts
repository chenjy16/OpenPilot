import type { NotificationService } from '../NotificationService';
import type { TradingOrder, RiskCheckResult, StopLossTriggerEvent } from './types';

// ─── Pure Functions: Format Notification Messages ───────────────────────────

/**
 * 纯函数：格式化订单通知消息
 * 根据 type ('created'/'filled'/'failed') 格式化，包含 symbol、side、quantity、price/reject_reason、trading_mode
 */
export function formatOrderNotification(
  order: TradingOrder,
  type: 'created' | 'filled' | 'failed',
): string {
  const lines: string[] = [];

  switch (type) {
    case 'created':
      lines.push('📋 订单创建通知');
      lines.push('');
      lines.push(`📌 Symbol: ${order.symbol}`);
      lines.push(`📊 Side: ${order.side}`);
      lines.push(`📦 Quantity: ${order.quantity}`);
      lines.push(`💰 Price: ${order.price ?? 'market'}`);
      lines.push(`🏷️ Mode: ${order.trading_mode}`);
      break;

    case 'filled':
      lines.push('✅ 订单成交通知');
      lines.push('');
      lines.push(`📌 Symbol: ${order.symbol}`);
      lines.push(`📊 Side: ${order.side}`);
      lines.push(`📦 Quantity: ${order.filled_quantity}`);
      lines.push(`💰 Filled Price: ${order.filled_price ?? 'N/A'}`);
      lines.push(`🏷️ Mode: ${order.trading_mode}`);
      break;

    case 'failed':
      lines.push('❌ 订单失败通知');
      lines.push('');
      lines.push(`📌 Symbol: ${order.symbol}`);
      lines.push(`📊 Side: ${order.side}`);
      lines.push(`📦 Quantity: ${order.quantity}`);
      lines.push(`⚠️ Reason: ${order.reject_reason ?? 'unknown'}`);
      lines.push(`🏷️ Mode: ${order.trading_mode}`);
      break;
  }

  return lines.join('\n');
}


/**
 * 纯函数：格式化止盈止损通知
 * 包含 trigger_type、symbol、triggered_price、pnl_amount
 */
export function formatStopLossNotification(event: StopLossTriggerEvent): string {
  const emoji = event.trigger_type === 'take_profit' ? '🎯' : '🛑';
  const label = event.trigger_type === 'take_profit' ? '止盈触发' : '止损触发';
  const pnlSign = event.pnl_amount >= 0 ? '+' : '';

  const lines: string[] = [
    `${emoji} ${label}通知`,
    '',
    `📌 Symbol: ${event.record.symbol}`,
    `🔔 Trigger: ${event.trigger_type}`,
    `💲 Triggered Price: ${event.current_price}`,
    `💰 P&L: ${pnlSign}${event.pnl_amount.toFixed(2)}`,
  ];

  return lines.join('\n');
}

/**
 * 纯函数：格式化风控告警
 * 包含所有违规规则的 rule_name 和详情
 */
export function formatRiskAlert(violations: RiskCheckResult['violations']): string {
  const lines: string[] = [
    '🚨 风控告警',
    '',
  ];

  for (const v of violations) {
    lines.push(`⛔ ${v.rule_name}: ${v.message}`);
    lines.push(`   Threshold: ${v.threshold}, Current: ${v.current_value}`);
  }

  return lines.join('\n');
}

// ─── TradeNotifier Class ────────────────────────────────────────────────────

/**
 * 交易通知器，复用现有 NotificationService 推送交易状态变更。
 * 所有通知方法捕获错误并静默记录警告，不影响交易流程。
 */
export class TradeNotifier {
  private notificationService: NotificationService;
  private onEvent?: (event: { type: string; data: any }) => void;

  constructor(notificationService: NotificationService) {
    this.notificationService = notificationService;
  }

  /** Set a callback for real-time WebSocket push of trading events. */
  setOnEvent(cb: (event: { type: string; data: any }) => void): void {
    this.onEvent = cb;
  }

  private emitEvent(type: string, data: any): void {
    if (this.onEvent) {
      try { this.onEvent({ type, data }); } catch { /* ignore */ }
    }
  }

  /** 订单创建通知 */
  async notifyOrderCreated(order: TradingOrder): Promise<void> {
    this.emitEvent('order_created', { id: order.id, symbol: order.symbol, side: order.side, quantity: order.quantity, price: order.price, mode: order.trading_mode });
    try {
      const message = formatOrderNotification(order, 'created');
      await this.notificationService.sendSystemAlert(message);
    } catch (err: any) {
      console.warn(`[TradeNotifier] notifyOrderCreated failed: ${err.message}`);
    }
  }

  /** 订单成交通知 */
  async notifyOrderFilled(order: TradingOrder): Promise<void> {
    this.emitEvent('order_filled', { id: order.id, symbol: order.symbol, side: order.side, filled_quantity: order.filled_quantity, filled_price: order.filled_price, mode: order.trading_mode });
    try {
      const message = formatOrderNotification(order, 'filled');
      await this.notificationService.sendSystemAlert(message);
    } catch (err: any) {
      console.warn(`[TradeNotifier] notifyOrderFilled failed: ${err.message}`);
    }
  }

  /** 订单失败/拒绝通知 */
  async notifyOrderFailed(order: TradingOrder): Promise<void> {
    this.emitEvent('order_failed', { id: order.id, symbol: order.symbol, side: order.side, reason: order.reject_reason, mode: order.trading_mode });
    try {
      const message = formatOrderNotification(order, 'failed');
      await this.notificationService.sendSystemAlert(message);
    } catch (err: any) {
      console.warn(`[TradeNotifier] notifyOrderFailed failed: ${err.message}`);
    }
  }

  /** 风控拒绝通知 */
  async notifyRiskRejected(
    order: TradingOrder,
    violations: RiskCheckResult['violations'],
  ): Promise<void> {
    try {
      const orderMsg = formatOrderNotification(order, 'failed');
      const riskMsg = formatRiskAlert(violations);
      const message = `${orderMsg}\n\n${riskMsg}`;
      await this.notificationService.sendSystemAlert(message);
    } catch (err: any) {
      console.warn(`[TradeNotifier] notifyRiskRejected failed: ${err.message}`);
    }
  }

  /** 止盈止损触发通知 */
  async notifyStopLossTriggered(event: StopLossTriggerEvent): Promise<void> {
    this.emitEvent('stop_loss_triggered', { symbol: event.record.symbol, trigger_type: event.trigger_type, price: event.current_price, pnl: event.pnl_amount });
    try {
      const message = formatStopLossNotification(event);
      await this.notificationService.sendSystemAlert(message);
    } catch (err: any) {
      console.warn(`[TradeNotifier] notifyStopLossTriggered failed: ${err.message}`);
    }
  }

  /** 紧急告警（止盈止损订单被风控拒绝） */
  async notifyUrgentAlert(message: string): Promise<void> {
    try {
      const alertMsg = `🚨🚨 紧急告警\n\n${message}`;
      await this.notificationService.sendSystemAlert(alertMsg);
    } catch (err: any) {
      console.warn(`[TradeNotifier] notifyUrgentAlert failed: ${err.message}`);
    }
  }
}
