import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useTradingStore,
  type TradingOrder,
  type TradingConfig,
  type RiskRule,
  type OrderSide,
  type OrderType,
  type BrokerPosition,
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
  const { t } = useTranslation();
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
        {isPaper ? t('trading.paperTrading') : t('trading.liveTrading')}
      </div>
      <button
        onClick={handleToggle}
        className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        {t('trading.switchTo', { mode: isPaper ? t('trading.liveTrading') : t('trading.paperTrading') })}
      </button>
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-white p-6 shadow-xl max-w-sm">
            <p className="text-sm font-semibold text-red-700 mb-2">{t('trading.switchToLive')}</p>
            <p className="text-sm text-gray-600 mb-4">
              {t('trading.switchToLiveWarning')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { setConfirming(false); onSwitch('live'); }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                {t('trading.confirmSwitch')}
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
  const { t } = useTranslation();
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
      setSaveMsg(t('common.saveSuccess'));
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg(`${t('common.saveFailed')}: ${(err as Error).message}`);
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
        <label className="block text-xs text-gray-500 mb-1">{t('trading.brokerRegion')}</label>
        <div className="flex gap-2">
          {[
            { value: 'hk', labelKey: 'trading.brokerRegionHk' },
            { value: 'sg', labelKey: 'trading.brokerRegionSg' },
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
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Credential status */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-gray-500">{t('trading.credentialStatus')}:</span>
        <span className={credentials?.app_key_set ? 'text-green-600' : 'text-gray-400'}>
          App Key {credentials?.app_key_set ? '✓' : '✗'}
        </span>
        <span className={credentials?.app_secret_set ? 'text-green-600' : 'text-gray-400'}>
          App Secret {credentials?.app_secret_set ? '✓' : '✗'}
        </span>
        <span className={credentials?.access_token_set ? 'text-green-600' : 'text-gray-400'}>
          {t('trading.liveToken')} {credentials?.access_token_set ? '✓' : '✗'}
        </span>
        <span className={credentials?.paper_access_token_set ? 'text-green-600' : 'text-gray-400'}>
          {t('trading.paperToken')} {credentials?.paper_access_token_set ? '✓' : '✗'}
        </span>
      </div>

      {/* Credential inputs */}
      <div className="grid gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">App Key</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.app_key_set ? t('trading.appKeySet') : t('trading.appKeyPlaceholder')}
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">App Secret</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.app_secret_set ? t('trading.appKeySet') : t('trading.appSecretPlaceholder')}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('trading.liveToken')}</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.access_token_set ? t('trading.appKeySet') : t('trading.liveAccessTokenPlaceholder')}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('trading.paperAccessTokenLabel')}</label>
          <input
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder={credentials?.paper_access_token_set ? t('trading.appKeySet') : t('trading.paperAccessTokenPlaceholder')}
            value={paperAccessToken}
            onChange={(e) => setPaperAccessToken(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
        {t('trading.longportNote')}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('trading.saveConfig')}
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !allSet}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {testing ? t('trading.testing') : t('trading.testConnection')}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.includes(t('common.saveFailed')) ? 'text-red-600' : 'text-green-600'}`}>
            {saveMsg}
          </span>
        )}
        {testResult && (
          <span className={`text-xs ${testResult.connected ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.connected ? t('trading.connectionSuccess') : `${t('trading.connectionFailed')}${testResult.error ? `: ${testResult.error}` : ''}`}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-400">
        {t('trading.credentialSource')} <a href="https://open.longbridge.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{t('trading.longportDevCenter')}</a> {t('trading.credentialLocalNote')}
        {t('trading.currentMode', { mode: isPaper ? t('trading.paperMode') : t('trading.liveMode') })}
      </p>
    </div>
  );
}

function AccountOverview({ stats, positions }: { stats: OrderStats | null; positions: BrokerPosition[] }) {
  const { t } = useTranslation();
  const fmtMoney = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  // Compute from positions (USD) — same logic as live dashboard
  const totalCost = positions.reduce((sum, p) => sum + p.avg_cost * p.quantity, 0);
  const totalMarketValue = positions.reduce((sum, p) => sum + (p.current_price ?? p.avg_cost) * p.quantity, 0);
  const unrealizedPnl = totalMarketValue - totalCost;

  const cards = [
    { label: t('trading.costBasis'), value: totalCost, fmt: fmtMoney },
    { label: t('trading.marketValue'), value: totalMarketValue, fmt: fmtMoney },
    { label: t('trading.unrealizedPnl'), value: unrealizedPnl, fmt: (v: number) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}` },
    { label: t('trading.dailyTrades'), value: stats?.total_orders ?? 0, fmt: (v: number) => String(v) },
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
function getOrderSourceLabel(order: TradingOrder, t: (key: string) => string): string {
  if (order.signal_id != null && order.strategy_id == null) return t('trading.signalAuto');
  if (order.strategy_id != null) return t('trading.strategyAuto');
  return t('trading.manual');
}

function OrderSourceBadge({ order }: { order: TradingOrder }) {
  const { t } = useTranslation();
  const label = getOrderSourceLabel(order, t);
  const signalAuto = t('trading.signalAuto');
  const strategyAuto = t('trading.strategyAuto');
  const manual = t('trading.manual');
  const colors: Record<string, string> = {
    [manual]: 'bg-gray-100 text-gray-700',
    [signalAuto]: 'bg-blue-100 text-blue-700',
    [strategyAuto]: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[label] ?? 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

function ActiveOrdersTable({ orders, onCancel }: { orders: TradingOrder[]; onCancel: (id: number) => void }) {
  const { t } = useTranslation();
  const active = orders.filter((o) => ['pending', 'submitted', 'partial_filled'].includes(o.status));
  if (active.length === 0) return <p className="py-4 text-center text-sm text-gray-400">{t('trading.noActiveOrders')}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500">
            <th className="pb-2 pr-4">{t('trading.symbol')}</th><th className="pb-2 pr-4">{t('trading.side')}</th>
            <th className="pb-2 pr-4">{t('trading.type')}</th><th className="pb-2 pr-4">{t('trading.quantity')}</th>
            <th className="pb-2 pr-4">{t('trading.price')}</th><th className="pb-2 pr-4">{t('trading.source')}</th>
            <th className="pb-2 pr-4">{t('trading.orderStatus')}</th>
            <th className="pb-2 pr-4">{t('trading.time')}</th><th className="pb-2">{t('trading.action')}</th>
          </tr>
        </thead>
        <tbody>
          {active.map((o) => (
            <tr key={o.id ?? o.local_order_id} className="border-b border-gray-100">
              <td className="py-2 pr-4 font-medium">{o.symbol}</td>
              <td className={`py-2 pr-4 ${o.side === 'buy' ? 'text-red-600' : 'text-green-600'}`}>
                {o.side === 'buy' ? t('trading.buy') : t('trading.sell')}
              </td>
              <td className="py-2 pr-4">{o.order_type}</td>
              <td className="py-2 pr-4">{o.quantity}</td>
              <td className="py-2 pr-4">{o.price ?? '-'}</td>
              <td className="py-2 pr-4"><OrderSourceBadge order={o} /></td>
              <td className="py-2 pr-4"><StatusBadge status={o.status} /></td>
              <td className="py-2 pr-4 text-gray-500">{new Date(o.created_at * 1000).toLocaleTimeString()}</td>
              <td className="py-2">
                <button className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200" onClick={() => o.id && onCancel(o.id)}>{t('trading.cancelOrder')}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderHistoryTable({ orders }: { orders: TradingOrder[] }) {
  const { t } = useTranslation();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSymbol, setFilterSymbol] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(20);
  const [paginatedOrders, setPaginatedOrders] = useState<TradingOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingPage, setLoadingPage] = useState(false);

  // Fetch paginated orders from API
  useEffect(() => {
    let cancelled = false;
    const fetchPage = async () => {
      setLoadingPage(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(pageSize));
        params.set('offset', String(page * pageSize));
        if (filterStatus) params.set('status', filterStatus);
        if (filterSymbol) params.set('symbol', filterSymbol);
        const resp = await fetch(`/api/trading/orders?${params.toString()}`);
        if (!resp.ok) throw new Error('Failed to fetch orders');
        const data = await resp.json();
        if (!cancelled) {
          setPaginatedOrders(data.orders);
          setTotal(data.total);
        }
      } catch {
        // fallback to store orders on error
        if (!cancelled) {
          const filtered = orders.filter((o) => {
            if (filterStatus && o.status !== filterStatus) return false;
            if (filterSymbol && !o.symbol.toLowerCase().includes(filterSymbol.toLowerCase())) return false;
            return true;
          });
          setPaginatedOrders(filtered.slice(page * pageSize, (page + 1) * pageSize));
          setTotal(filtered.length);
        }
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    };
    fetchPage();
    return () => { cancelled = true; };
  }, [page, pageSize, filterStatus, filterSymbol, orders]);

  // Reset to page 0 when filters change
  const handleFilterChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(0);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input className="rounded border border-gray-300 px-2 py-1 text-sm" placeholder={t('trading.symbol')} value={filterSymbol} onChange={(e) => handleFilterChange(setFilterSymbol, e.target.value)} />
        <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={filterStatus} onChange={(e) => handleFilterChange(setFilterStatus, e.target.value)}>
          <option value="">{t('trading.allStatus')}</option>
          <option value="filled">{t('trading.filled')}</option>
          <option value="cancelled">{t('trading.cancelled')}</option>
          <option value="rejected">{t('trading.rejected')}</option>
          <option value="failed">{t('trading.failed')}</option>
          <option value="pending">{t('trading.pending')}</option>
          <option value="submitted">{t('trading.submitted')}</option>
        </select>
        <span className="ml-auto text-xs text-gray-400">{t('trading.totalRecords', { count: total })}</span>
      </div>
      {loadingPage ? (
        <p className="py-4 text-center text-sm text-gray-400">{t('common.loading')}</p>
      ) : paginatedOrders.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">{t('trading.noTradeRecords')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="whitespace-nowrap pb-2 pr-3">{t('trading.symbol')}</th><th className="whitespace-nowrap pb-2 pr-3">{t('trading.side')}</th>
                <th className="whitespace-nowrap pb-2 pr-3">{t('trading.type')}</th><th className="whitespace-nowrap pb-2 pr-3">{t('trading.quantity')}</th>
                <th className="whitespace-nowrap pb-2 pr-3">{t('trading.price')}</th><th className="whitespace-nowrap pb-2 pr-3">{t('trading.filledQty')}</th>
                <th className="whitespace-nowrap pb-2 pr-3">{t('trading.filledPrice')}</th><th className="whitespace-nowrap pb-2 pr-3">{t('trading.source')}</th>
                <th className="whitespace-nowrap pb-2 pr-3">{t('trading.orderStatus')}</th>
                <th className="whitespace-nowrap pb-2">{t('trading.time')}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map((o) => (
                <tr key={o.id ?? o.local_order_id} className="border-b border-gray-100">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">{o.symbol}</td>
                  <td className={`whitespace-nowrap py-2 pr-3 ${o.side === 'buy' ? 'text-red-600' : 'text-green-600'}`}>{o.side === 'buy' ? t('trading.buy') : t('trading.sell')}</td>
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
      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>{t('trading.page', { current: page + 1, total: totalPages })}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('trading.first')}
            </button>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('trading.prev')}
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('trading.next')}
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('trading.last')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RiskStatusPanel({ rules, stats }: { rules: RiskRule[]; stats: OrderStats | null }) {
  const { t } = useTranslation();
  if (rules.length === 0) return <p className="py-4 text-center text-sm text-gray-400">{t('trading.noRiskRules')}</p>;
  const currentValues: Record<string, number> = {
    max_daily_amount: stats?.total_filled_amount ?? 0,
    max_daily_trades: stats?.total_orders ?? 0,
  };
  // Rules that are per-order checks (no meaningful cumulative "current value")
  const perOrderRules = new Set(['max_order_amount', 'max_position_ratio', 'max_daily_loss']);

  return (
    <div className="space-y-3">
      {rules.map((r) => {
        const isPerOrder = perOrderRules.has(r.rule_type);
        const current = currentValues[r.rule_type] ?? 0;
        const pct = !isPerOrder && r.threshold > 0 ? Math.min((current / r.threshold) * 100, 100) : 0;
        // Format threshold display
        const isRatio = r.rule_type === 'max_position_ratio';
        const thresholdDisplay = isRatio ? `${(r.threshold * 100).toFixed(0)}%` : r.threshold.toLocaleString();
        const currentDisplay = isPerOrder
          ? (isRatio ? t('trading.perTradeCheck') : t('trading.perOrderCheck'))
          : current.toLocaleString();
        return (
          <div key={r.id ?? r.rule_type} className="rounded border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between text-sm">
              <span className={r.enabled ? 'text-gray-800' : 'text-gray-400 line-through'}>{r.rule_name}</span>
              <span className="text-xs text-gray-500">{currentDisplay} / {thresholdDisplay}</span>
            </div>
            {!isPerOrder && (
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
                <div className={`h-1.5 rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ManualOrderForm({ onSubmit }: { onSubmit: (req: { symbol: string; side: OrderSide; order_type: OrderType; quantity: number; price?: number }) => Promise<unknown> }) {
  const { t } = useTranslation();
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
    if (!symbol.trim()) { setFormError(t('trading.enterSymbol')); return; }
    if (!qty || qty <= 0) { setFormError(t('trading.enterValidQty')); return; }
    const prc = price ? Number(price) : undefined;
    if (orderType === 'limit' && (!prc || prc <= 0)) { setFormError(t('trading.limitNeedsPrice')); return; }

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
        <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder={t('trading.symbolPlaceholder')} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={side} onChange={(e) => setSide(e.target.value as OrderSide)}>
          <option value="buy">{t('trading.buy')}</option>
          <option value="sell">{t('trading.sell')}</option>
        </select>
        <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
          <option value="market">{t('trading.marketOrder')}</option>
          <option value="limit">{t('trading.limitOrder')}</option>
          <option value="stop">{t('trading.stopOrder')}</option>
          <option value="stop_limit">{t('trading.stopLimitOrder')}</option>
        </select>
        <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder={t('trading.qtyPlaceholder')} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        {orderType !== 'market' && (
          <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder={t('trading.pricePlaceholder')} type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        )}
      </div>
      {formError && <p className="text-xs text-red-600">{formError}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {submitting ? t('common.submitting') : t('trading.placeOrder')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

function DynamicRiskPanel() {
  const { t } = useTranslation();
  const [riskState, setRiskState] = useState<{
    regime: string; vix_level: number | null; portfolio_drawdown: number; risk_multiplier: number;
  } | null>(null);

  useEffect(() => {
    const fetchRisk = async () => {
      try {
        const res = await fetch('/api/trading/dynamic-risk');
        if (res.ok) setRiskState(await res.json());
      } catch { /* ignore */ }
    };
    fetchRisk();
    const timer = setInterval(fetchRisk, 60000);
    return () => clearInterval(timer);
  }, []);

  if (!riskState) return null;

  const regimeLabels: Record<string, { label: string; color: string; icon: string }> = {
    low_vol: { label: t('trading.lowVol'), color: 'text-green-600 bg-green-50 border-green-200', icon: '🟢' },
    normal: { label: t('trading.normal'), color: 'text-blue-600 bg-blue-50 border-blue-200', icon: '🔵' },
    high_vol: { label: t('trading.highVol'), color: 'text-orange-600 bg-orange-50 border-orange-200', icon: '🟠' },
    crisis: { label: t('trading.crisis'), color: 'text-red-600 bg-red-50 border-red-200', icon: '🔴' },
  };
  const regime = regimeLabels[riskState.regime] || regimeLabels.normal;

  return (
    <div className={`rounded-lg border p-3 ${regime.color}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{regime.icon}</span>
          <div>
            <span className="text-sm font-medium">{t('trading.marketStatus')}: {regime.label}</span>
            {riskState.vix_level != null && (
              <span className="ml-3 text-xs opacity-75">VIX: {riskState.vix_level.toFixed(1)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span>{t('trading.riskMultiplier')}: {riskState.risk_multiplier.toFixed(2)}x</span>
          <span>{t('trading.portfolioDrawdown')}: {(riskState.portfolio_drawdown * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

const TradingDashboardView: React.FC = () => {
  const { t } = useTranslation();
  const {
    account, orders, positions, riskRules, stats, config, credentials,
    loading, error, tradingEvents,
    fetchAll, placeOrder, cancelOrder, updateConfig, saveCredentials, testBrokerConnection,
    startPolling, stopPolling,
    fetchStopLossRecords,
    connectTradingWs, disconnectTradingWs,
  } = useTradingStore();

  const [showSettings, setShowSettings] = useState(false);
  const [switchError, setSwitchError] = useState('');

  useEffect(() => {
    fetchAll();
    startPolling();
    connectTradingWs();
    // Poll stop-loss records every 15 seconds (aligned with main polling interval)
    const slTimer = setInterval(() => {
      fetchStopLossRecords().catch(() => {});
    }, 15000);
    return () => {
      stopPolling();
      disconnectTradingWs();
      clearInterval(slTimer);
    };
  }, [fetchAll, startPolling, stopPolling, fetchStopLossRecords, connectTradingWs, disconnectTradingWs]);

  const handleModeSwitch = async (mode: 'paper' | 'live') => {
    setSwitchError('');
    try {
      await updateConfig({ trading_mode: mode });
    } catch (err) {
      setSwitchError((err as Error).message);
    }
  };

  if (loading && !account) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-gray-500">{t('common.loading')}</p></div>;
  }

  if (error && !account) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-red-500">{t('trading.loadFailed')}: {error}</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">{t('trading.title')}</h1>
          <div className="flex items-center gap-3">
            <TradingModeSwitch config={config} onSwitch={handleModeSwitch} />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                showSettings ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t('trading.brokerSettings')}
            </button>
          </div>
        </div>

        {switchError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{switchError}</div>
        )}

        {/* Broker Settings Panel (collapsible) */}
        {showSettings && (
          <section className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('trading.brokerConfig')}</h2>
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
        <AccountOverview stats={stats} positions={positions} />

        {/* Dynamic Risk State (VIX) */}
        <DynamicRiskPanel />

        {/* Auto Trading Panel */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <AutoTradingPanel />
        </section>

        {/* Active Orders */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('trading.activeOrders')}</h2>
          <ActiveOrdersTable orders={orders} onCancel={cancelOrder} />
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-3">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('trading.tradeHistory')}</h2>
            <OrderHistoryTable orders={orders} />
          </section>
          <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('trading.riskStatus')}</h2>
            <RiskStatusPanel rules={riskRules} stats={stats} />
          </section>
        </div>

        {/* Real-time Event Feed */}
        {tradingEvents.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('trading.realtimeEvents')}</h2>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {tradingEvents.slice(0, 20).map((evt, i) => {
                const icons: Record<string, string> = {
                  order_created: '📋', order_filled: '✅', order_failed: '❌',
                  stop_loss_triggered: '🛑', risk_alert: '🚨',
                };
                const time = new Date(evt.timestamp).toLocaleTimeString();
                return (
                  <div key={i} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                    <span>{icons[evt.type] || '📌'}</span>
                    <span className="text-gray-400">{time}</span>
                    <span className="font-medium">{evt.data?.symbol || ''}</span>
                    <span>{evt.type.replace(/_/g, ' ')}</span>
                    {evt.data?.filled_price && <span className="text-green-600">@{evt.data.filled_price}</span>}
                    {evt.data?.reason && <span className="text-red-500 truncate max-w-xs">{evt.data.reason}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Manual Order Form */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('trading.manualOrder')}</h2>
          <ManualOrderForm onSubmit={placeOrder} />
        </section>
      </div>
    </div>
  );
};

export default TradingDashboardView;
