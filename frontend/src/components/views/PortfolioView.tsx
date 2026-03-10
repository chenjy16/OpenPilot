import { useState, useEffect, useCallback } from 'react';
import { get, post, put, del } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioPosition {
  id: number;
  symbol: string;
  quantity: number;
  cost_price: number;
  current_price: number | null;
  created_at: number;
  updated_at: number;
}

interface PositionWithMetrics extends PortfolioPosition {
  market_value: number;
  pnl: number;
  pnl_pct: number;
}

interface PortfolioMetrics {
  total_market_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  positions: PositionWithMetrics[];
}

interface PositionForm {
  symbol: string;
  quantity: string;
  cost_price: string;
  current_price: string;
}

const emptyForm: PositionForm = { symbol: '', quantity: '', cost_price: '', current_price: '' };

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const PortfolioView: React.FC = () => {
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PositionForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchPortfolio = useCallback(async () => {
    try {
      setLoading(true);
      const data = await get<PortfolioMetrics>('/stocks/portfolio');
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (pos: PositionWithMetrics) => {
    setEditingId(pos.id);
    setForm({
      symbol: pos.symbol,
      quantity: String(pos.quantity),
      cost_price: String(pos.cost_price),
      current_price: pos.current_price != null ? String(pos.current_price) : '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async () => {
    const trimmedSymbol = form.symbol.trim().toUpperCase();
    if (!trimmedSymbol || !form.quantity || !form.cost_price) return;

    const body: Record<string, unknown> = {
      symbol: trimmedSymbol,
      quantity: Number(form.quantity),
      cost_price: Number(form.cost_price),
    };
    if (form.current_price.trim()) {
      body.current_price = Number(form.current_price);
    }

    setSubmitting(true);
    setError(null);
    try {
      if (editingId != null) {
        await put(`/stocks/portfolio/${editingId}`, body);
      } else {
        await post('/stocks/portfolio', body);
      }
      closeForm();
      await fetchPortfolio();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await del(`/stocks/portfolio/${id}`);
      setDeletingId(null);
      await fetchPortfolio();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pnlColor = (value: number) => (value >= 0 ? 'text-green-600' : 'text-red-600');
  const pnlBg = (value: number) => (value >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💼</span>
          <h1 className="text-lg font-semibold text-gray-800">投资组合</h1>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
            持仓管理
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAddForm}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
          >
            ➕ 添加持仓
          </button>
          <button
            onClick={fetchPortfolio}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
            <h2 className="text-base font-semibold text-gray-800">
              {editingId != null ? '✏️ 编辑持仓' : '➕ 添加持仓'}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">股票代码</label>
                <input
                  type="text"
                  value={form.symbol}
                  onChange={e => setForm({ ...form, symbol: e.target.value })}
                  placeholder="如 AAPL"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={editingId != null}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">数量</label>
                <input
                  type="number"
                  value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: e.target.value })}
                  placeholder="100"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">成本价</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.cost_price}
                  onChange={e => setForm({ ...form, cost_price: e.target.value })}
                  placeholder="150.00"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">当前价 (可选)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.current_price}
                  onChange={e => setForm({ ...form, current_price: e.target.value })}
                  placeholder="155.00"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || !form.symbol.trim() || !form.quantity || !form.cost_price}
                className="rounded-md bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {submitting ? '⏳ 提交中...' : editingId != null ? '保存修改' : '添加'}
              </button>
              <button
                onClick={closeForm}
                className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-600 hover:bg-gray-200"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Overview Cards (10.1.2) */}
        {metrics && !loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">💰 总市值</p>
              <p className="mt-1 text-xl font-semibold text-gray-800">
                ${metrics.total_market_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className={`rounded-lg border p-4 ${pnlBg(metrics.total_pnl)}`}>
              <p className="text-xs text-gray-500">📊 总盈亏</p>
              <p className={`mt-1 text-xl font-semibold ${pnlColor(metrics.total_pnl)}`}>
                {metrics.total_pnl >= 0 ? '+' : ''}${metrics.total_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className={`rounded-lg border p-4 ${pnlBg(metrics.total_pnl_pct)}`}>
              <p className="text-xs text-gray-500">📈 盈亏比例</p>
              <p className={`mt-1 text-xl font-semibold ${pnlColor(metrics.total_pnl_pct)}`}>
                {metrics.total_pnl_pct >= 0 ? '+' : ''}{(metrics.total_pnl_pct * 100).toFixed(2)}%
              </p>
            </div>
          </div>
        )}

        {/* Positions Table (10.1.1) */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            📋 持仓列表
          </h2>

          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-gray-400">
              加载持仓数据...
            </div>
          ) : !metrics || metrics.positions.length === 0 ? (
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-8 text-center">
              <div className="mb-3 text-4xl">💼</div>
              <p className="text-sm text-gray-500">暂无持仓</p>
              <p className="mt-1 text-xs text-gray-400">点击上方"添加持仓"按钮开始管理您的投资组合</p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4 font-medium">代码</th>
                    <th className="pb-2 pr-4 font-medium text-right">数量</th>
                    <th className="pb-2 pr-4 font-medium text-right">成本价</th>
                    <th className="pb-2 pr-4 font-medium text-right">当前价</th>
                    <th className="pb-2 pr-4 font-medium text-right">市值</th>
                    <th className="pb-2 pr-4 font-medium text-right">盈亏</th>
                    <th className="pb-2 pr-4 font-medium text-right">盈亏%</th>
                    <th className="pb-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.positions.map(pos => (
                    <tr key={pos.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-gray-800">{pos.symbol}</td>
                      <td className="py-3 pr-4 text-right text-gray-600">{pos.quantity}</td>
                      <td className="py-3 pr-4 text-right text-gray-600">${pos.cost_price.toFixed(2)}</td>
                      <td className="py-3 pr-4 text-right text-gray-600">
                        {pos.current_price != null ? `$${pos.current_price.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-600">
                        ${pos.market_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={`py-3 pr-4 text-right font-medium ${pnlColor(pos.pnl)}`}>
                        {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                      </td>
                      <td className={`py-3 pr-4 text-right font-medium ${pnlColor(pos.pnl_pct)}`}>
                        {pos.pnl_pct >= 0 ? '+' : ''}{(pos.pnl_pct * 100).toFixed(2)}%
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditForm(pos)}
                            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                          >
                            ✏️ 编辑
                          </button>
                          {deletingId === pos.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(pos.id)}
                                className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                              >
                                取消
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeletingId(pos.id)}
                              className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >
                              🗑️ 删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioView;
