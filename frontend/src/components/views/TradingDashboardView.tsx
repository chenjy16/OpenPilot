import { useState, useEffect } from 'react';
import {
  useTradingStore,
  type TradingOrder,
  type TradingConfig,
  type RiskRule,
  type OrderSide,
  type OrderType,
  type BrokerAccount,
  type BrokerCredentialsMasked,
  type OrderStats,
} from '../../stores/tradingStore';
import AutoTradingPanel from './AutoTradingPanel';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TradingModeSwitch({ config, onSwitch }: {
  config: TradingConfig | null;
  onSwitch: (mode: 'paper' | 'live') => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!config) return null;
  const isPaper = config.trading_mode === 'paper';

  const handleToggle = () => {
    if (isPaper) {
      setConfirming(true);
    } else {
      onSwitch('paper');
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold ${
          isPaper
            ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
            : 'bg-red-100 text-red-800 border border-red-300'
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${isPaper ? 'bg-yellow-500 animate-pulse' : 'bg-red-500 animate-pulse'}`} />
        {isPaper ? '模拟交易' : '实盘交易'}
      </div>
      <button
        onClick={handleToggle}
        className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        切换至{isPaper ? '实盘' : '模拟'}
      </button>
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-white p-6 shadow-xl max-w-sm">
            <p className="text-sm font-semibold text-red-700 mb-2">⚠️ 切换到实盘交易</p>
            <p className="text-sm text-gray-600 mb-4">
              实盘模式下所有订单将通过真实券商执行，涉及真实资金。请确认券商凭证已正确配置。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => { setConfirming(false); onSwitch('live'); }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BrokerSettingsPanel({ config, credentials, onSaveConfig, onSaveCredentials, onTestConnection }: {
  config: TradingConfig | null;
  credentials: BrokerCredentialsMasked | null;
  onSaveConfig: (updates: Partial<TradingConfig>) => Promise<void>;
  onSaveCredentials: (creds: { app_key?: string; app_secret?: string; access_token?: string; paper_access_token?: string }) => Promise<void>;
  onTestConnection: () => Promise<{ connected: boolean; error?: string }>;
}) {
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [paperAccessToken, setPaperAccessToken] = useState('');
  const [region, setRegion] = useState(config?.broker_region ?? 'hk');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; error?: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (config) setRegion(config.broker_region);
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    setTestResult(null);
    try {
      const creds: Record<string, string> = {};
      if (appKey.trim()) creds.app_key = appKey.trim();
      if (appSecret.trim()) creds.app_secret = appSecret.trim();
      if (accessToken.trim()) creds.access_token = accessToken.trim();
      if (paperAccessToken.trim()) creds.paper_access_token = paperAccessToken.trim();
      if (Object.keys(creds).length > 0) {
        await onSaveCredentials(creds);
      }
      if (region !== config?.broker_region) {
        await onSaveConfig({ broker_region: region });
      }
      setAppKey('');
      setAppSecret('');
      setAccessToken('');
      setPaperAccessToken('');
      setSaveMsg('保存成功');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ connected: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const isPaper = config?.trading_mode === 'paper';
  const allSet = credentials?.app_key_set && credentials?.app_secret_set
    && (isPaper ? credentials?.paper_access_token_set : credentials?.access_token_set);

  return (
    <div className="space-y-4">
      {/* Region selector */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">券商区域</label>
        <div className="flex gap-2">
          {[
            { value: 'hk', label: '🇭🇰 香港 (Longport HK)' },
            { value: 'sg', label: '🇸🇬 新加坡 (Longport SG)' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRegion(opt.value)}
              className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                region === opt.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Credential status */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-gray-500">凭证状态:</span>
        <span className={credentials?.app_key_set ? 'text-green-600' : 'text-gray-400'}>
          App Key {credentials?.app_key_set ? '✓' : '✗'}
        </span>
        <span className={credentials?.app_secret_set ? 'text-green-600' : 'text-gray-400'}>
          App Secret {credentials?.app_secret_set ? '✓' : '✗'}
        </span>
        <span className={credentials?.access_token_set ? 'text-green-600' : 'text-gray-400'}>
          实盘 Token {credentials?.access_token_set ? '✓' : '✗'}
        </span>
        <span className={credentials?.paper_access_token_set ? 'text-green-600' : 'text-gray-400'}>
          模拟 Token {credentials?.paper_access_token_set ? '✓' : '✗'}
        </span>
      </div>

      {/* Credential inputs */}
      <div className="grid gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">App Key</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.app_key_set ? '••••••••（已设置，留空保持不变）' : '输入 Longport App Key'}
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">App Secret</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.app_secret_set ? '••••••••（已设置，留空保持不变）' : '输入 Longport App Secret'}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">实盘 Access Token</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.access_token_set ? '••••••••（已设置，留空保持不变）' : '输入实盘 Access Token'}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">模拟账户 Access Token</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.paper_access_token_set ? '••••••••（已设置，留空保持不变）' : '输入模拟账户 Access Token'}
            value={paperAccessToken}
            onChange={(e) => setPaperAccessToken(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
        💡 长桥模拟账户和真实账户共享 App Key / App Secret，但使用不同的 Access Token。请在开发者中心分别获取。
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !allSet}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>
            {saveMsg}
          </span>
        )}
        {testResult && (
          <span className={`text-xs ${testResult.connected ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.connected ? '✓ 连接成功' : `✗ 连接失败${testResult.error ? `: ${testResult.error}` : ''}`}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-400">
        凭证从 <a href="https://open.longbridge.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">长桥 OpenAPI 开发者中心</a> 获取。凭证仅存储在本地数据库中。
        当前模式为{isPaper ? '模拟交易（使用模拟 Token）' : '实盘交易（使用实盘 Token）'}。
      </p>
    </div>
  );
}

function AccountOverview({ account, stats }: { account: BrokerAccount | null; stats: OrderStats | null }) {
  const cards = [
    { label: '总资产', value: account?.total_assets ?? 0, fmt: (v: number) => `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` },
    { label: '可用资金', value: account?.available_cash ?? 0, fmt: (v: number) => `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` },
    { label: '冻结资金', value: account?.frozen_cash ?? 0, fmt: (v: number) => `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` },
    { label: '当日交易笔数', value: stats?.total_orders ?? 0, fmt: (v: number) => String(v) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">{c.label}</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{c.fmt(c.value)}</p>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    submitted: 'bg-blue-100 text-blue-700',
    partial_filled: 'bg-indigo-100 text-indigo-700',
    filled: 'bg-green-100 text-green-700',
    cancelled: 'bg-yellow-100 text-yellow-700',
    rejected: 'bg-red-100 text-red-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

/** Classify order source based on signal_id / strategy_id (Property 12) */
function getOrderSourceLabel(order: TradingOrder): string {
  if (order.signal_id != null && order.strategy_id == null) return '信号自动';
  if (order.strategy_id != null) return '策略自动';
  return '手动';
}

function OrderSourceBadge({ order }: { order: TradingOrder }) {
  const label = getOrderSourceLabel(order);
  const colors: Record<string, string> = {
    '手动': 'bg-gray-100 text-gray-700',
    '信号自动': 'bg-blue-100 text-blue-700',
    '策略自动': 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[label] ?? 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

function ActiveOrdersTable({ orders, onCancel }: { orders: TradingOrder[]; onCancel: (id: number) => void }) {
  const active = orders.filter((o) => ['pending', 'submitted', 'partial_filled'].includes(o.status));
  if (active.length === 0) return <p className="py-4 text-center text-sm text-gray-400">暂无活跃订单</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500">
            <th className="pb-2 pr-4">代码</th><th className="pb-2 pr-4">方向</th>
            <th className="pb-2 pr-4">类型</th><th className="pb-2 pr-4">数量</th>
            <th className="pb-2 pr-4">价格</th><th className="pb-2 pr-4">来源</th>
            <th className="pb-2 pr-4">状态</th>
            <th className="pb-2 pr-4">时间</th><th className="pb-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {active.map((o) => (
            <tr key={o.id ?? o.local_order_id} className="border-b border-gray-100">
              <td className="py-2 pr-4 font-medium">{o.symbol}</td>
              <td className={`py-2 pr-4 ${o.side === 'buy' ? 'text-red-600' : 'text-green-600'}`}>
                {o.side === 'buy' ? '买入' : '卖出'}
              </td>
              <td className="py-2 pr-4">{o.order_type}</td>
              <td className="py-2 pr-4">{o.quantity}</td>
              <td className="py-2 pr-4">{o.price ?? '-'}</td>
              <td className="py-2 pr-4"><OrderSourceBadge order={o} /></td>
              <td className="py-2 pr-4"><StatusBadge status={o.status} /></td>
              <td className="py-2 pr-4 text-gray-500">{new Date(o.created_at * 1000).toLocaleTimeString()}</td>
              <td className="py-2">
                <button className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200" onClick={() => o.id && onCancel(o.id)}>撤单</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderHistoryTable({ orders }: { orders: TradingOrder[] }) {
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSymbol, setFilterSymbol] = useState('');
  const filtered = orders.filter((o) => {
    if (filterStatus && o.status !== filterStatus) return false;
    if (filterSymbol && !o.symbol.toLowerCase().includes(filterSymbol.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input className="rounded border border-gray-300 px-2 py-1 text-sm" placeholder="股票代码" value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)} />
        <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="filled">已成交</option>
          <option value="cancelled">已撤销</option>
          <option value="rejected">已拒绝</option>
          <option value="failed">失败</option>
          <option value="pending">待提交</option>
          <option value="submitted">已提交</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">暂无交易记录</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="whitespace-nowrap pb-2 pr-3">代码</th><th className="whitespace-nowrap pb-2 pr-3">方向</th>
                <th className="whitespace-nowrap pb-2 pr-3">类型</th><th className="whitespace-nowrap pb-2 pr-3">数量</th>
                <th className="whitespace-nowrap pb-2 pr-3">价格</th><th className="whitespace-nowrap pb-2 pr-3">成交量</th>
                <th className="whitespace-nowrap pb-2 pr-3">成交价</th><th className="whitespace-nowrap pb-2 pr-3">来源</th>
                <th className="whitespace-nowrap pb-2 pr-3">状态</th>
                <th className="whitespace-nowrap pb-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id ?? o.local_order_id} className="border-b border-gray-100">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">{o.symbol}</td>
                  <td className={`whitespace-nowrap py-2 pr-3 ${o.side === 'buy' ? 'text-red-600' : 'text-green-600'}`}>{o.side === 'buy' ? '买入' : '卖出'}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{o.order_type}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{o.quantity}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{o.price ?? '-'}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{o.filled_quantity}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{o.filled_price ?? '-'}</td>
                  <td className="whitespace-nowrap py-2 pr-3"><OrderSourceBadge order={o} /></td>
                  <td className="whitespace-nowrap py-2 pr-3"><StatusBadge status={o.status} /></td>
                  <td className="whitespace-nowrap py-2 text-gray-500">{new Date(o.created_at * 1000).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RiskStatusPanel({ rules, stats }: { rules: RiskRule[]; stats: OrderStats | null }) {
  if (rules.length === 0) return <p className="py-4 text-center text-sm text-gray-400">暂无风控规则</p>;
  const currentValues: Record<string, number> = {
    max_daily_amount: stats?.total_filled_amount ?? 0,
    max_daily_trades: stats?.total_orders ?? 0,
  };

  return (
    <div className="space-y-3">
      {rules.map((r) => {
        const current = currentValues[r.rule_type] ?? 0;
        const pct = r.threshold > 0 ? Math.min((current / r.threshold) * 100, 100) : 0;
        return (
          <div key={r.id ?? r.rule_type} className="rounded border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between text-sm">
              <span className={r.enabled ? 'text-gray-800' : 'text-gray-400 line-through'}>{r.rule_name}</span>
              <span className="text-xs text-gray-500">{current.toLocaleString()} / {r.threshold.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
              <div className={`h-1.5 rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ManualOrderForm({ onSubmit }: { onSubmit: (req: { symbol: string; side: OrderSide; order_type: OrderType; quantity: number; price?: number }) => Promise<unknown> }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const qty = Number(quantity);
    if (!symbol.trim()) { setFormError('请输入股票代码'); return; }
    if (!qty || qty <= 0) { setFormError('请输入有效数量'); return; }
    const prc = price ? Number(price) : undefined;
    if (orderType === 'limit' && (!prc || prc <= 0)) { setFormError('限价单需要有效价格'); return; }

    setSubmitting(true);
    try {
      await onSubmit({ symbol: symbol.trim(), side, order_type: orderType, quantity: qty, price: prc });
      setSymbol(''); setQuantity(''); setPrice('');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="股票代码 (如 700.HK)" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={side} onChange={(e) => setSide(e.target.value as OrderSide)}>
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </select>
        <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
          <option value="market">市价单</option>
          <option value="limit">限价单</option>
          <option value="stop">止损单</option>
          <option value="stop_limit">止损限价单</option>
        </select>
        <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="数量" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        {orderType !== 'market' && (
          <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="价格" type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        )}
      </div>
      {formError && <p className="text-xs text-red-600">{formError}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {submitting ? '提交中...' : '下单'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const TradingDashboardView: React.FC = () => {
  const {
    account, orders, riskRules, stats, config, credentials,
    loading, error,
    fetchAll, placeOrder, cancelOrder, updateConfig, saveCredentials, testBrokerConnection,
    startPolling, stopPolling,
    fetchStopLossRecords,
  } = useTradingStore();

  const [showSettings, setShowSettings] = useState(false);
  const [switchError, setSwitchError] = useState('');

  useEffect(() => {
    fetchAll();
    startPolling();
    // Poll stop-loss records every 3 seconds for timely updates (Req 8.4)
    const slTimer = setInterval(() => {
      fetchStopLossRecords().catch(() => {});
    }, 3000);
    return () => {
      stopPolling();
      clearInterval(slTimer);
    };
  }, [fetchAll, startPolling, stopPolling, fetchStopLossRecords]);

  const handleModeSwitch = async (mode: 'paper' | 'live') => {
    setSwitchError('');
    try {
      await updateConfig({ trading_mode: mode });
    } catch (err) {
      setSwitchError((err as Error).message);
    }
  };

  if (loading && !account) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-gray-500">加载中...</p></div>;
  }

  if (error && !account) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-red-500">加载失败: {error}</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">量化交易</h1>
          <div className="flex items-center gap-3">
            <TradingModeSwitch config={config} onSwitch={handleModeSwitch} />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                showSettings ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              ⚙️ 券商设置
            </button>
          </div>
        </div>

        {switchError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{switchError}</div>
        )}

        {/* Broker Settings Panel (collapsible) */}
        {showSettings && (
          <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">券商配置 — Longport</h2>
            <BrokerSettingsPanel
              config={config}
              credentials={credentials}
              onSaveConfig={updateConfig}
              onSaveCredentials={saveCredentials}
              onTestConnection={testBrokerConnection}
            />
          </section>
        )}

        {/* Account Overview */}
        <AccountOverview account={account} stats={stats} />

        {/* Auto Trading Panel */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <AutoTradingPanel />
        </section>

        {/* Active Orders */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">活跃订单</h2>
          <ActiveOrdersTable orders={orders} onCancel={cancelOrder} />
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-3">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">交易记录</h2>
            <OrderHistoryTable orders={orders} />
          </section>
          <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">风控状态</h2>
            <RiskStatusPanel rules={riskRules} stats={stats} />
          </section>
        </div>

        {/* Manual Order Form */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">手动下单</h2>
          <ManualOrderForm onSubmit={placeOrder} />
        </section>
      </div>
    </div>
  );
};

export default TradingDashboardView;
