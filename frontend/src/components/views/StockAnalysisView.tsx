import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../services/apiClient';
import KlineChart from '../charts/KlineChart';

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
  outcome: string | null;
  outcome_at: number | null;
  technical_score: number | null;
  sentiment_score: number | null;
  overall_score: number | null;
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
  scores?: {
    technical_score: number | null;
    sentiment_score: number | null;
    overall_score: number | null;
  };
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const StockAnalysisView: React.FC = () => {
  const { t } = useTranslation();
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual analysis state
  const [symbol, setSymbol] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  // K-line chart state
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

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
      setChartSymbol(trimmed);
      await fetchSignals();
    } catch (err) {
      setError(t('stockAnalysis.analyzeFailed', { message: (err as Error).message }));
    } finally {
      setAnalyzing(false);
    }
  };

  const actionLabel = (action: string) => {
    switch (action) {
      case 'buy': return { text: t('stockAnalysis.buy'), color: 'bg-green-100 text-green-700' };
      case 'sell': return { text: t('stockAnalysis.sell'), color: 'bg-red-100 text-red-700' };
      case 'hold': return { text: t('stockAnalysis.hold'), color: 'bg-yellow-100 text-yellow-700' };
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

  const outcomeLabel = (outcome: string | null) => {
    switch (outcome) {
      case 'hit_tp': return { text: t('stockAnalysis.hitTp'), color: 'bg-green-100 text-green-700' };
      case 'hit_sl': return { text: t('stockAnalysis.hitSl'), color: 'bg-red-100 text-red-700' };
      case 'expired': return { text: t('stockAnalysis.expired'), color: 'bg-gray-100 text-gray-500' };
      case 'pending': return { text: t('stockAnalysis.pending'), color: 'bg-blue-100 text-blue-600' };
      default: return null;
    }
  };

  const scoreBarColor = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const ScoreBar = ({ label, score }: { label: string; score: number | null }) => {
    if (score == null) return null;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 text-gray-500 shrink-0">{label}</span>
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${scoreBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className="w-8 text-right text-gray-600 font-medium">{score}</span>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📈</span>
          <h1 className="text-lg font-semibold text-gray-800">{t('stockAnalysis.title')}</h1>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
            {t('stockAnalysis.quantDashboard')}
          </span>
        </div>
        <button
          onClick={fetchSignals}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
        >
          🔄 {t('stockAnalysis.refresh')}
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
            🔍 {t('stockAnalysis.manualAnalysis')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {t('stockAnalysis.manualAnalysisDesc')}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
              placeholder={t('stockAnalysis.symbolPlaceholder')}
              className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={analyzing}
            />
            <button
              onClick={handleAnalyze}
              disabled={analyzing || !symbol.trim()}
              className="rounded-md bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {analyzing ? t('stockAnalysis.analyzing') : t('stockAnalysis.startAnalysis')}
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
                  {t('stockAnalysis.confidence')}: {analyzeResult.confidence}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
                <span>💰 {t('stockAnalysis.entry')}: ${analyzeResult.entry_price?.toFixed(2)}</span>
                <span>🛑 {t('stockAnalysis.stopLoss')}: ${analyzeResult.stop_loss?.toFixed(2)}</span>
                <span>🎯 {t('stockAnalysis.takeProfit')}: ${analyzeResult.take_profit?.toFixed(2)}</span>
              </div>
              {analyzeResult.reasoning && (
                <div className="mt-2 rounded bg-white p-2 text-xs text-gray-600">
                  <span className="font-medium text-gray-500">{t('stockAnalysis.reasoning')}: </span>
                  {analyzeResult.reasoning}
                </div>
              )}
              {analyzeResult.scores && (analyzeResult.scores.technical_score != null || analyzeResult.scores.sentiment_score != null || analyzeResult.scores.overall_score != null) && (
                <div className="mt-3 space-y-1.5 rounded bg-white p-3">
                  <span className="text-xs font-medium text-gray-500">{t('stockAnalysis.multiFactorScore')}</span>
                  <ScoreBar label={t('stockAnalysis.technical')} score={analyzeResult.scores.technical_score} />
                  <ScoreBar label={t('stockAnalysis.sentiment')} score={analyzeResult.scores.sentiment_score} />
                  <ScoreBar label={t('stockAnalysis.overall')} score={analyzeResult.scores.overall_score} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* K-line Chart — shown inline in signal cards or after manual analysis */}
        {chartSymbol && !signals.some(s => s.symbol === chartSymbol) && (
          <KlineChart
            symbol={chartSymbol}
            timeframe="daily"
            indicators={['sma20', 'sma50', 'bollinger']}
          />
        )}

        {/* Signals List Panel */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            📊 {t('stockAnalysis.signalList')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {t('stockAnalysis.signalListDesc')}
          </p>

          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-gray-400">
              {t('stockAnalysis.loadingSignals')}
            </div>
          ) : signals.length === 0 ? (
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-8 text-center">
              <div className="mb-3 text-4xl">📊</div>
              <p className="text-sm text-gray-500">{t('stockAnalysis.noSignals')}</p>
              <p className="mt-1 text-xs text-gray-400">{t('stockAnalysis.noSignalsHint')}</p>
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
                            {t('stockAnalysis.confidence')}: {signal.confidence}
                          </span>
                        )}
                        {(() => {
                          const oc = outcomeLabel(signal.outcome);
                          return oc ? (
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${oc.color}`}>
                              {oc.text}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setChartSymbol(chartSymbol === signal.symbol ? null : signal.symbol)}
                          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                            chartSymbol === signal.symbol
                              ? 'bg-blue-500 text-white'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}
                        >
                          📈 {t('stockAnalysis.kline')}
                        </button>
                        <span className="text-xs text-gray-400">
                          {new Date(signal.created_at * 1000).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
                      {signal.entry_price != null && <span>💰 {t('stockAnalysis.entry')}: ${signal.entry_price.toFixed(2)}</span>}
                      {signal.stop_loss != null && <span>🛑 {t('stockAnalysis.stopLoss')}: ${signal.stop_loss.toFixed(2)}</span>}
                      {signal.take_profit != null && <span>🎯 {t('stockAnalysis.takeProfit')}: ${signal.take_profit.toFixed(2)}</span>}
                    </div>
                    {signal.reasoning && (
                      <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                        {signal.reasoning}
                      </div>
                    )}
                    {(signal.technical_score != null || signal.sentiment_score != null || signal.overall_score != null) && (
                      <div className="mt-2 space-y-1.5 rounded bg-gray-50 p-3">
                        <span className="text-xs font-medium text-gray-500">{t('stockAnalysis.multiFactorScore')}</span>
                        <ScoreBar label={t('stockAnalysis.technical')} score={signal.technical_score} />
                        <ScoreBar label={t('stockAnalysis.sentiment')} score={signal.sentiment_score} />
                        <ScoreBar label={t('stockAnalysis.overall')} score={signal.overall_score} />
                      </div>
                    )}
                    {chartSymbol === signal.symbol && (
                      <div className="mt-3">
                        <KlineChart
                          symbol={signal.symbol}
                          timeframe="daily"
                          indicators={['sma20', 'sma50', 'bollinger']}
                        />
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
