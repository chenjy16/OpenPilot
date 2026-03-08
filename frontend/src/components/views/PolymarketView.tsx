import { useState, useEffect, useCallback } from 'react';
import { get, post } from '../../services/apiClient';

interface Market {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  probability: number;
  volume: number;
  volume24hr: number;
  liquidity: number;
  endDate: string;
  tags: string[];
  active: boolean;
}

interface Signal {
  id: number;
  market_id: string;
  question: string;
  market_probability: number;
  ai_probability: number;
  edge: number;
  confidence: string;
  reasoning: string;
  created_at: number;
}

type Tab = 'markets' | 'signals';

const PolymarketView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('markets');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await get<{ count: number; markets: Market[] }>('/polymarket/markets');
      setMarkets(data.markets);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const data = await get<Signal[]>('/polymarket/signals');
      setSignals(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchMarkets();
    fetchSignals();
  }, [fetchMarkets, fetchSignals]);

  const handleAnalyze = async (market: Market) => {
    setAnalyzing(market.id);
    try {
      await post('/polymarket/analyze', {
        marketId: market.id,
        question: market.question,
        probability: market.probability,
      });
      await fetchSignals();
    } catch (err) {
      setError(`分析失败: ${(err as Error).message}`);
    } finally {
      setAnalyzing(null);
    }
  };

  const opportunities = signals.filter(s => Math.abs(s.edge) >= 0.05);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔮</span>
          <h1 className="text-lg font-semibold text-gray-800">PolyOracle</h1>
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
            AI 预测市场分析
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { fetchMarkets(); fetchSignals(); }}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 border-b border-gray-100 bg-gray-50 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">热门市场</span>
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">{markets.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">AI 信号</span>
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">{signals.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">+EV 机会</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">{opportunities.length}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-6">
        {([['markets', '📡 热门市场'], ['signals', '📊 AI 信号']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              tab === id ? 'border-b-2 border-purple-500 text-purple-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {tab === 'markets' && (
          <MarketsPanel
            markets={markets}
            signals={signals}
            loading={loading}
            analyzing={analyzing}
            onAnalyze={handleAnalyze}
          />
        )}

        {tab === 'signals' && (
          <SignalsPanel signals={signals} />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Markets Panel
// ---------------------------------------------------------------------------
const MarketsPanel: React.FC<{
  markets: Market[];
  signals: Signal[];
  loading: boolean;
  analyzing: string | null;
  onAnalyze: (m: Market) => void;
}> = ({ markets, signals, loading, analyzing, onAnalyze }) => {
  if (loading) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">正在扫描 Polymarket 热门市场...</div>;
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">📡</div>
        <p className="text-sm text-gray-500">暂无市场数据</p>
        <p className="mt-1 text-xs text-gray-400">请检查网络连接或 Polymarket API 配置</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {markets.map(market => {
        const signal = signals.find(s => s.market_id === market.id);
        const edge = signal ? signal.edge : null;
        const isOpportunity = edge !== null && Math.abs(edge) >= 0.05;

        return (
          <div
            key={market.id}
            className={`rounded-lg border bg-white p-4 transition-colors ${
              isOpportunity ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium text-gray-800">{market.question}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <ProbBadge label="市场" value={market.probability} color="blue" />
                  {signal && <ProbBadge label="AI" value={signal.ai_probability} color="purple" />}
                  {edge !== null && (
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                      edge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      Edge: {edge > 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
                    </span>
                  )}
                  {isOpportunity && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      ⚡ +EV 机会
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                  <span>交易量: ${formatNumber(market.volume)}</span>
                  <span>·</span>
                  <span>24h: ${formatNumber(market.volume24hr)}</span>
                  <span>·</span>
                  <span>流动性: ${formatNumber(market.liquidity)}</span>
                  {market.endDate && (
                    <>
                      <span>·</span>
                      <span>截止: {new Date(market.endDate).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
                {signal?.reasoning && (
                  <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                    <span className="font-medium text-gray-500">AI 分析: </span>
                    {signal.reasoning}
                  </div>
                )}
              </div>
              <button
                onClick={() => onAnalyze(market)}
                disabled={analyzing === market.id}
                className="flex-shrink-0 rounded-md bg-purple-500 px-3 py-1.5 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
              >
                {analyzing === market.id ? '分析中...' : '🧠 AI 分析'}
              </button>
            </div>
            {market.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {market.tags.slice(0, 5).map(tag => (
                  <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{tag}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Signals Panel
// ---------------------------------------------------------------------------
const SignalsPanel: React.FC<{ signals: Signal[] }> = ({ signals }) => {
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">📊</div>
        <p className="text-sm text-gray-500">暂无 AI 分析信号</p>
        <p className="mt-1 text-xs text-gray-400">在热门市场中点击"AI 分析"生成信号</p>
      </div>
    );
  }

  const sorted = [...signals].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  return (
    <div className="space-y-3">
      {sorted.map(signal => {
        const isOpportunity = Math.abs(signal.edge) >= 0.05;
        return (
          <div
            key={signal.id}
            className={`rounded-lg border bg-white p-4 ${
              isOpportunity ? 'border-amber-300' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-sm font-medium text-gray-800">{signal.question}</h3>
              {isOpportunity && (
                <span className="flex-shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  ⚡ +EV
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-4">
              <ProbBadge label="市场" value={signal.market_probability} color="blue" />
              <span className="text-gray-300">→</span>
              <ProbBadge label="AI" value={signal.ai_probability} color="purple" />
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                signal.edge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                Edge: {signal.edge > 0 ? '+' : ''}{(signal.edge * 100).toFixed(1)}%
              </span>
              <span className={`rounded px-2 py-0.5 text-xs ${
                signal.confidence === 'high' ? 'bg-green-50 text-green-600' :
                signal.confidence === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                'bg-gray-50 text-gray-500'
              }`}>
                置信度: {signal.confidence}
              </span>
            </div>
            {signal.reasoning && (
              <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                {signal.reasoning}
              </div>
            )}
            <div className="mt-2 text-xs text-gray-400">
              {new Date(signal.created_at * 1000).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ProbBadge: React.FC<{ label: string; value: number; color: 'blue' | 'purple' }> = ({ label, value, color }) => {
  const bg = color === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${bg}`}>
      {label}: {(value * 100).toFixed(1)}%
    </span>
  );
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

export default PolymarketView;
