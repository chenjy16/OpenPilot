import { useState, useEffect, useCallback } from 'react';
import {
  useTradingStore,
  type ProcessResult,
  type StopLossRecord,
  type TradingConfig,
} from '../../stores/tradingStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map ProcessResult reason to Chinese display text */
function reasonLabel(r: ProcessResult): string {
  if (r.action === 'order_created') return '已下单';
  switch (r.reason) {
    case 'confidence_below_threshold': return '置信度不足跳过';
    case 'duplicate_signal': return '去重跳过';
    case 'skipped_risk':
    case 'risk_rejected': return '风控拒绝';
    case 'skipped_quantity':
    case 'quantity_insufficient': return '数量不足跳过';
    case 'action_hold': return 'Hold 信号跳过';
    case 'skipped_disabled': return '自动交易未启用';
    case 'missing_price': return '缺少价格跳过';
    default: return r.reason ?? '跳过';
  }
}

function reasonBadgeColor(r: ProcessResult): string {
  if (r.action === 'order_created') return 'bg-green-100 text-green-700';
  switch (r.reason) {
    case 'confidence_below_threshold': return 'bg-yellow-100 text-yellow-700';
    case 'duplicate_signal': return 'bg-gray-100 text-gray-700';
    case 'skipped_risk':
    case 'risk_rejected': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

type QuantityMode = 'fixed_quantity' | 'fixed_amount' | 'kelly_formula';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Summary stats cards */
function SummaryStats({
  signals,
  stopLossRecords,
}: {
  signals: ProcessResult[];
  stopLossRecords: StopLossRecord[];
}) {
  const safeSignals = signals ?? [];
  const safeRecords = stopLossRecords ?? [];
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const todayOrders = safeSignals.filter(
    (s) => s.action === 'order_created',
  ).length;

  const todaySignals = safeSignals.length;

  const tpTriggers = safeRecords.filter(
    (r) => r.status === 'triggered_tp' && r.triggered_at && r.triggered_at >= todayStart,
  ).length;

  const slTriggers = safeRecords.filter(
    (r) => r.status === 'triggered_sl' && r.triggered_at && r.triggered_at >= todayStart,
  ).length;

  const cards = [
    { label: '今日自动下单', value: todayOrders, color: 'text-blue-600' },
    { label: '止盈触发', value: tpTriggers, color: 'text-green-600' },
    { label: '止损触发', value: slTriggers, color: 'text-red-600' },
    { label: '信号处理数', value: todaySignals, color: 'text-gray-800' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">{c.label}</p>
          <p className={`mt-1 text-lg font-semibold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Pipeline enable/disable toggle */
function PipelineToggle({
  config,
  onToggle,
}: {
  config: TradingConfig | null;
  onToggle: () => void;
}) {
  const enabled = config?.auto_trade_enabled ?? false;
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          enabled ? 'bg-green-500' : 'bg-gray-300'
        }`}
        role="switch"
        aria-checked={enabled}
        aria-label="自动交易开关"
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <span className={`text-sm font-medium ${enabled ? 'text-green-700' : 'text-gray-500'}`}>
        {enabled ? '流水线已启用' : '流水线已停用'}
      </span>
    </div>
  );
}

/** Config editing section */
function ConfigEditor({
  config,
  onSave,
}: {
  config: TradingConfig | null;
  onSave: (updates: Partial<TradingConfig>) => Promise<void>;
}) {
  const [confidenceThreshold, setConfidenceThreshold] = useState(config?.confidence_threshold ?? 0.6);
  const [dedupWindowHours, setDedupWindowHours] = useState(config?.dedup_window_hours ?? 24);
  const [quantityMode, setQuantityMode] = useState<QuantityMode>(config?.quantity_mode ?? 'fixed_quantity');
  const [fixedQuantityValue, setFixedQuantityValue] = useState(config?.quantity_params?.fixed_quantity_value ?? 100);
  const [fixedAmountValue, setFixedAmountValue] = useState(config?.quantity_params?.fixed_amount_value ?? 10000);
  const [slTpEnabled, setSlTpEnabled] = useState(config?.sl_tp_enabled ?? true);
  const [slTpCheckInterval, setSlTpCheckInterval] = useState(config?.sl_tp_check_interval ?? 30000);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (!config) return;
    setConfidenceThreshold(config.confidence_threshold ?? 0.6);
    setDedupWindowHours(config.dedup_window_hours ?? 24);
    setQuantityMode((config.quantity_mode ?? 'fixed_quantity') as QuantityMode);
    setFixedQuantityValue(config.quantity_params?.fixed_quantity_value ?? 100);
    setFixedAmountValue(config.quantity_params?.fixed_amount_value ?? 10000);
    setSlTpEnabled(config.sl_tp_enabled ?? true);
    setSlTpCheckInterval(config.sl_tp_check_interval ?? 30000);
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await onSave({
        confidence_threshold: confidenceThreshold,
        dedup_window_hours: dedupWindowHours,
        quantity_mode: quantityMode,
        quantity_params: {
          fixed_quantity_value: fixedQuantityValue,
          fixed_amount_value: fixedAmountValue,
        },
        sl_tp_enabled: slTpEnabled,
        sl_tp_check_interval: slTpCheckInterval,
      });
      setSaveMsg('保存成功');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Confidence threshold */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            置信度阈值: {confidenceThreshold.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            <span>0</span><span>0.5</span><span>1</span>
          </div>
        </div>

        {/* Dedup window */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">去重窗口（小时）</label>
          <input
            type="number"
            min="1"
            value={dedupWindowHours}
            onChange={(e) => setDedupWindowHours(Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {/* Quantity mode */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">数量计算模式</label>
          <select
            value={quantityMode}
            onChange={(e) => setQuantityMode(e.target.value as QuantityMode)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="fixed_quantity">固定数量</option>
            <option value="fixed_amount">固定金额</option>
            <option value="kelly_formula">Kelly 公式</option>
          </select>
        </div>

        {/* Quantity params based on mode */}
        {quantityMode === 'fixed_quantity' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">固定数量（股）</label>
            <input
              type="number"
              min="1"
              value={fixedQuantityValue}
              onChange={(e) => setFixedQuantityValue(Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}
        {quantityMode === 'fixed_amount' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">固定金额</label>
            <input
              type="number"
              min="1"
              value={fixedAmountValue}
              onChange={(e) => setFixedAmountValue(Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        {/* SL/TP enabled */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSlTpEnabled(!slTpEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              slTpEnabled ? 'bg-green-500' : 'bg-gray-300'
            }`}
            role="switch"
            aria-checked={slTpEnabled}
            aria-label="止盈止损开关"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                slTpEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-xs text-gray-500">止盈止损 {slTpEnabled ? '已启用' : '已停用'}</span>
        </div>

        {/* SL/TP check interval */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">止盈止损检查间隔（毫秒）</label>
          <input
            type="number"
            min="1000"
            step="1000"
            value={slTpCheckInterval}
            onChange={(e) => setSlTpCheckInterval(Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}

/** Recent signals list */
function RecentSignalsList({ signals }: { signals: ProcessResult[] }) {
  const recent = (signals ?? []).slice(0, 10);
  if (recent.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400">暂无信号处理记录</p>;
  }
  return (
    <div className="space-y-2">
      {recent.map((s, i) => (
        <div
          key={`${s.signal_id}-${i}`}
          className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-3 py-2"
        >
          <div className="text-sm">
            <span className="font-medium text-gray-800">信号 #{s.signal_id}</span>
            {s.order_id != null && (
              <span className="ml-2 text-xs text-gray-500">订单 #{s.order_id}</span>
            )}
          </div>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${reasonBadgeColor(s)}`}
          >
            {reasonLabel(s)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Active stop-loss monitoring list */
function ActiveStopLossList({ records }: { records: StopLossRecord[] }) {
  const active = (records ?? []).filter((r) => r.status === 'active');
  if (active.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400">暂无活跃止盈止损监控</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500">
            <th className="whitespace-nowrap pb-2 pr-3">代码</th>
            <th className="whitespace-nowrap pb-2 pr-3">入场价</th>
            <th className="whitespace-nowrap pb-2 pr-3">止损价</th>
            <th className="whitespace-nowrap pb-2 pr-3">止盈价</th>
            <th className="whitespace-nowrap pb-2 pr-3">移动止损</th>
            <th className="whitespace-nowrap pb-2">状态</th>
          </tr>
        </thead>
        <tbody>
          {active.map((r) => (
            <tr key={r.id ?? r.order_id} className="border-b border-gray-100">
              <td className="whitespace-nowrap py-2 pr-3 font-medium">{r.symbol}</td>
              <td className="whitespace-nowrap py-2 pr-3">{r.entry_price.toFixed(2)}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-red-600">{r.stop_loss.toFixed(2)}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-green-600">{r.take_profit.toFixed(2)}</td>
              <td className="whitespace-nowrap py-2 pr-3">
                {r.trailing_percent ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-700">{r.trailing_percent}%</span>
                    {r.highest_price && <span className="text-gray-400">峰值 {r.highest_price.toFixed(2)}</span>}
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="whitespace-nowrap py-2">
                <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                  监控中
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const AutoTradingPanel: React.FC = () => {
  const {
    config,
    pipelineSignals,
    stopLossRecords,
    pipelineStatus,
    fetchConfig,
    fetchPipelineStatus,
    fetchStopLossRecords,
    fetchPipelineSignals,
    updateConfig,
  } = useTradingStore();

  const [showConfig, setShowConfig] = useState(false);

  const refresh = useCallback(async () => {
    await Promise.all([
      fetchConfig(),
      fetchPipelineStatus(),
      fetchStopLossRecords(),
      fetchPipelineSignals(),
    ]);
  }, [fetchConfig, fetchPipelineStatus, fetchStopLossRecords, fetchPipelineSignals]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleTogglePipeline = async () => {
    await updateConfig({ auto_trade_enabled: !(config?.auto_trade_enabled ?? false) });
  };

  return (
    <div className="space-y-6">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">自动交易</h2>
        <div className="flex items-center gap-3">
          <PipelineToggle config={config} onToggle={handleTogglePipeline} />
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              showConfig
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            ⚙️ 配置
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <SummaryStats signals={pipelineSignals} stopLossRecords={stopLossRecords} />

      {/* Config editor (collapsible) */}
      {showConfig && (
        <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">自动交易配置</h3>
          <ConfigEditor config={config} onSave={updateConfig} />
        </section>
      )}

      {/* Recent signals */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">最近信号处理</h3>
        <RecentSignalsList signals={pipelineSignals} />
      </section>

      {/* Active stop-loss monitoring */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          活跃止盈止损监控
          {pipelineStatus && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              ({pipelineStatus.active_stop_loss_count} 条)
            </span>
          )}
        </h3>
        <ActiveStopLossList records={stopLossRecords} />
      </section>
    </div>
  );
};

export default AutoTradingPanel;
