import { useState, useEffect, useCallback } from 'react';
import { get, post } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StockSignal {
  id: number;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  reasoning: string | null;
  technical_summary: string | null;
  sentiment_summary: string | null;
  confidence: string | null;
  created_at: number;
  notified_at: number | null;
}

interface AnalyzeResult {
  symbol: string;
  action: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  reasoning: string;
  confidence: string;
  technical_summary: string;
  sentiment_summary: string;
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const StockAnalysisView: React.FC = () => {
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual analysis state
  const [symbol, setSymbol] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  const fetchSignals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await get<StockSignal[]>('/stocks/signals');
      setSignals(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const handleAnalyze = async () => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) return;
    setAnalyzing(true);
    setError(null);
    setAnalyzeResult(null);
    try {
      const result = await post<AnalyzeResult>('/stocks/analyze', { symbol: trimmed });
      setAnalyzeResult(result);
      await fetchSignals();
    } catch (err) {
      setError(`分析失败: ${(err as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const actionLabel = (action: string) => {
    switch (action) {
      case 'buy': return { text: '买入', color: 'bg-green-100 text-green-700' };
      case 'sell': return { text: '卖出', color: 'bg-red-100 text-red-700' };
      case 'hold': return { text: '观望', color: 'bg-yellow-100 text-yellow-700' };
      default: return { text: action, color: 'bg-gray-100 text-gray-700' };
    }
  };

  const confidenceStyle = (confidence: string | null) => {
    switch (confidence) {
      case 'high': return 'bg-green-50 text-green-600';
      case 'medium': return 'bg-yellow-50 text-yellow-600';
      case 'low': return 'bg-gray-50 text-gray-500';
      default: return 'bg-gray-50 text-gray-500';
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📈</span>
          <h1 className="text-lg font-semibold text-gray-800">股票分析</h1>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
            量化信号仪表盘
          </span>
        </div>
        <button
          onClick={fetchSignals}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
        >
          🔄 刷新
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {/* Manual Analysis Panel */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            🔍 手动分析
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            输入股票代码触发单只股票的完整分析流程（技术面 + 消息面 + AI 综合研判）
          </p>
          <div className="mt-4 flex items-center gap-3">
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
              placeholder="输入股票代码，如 AAPL"
              className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={analyzing}
            />
            <button
              onClick={handleAnalyze}
              disabled={analyzing || !symbol.trim()}
              className="rounded-md bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {analyzing ? '⏳ 分析中...' : '📊 开始分析'}
            </button>
          </div>

          {/* Analysis Result */}
          {analyzeResult && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-800">{analyzeResult.symbol}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${actionLabel(analyzeResult.action).color}`}>
                  {actionLabel(analyzeResult.action).text}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${confidenceStyle(analyzeResult.confidence)}`}>
                  置信度: {analyzeResult.confidence}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
                <span>💰 入场: ${analyzeResult.entry_price?.toFixed(2)}</span>
                <span>🛑 止损: ${analyzeResult.stop_loss?.toFixed(2)}</span>
                <span>🎯 止盈: ${analyzeResult.take_profit?.toFixed(2)}</span>
              </div>
              {analyzeResult.reasoning && (
                <div className="mt-2 rounded bg-white p-2 text-xs text-gray-600">
                  <span className="font-medium text-gray-500">分析逻辑: </span>
                  {analyzeResult.reasoning}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Signals List Panel */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            📊 信号列表
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            最近的股票分析信号记录
          </p>

          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-gray-400">
              加载信号数据...
            </div>
          ) : signals.length === 0 ? (
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-8 text-center">
              <div className="mb-3 text-4xl">📊</div>
              <p className="text-sm text-gray-500">暂无分析信号</p>
              <p className="mt-1 text-xs text-gray-400">使用上方的手动分析功能生成信号</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {signals.map(signal => {
                const action = actionLabel(signal.action);
                return (
                  <div key={signal.id} className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-gray-800">{signal.symbol}</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${action.color}`}>
                          {action.text}
                        </span>
                        {signal.confidence && (
                          <span className={`rounded px-2 py-0.5 text-xs ${confidenceStyle(signal.confidence)}`}>
                            置信度: {signal.confidence}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(signal.created_at * 1000).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
                      {signal.entry_price != null && <span>💰 入场: ${signal.entry_price.toFixed(2)}</span>}
                      {signal.stop_loss != null && <span>🛑 止损: ${signal.stop_loss.toFixed(2)}</span>}
                      {signal.take_profit != null && <span>🎯 止盈: ${signal.take_profit.toFixed(2)}</span>}
                    </div>
                    {signal.reasoning && (
                      <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                        {signal.reasoning}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockAnalysisView;
