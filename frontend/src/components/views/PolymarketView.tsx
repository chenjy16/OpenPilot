import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post, put } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  handler: string;
  enabled: boolean;
  lastRunAt?: number;
  lastStatus?: string;
  lastError?: string;
  createdAt: number;
}

type Tab = 'about' | 'markets' | 'signals' | 'cron' | 'settings';

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const PolymarketView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('markets');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

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
      setError(t('polymarket.analyzeFailed', { message: (err as Error).message }));
    } finally {
      setAnalyzing(null);
    }
  };

  const opportunities = signals.filter(s => Math.abs(s.edge) >= 0.05);

  const handleFullScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await post<{ markets: any[]; signals: any[]; opportunities: any[]; errors: string[]; durationMs: number }>('/polymarket/scan', {});
      setLastScan(t('polymarket.scanResult', { signals: result.signals.length, opportunities: result.opportunities.length, duration: (result.durationMs / 1000).toFixed(0) }));
      if (result.errors.length > 0) {
        setError(t('polymarket.scanCompleteWithErrors', { count: result.errors.length }));
      }
      await fetchMarkets();
      await fetchSignals();
    } catch (err) {
      setError(t('polymarket.scanFailed', { message: (err as Error).message }));
    } finally {
      setScanning(false);
    }
  };

  const tabs: [Tab, string][] = [
    ['about', t('polymarket.tabAbout')],
    ['markets', t('polymarket.tabMarkets')],
    ['signals', t('polymarket.tabSignals')],
    ['cron', t('polymarket.tabCron')],
    ['settings', t('polymarket.tabSettings')],
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔮</span>
          <h1 className="text-lg font-semibold text-gray-800">PolyOracle</h1>
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
            {t('polymarket.aiPredictionAnalysis')}
          </span>
          {lastScan && <span className="text-xs text-gray-400">{t('polymarket.lastScan', { result: lastScan })}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFullScan}
            disabled={scanning}
            className="rounded-md bg-purple-500 px-3 py-1.5 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
            title={t('polymarket.scanBatchTooltip')}
          >
            {scanning ? t('polymarket.scanning') : t('polymarket.fullScan')}
          </button>
          <button
            onClick={() => { fetchMarkets(); fetchSignals(); }}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
            title={t('polymarket.refreshTooltip')}
          >
            {t('polymarket.refresh')}
          </button>
        </div>
      </div>

      {/* Stats bar with tooltips */}
      <div className="flex gap-4 border-b border-gray-100 bg-gray-50 px-6 py-3">
        <StatBadge label={t('polymarket.hotMarkets')} value={markets.length} color="blue" tooltip={t('polymarket.hotMarketsTooltip')} />
        <StatBadge label={t('polymarket.aiSignals')} value={signals.length} color="green" tooltip={t('polymarket.aiSignalsTooltip')} />
        <StatBadge label={t('polymarket.evOpportunities')} value={opportunities.length} color="amber" tooltip={t('polymarket.evOpportunitiesTooltip')} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-6">
        {tabs.map(([id, label]) => (
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
        {tab === 'about' && <AboutPanel />}
        {tab === 'markets' && (
          <MarketsPanel markets={markets} signals={signals} loading={loading} analyzing={analyzing} onAnalyze={handleAnalyze} />
        )}
        {tab === 'signals' && <SignalsPanel signals={signals} />}
        {tab === 'cron' && <CronPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// About Panel — 产品介绍 + 指标说明
// ---------------------------------------------------------------------------
const AboutPanel: React.FC = () => {
  const { t } = useTranslation();
  return (
  <div className="space-y-6">
    {/* 产品介绍 */}
    <div className="rounded-lg border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        {t('polymarket.whatIsPolyOracle')}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        {t('polymarket.polyOracleDesc')}
        <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="mx-1 text-purple-600 underline">Polymarket</a>
        {t('polymarket.polyOracleDesc2')}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FeatureCard emoji="📡" title={t('polymarket.featureRadar')} desc={t('polymarket.featureRadarDesc')} />
        <FeatureCard emoji="🧠" title={t('polymarket.featureAiAnalysis')} desc={t('polymarket.featureAiAnalysisDesc')} />
        <FeatureCard emoji="⚡" title={t('polymarket.featureEvDetection')} desc={t('polymarket.featureEvDetectionDesc')} />
      </div>
      <p className="mt-4 text-xs text-gray-400">
        {t('polymarket.disclaimer')}
      </p>
    </div>

    {/* 数据来源 */}
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        {t('polymarket.dataSource')}
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        {t('polymarket.dataSourceDesc')}
        <a href="https://gamma-api.polymarket.com" target="_blank" rel="noopener noreferrer" className="mx-1 text-purple-600 underline">Gamma API</a>
        {t('polymarket.dataSourceDesc2')}
      </p>
    </div>

    {/* 指标说明 */}
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        {t('polymarket.metricsGuide')}
      </h2>
      <div className="mt-3 space-y-3">
        <MetricExplain
          badge={<span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{t('polymarket.marketProbLabel')}</span>}
          title={t('polymarket.marketProbTitle')}
          desc={t('polymarket.marketProbDesc')}
        />
        <MetricExplain
          badge={<span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">{t('polymarket.aiProbLabel')}</span>}
          title={t('polymarket.aiProbTitle')}
          desc={t('polymarket.aiProbDesc')}
        />
        <MetricExplain
          badge={<span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{t('polymarket.edgeLabel')}</span>}
          title={t('polymarket.edgeTitle')}
          desc={t('polymarket.edgeDesc')}
        />
        <MetricExplain
          badge={<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{t('polymarket.evLabel')}</span>}
          title={t('polymarket.evTitle')}
          desc={t('polymarket.evDesc')}
        />
        <MetricExplain
          badge={<span className="rounded bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600">{t('polymarket.confidenceLabel')}</span>}
          title={t('polymarket.confidenceTitle')}
          desc={t('polymarket.confidenceDesc')}
        />
        <MetricExplain
          badge={<span className="text-xs text-gray-400">{t('polymarket.volumeLabel')}</span>}
          title={t('polymarket.volumeTitle')}
          desc={t('polymarket.volumeDesc')}
        />
      </div>
    </div>

    {/* 使用流程 */}
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        {t('polymarket.usageFlow')}
      </h2>
      <div className="mt-3 space-y-2 text-sm text-gray-600">
        <Step n={1} text={t('polymarket.step1')} />
        <Step n={2} text={t('polymarket.step2')} />
        <Step n={3} text={t('polymarket.step3')} />
        <Step n={4} text={t('polymarket.step4')} />
        <Step n={5} text={t('polymarket.step5')} />
        <Step n={6} text={t('polymarket.step6')} />
      </div>
    </div>
  </div>
);
};

const FeatureCard: React.FC<{ emoji: string; title: string; desc: string }> = ({ emoji, title, desc }) => (
  <div className="rounded-lg border border-gray-100 bg-white p-3">
    <div className="text-lg">{emoji}</div>
    <div className="mt-1 text-sm font-medium text-gray-700">{title}</div>
    <div className="mt-0.5 text-xs text-gray-500">{desc}</div>
  </div>
);

const MetricExplain: React.FC<{ badge: React.ReactNode; title: string; desc: string }> = ({ badge, title, desc }) => (
  <div className="flex gap-3">
    <div className="flex-shrink-0 pt-0.5">{badge}</div>
    <div>
      <div className="text-sm font-medium text-gray-700">{title}</div>
      <div className="text-xs text-gray-500">{desc}</div>
    </div>
  </div>
);

const Step: React.FC<{ n: number; text: string }> = ({ n, text }) => (
  <div className="flex items-start gap-2">
    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-medium text-purple-700">{n}</span>
    <span>{text}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Markets Panel (with tooltip hints)
// ---------------------------------------------------------------------------
const MarketsPanel: React.FC<{
  markets: Market[];
  signals: Signal[];
  loading: boolean;
  analyzing: string | null;
  onAnalyze: (m: Market) => void;
}> = ({ markets, signals, loading, analyzing, onAnalyze }) => {
  const { t } = useTranslation();
  if (loading) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">{t('polymarket.loadingMarkets')}</div>;
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">📡</div>
        <p className="text-sm text-gray-500">{t('polymarket.noMarketData')}</p>
        <p className="mt-1 text-xs text-gray-400">{t('polymarket.noMarketDataHint')}</p>
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
                <h3 className="text-sm font-medium text-gray-800">
                  <a
                    href={`https://polymarket.com/event/${market.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-purple-600 hover:underline"
                    title={t('polymarket.viewOnPolymarket')}
                  >
                    {market.question}
                  </a>
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <ProbBadge label={t('polymarket.market')} value={market.probability} color="blue" tooltip={t('polymarket.marketProbTooltip')} />
                  {signal && <ProbBadge label={t('polymarket.ai')} value={signal.ai_probability} color="purple" tooltip={t('polymarket.aiProbTooltip')} />}
                  {edge !== null && (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${edge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                      title={`${t(edge > 0 ? 'polymarket.edgeTooltipPositive' : 'polymarket.edgeTooltipNegative', { edge: `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}` })}`}
                    >
                      Edge: {edge > 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
                    </span>
                  )}
                  {isOpportunity && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700" title={t('polymarket.evOpportunityTooltip')}>
                      {t('polymarket.evOpportunityBadge')}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                  <span title={t('polymarket.volumeTooltip')}>{t('polymarket.volume')}: ${formatNumber(market.volume)}</span>
                  <span>·</span>
                  <span title={t('polymarket.volume24hTooltip')}>{t('polymarket.volume24h')}: ${formatNumber(market.volume24hr)}</span>
                  <span>·</span>
                  <span title={t('polymarket.liquidityTooltip')}>{t('polymarket.liquidity')}: ${formatNumber(market.liquidity)}</span>
                  {market.endDate && (
                    <>
                      <span>·</span>
                      <span title={t('polymarket.deadlineTooltip')}>{t('polymarket.deadline')}: {new Date(market.endDate).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
                {signal?.reasoning && (
                  <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                    <span className="font-medium text-gray-500">{t('polymarket.aiAnalysisLabel')}</span>
                    {signal.reasoning}
                  </div>
                )}
              </div>
              <button
                onClick={() => onAnalyze(market)}
                disabled={analyzing === market.id}
                className="flex-shrink-0 rounded-md bg-purple-500 px-3 py-1.5 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
                title={t('polymarket.analyzeTooltip')}
              >
                {analyzing === market.id ? t('polymarket.analyzing') : t('polymarket.aiAnalyze')}
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
  const { t } = useTranslation();
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">📊</div>
        <p className="text-sm text-gray-500">{t('polymarket.noSignals')}</p>
        <p className="mt-1 text-xs text-gray-400">{t('polymarket.noSignalsHint')}</p>
      </div>
    );
  }

  const sorted = [...signals].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
        {t('polymarket.signalSortHint')}
      </div>
      {sorted.map(signal => {
        const isOpportunity = Math.abs(signal.edge) >= 0.05;
        return (
          <div
            key={signal.id}
            className={`rounded-lg border bg-white p-4 ${isOpportunity ? 'border-amber-300' : 'border-gray-200'}`}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-sm font-medium text-gray-800">{signal.question}</h3>
              {isOpportunity && (
                <span className="flex-shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚡ +EV</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <ProbBadge label={t('polymarket.market')} value={signal.market_probability} color="blue" tooltip={t('polymarket.marketProbAtAnalysis')} />
              <span className="text-gray-300">→</span>
              <ProbBadge label={t('polymarket.ai')} value={signal.ai_probability} color="purple" tooltip={t('polymarket.aiAssessedProb')} />
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${signal.edge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                title={t('polymarket.edgeDiffTooltip')}
              >
                Edge: {signal.edge > 0 ? '+' : ''}{(signal.edge * 100).toFixed(1)}%
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  signal.confidence === 'high' ? 'bg-green-50 text-green-600' :
                  signal.confidence === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                  'bg-gray-50 text-gray-500'
                }`}
                title={t('polymarket.confidenceTooltip')}
              >
                {t('polymarket.confidence')}: {signal.confidence}
              </span>
            </div>
            {signal.reasoning && (
              <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">{signal.reasoning}</div>
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
// Cron Panel
// ---------------------------------------------------------------------------
const CronPanel: React.FC = () => {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await get<CronJob[]>('/cron/scheduler/jobs');
      setJobs(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleTrigger = async (jobId: string) => {
    setTriggering(jobId);
    try {
      await post(`/cron/scheduler/jobs/${jobId}/trigger`, {});
      await fetchJobs();
    } catch { /* ignore */ }
    finally { setTriggering(null); }
  };

  const handleToggle = async (job: CronJob) => {
    try {
      await put(`/cron/scheduler/jobs/${job.id}`, { enabled: !job.enabled });
      await fetchJobs();
    } catch { /* ignore */ }
  };

  if (loading) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">{t('polymarket.loadingCron')}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
        {t('polymarket.cronHint')}
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl">⏰</div>
          <p className="text-sm text-gray-500">{t('polymarket.noCronJobs')}</p>
        </div>
      ) : (
        jobs.map(job => (
          <div key={job.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-800">{job.name}</h3>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  <span title={t('polymarket.cronScheduleTooltip')}>📅 {job.schedule}</span>
                  <span title={t('polymarket.cronHandlerTooltip')}>🔧 {job.handler}</span>
                  <span className={`rounded px-1.5 py-0.5 ${job.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {job.enabled ? t('polymarket.cronEnabled') : t('polymarket.cronDisabled')}
                  </span>
                </div>
                {job.lastRunAt && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    <span>{t('polymarket.cronLastRun', { time: new Date(job.lastRunAt * 1000).toLocaleString() })}</span>
                    <span className={`rounded px-1.5 py-0.5 ${
                      job.lastStatus === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                    }`}>
                      {job.lastStatus}
                    </span>
                  </div>
                )}
                {job.lastError && <div className="mt-1 text-xs text-red-500">{job.lastError}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(job)}
                  className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
                >
                  {job.enabled ? t('polymarket.cronDisable') : t('polymarket.cronEnable')}
                </button>
                <button
                  onClick={() => handleTrigger(job.id)}
                  disabled={triggering === job.id}
                  className="rounded-md bg-purple-500 px-3 py-1 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
                >
                  {triggering === job.id ? t('polymarket.cronRunning') : t('polymarket.cronRunNow')}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Settings Panel — 通知推送配置 UI
// ---------------------------------------------------------------------------
const SettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordChannelId, setDiscordChannelId] = useState('');
  const [minEdge, setMinEdge] = useState('10');
  const [dedupHours, setDedupHours] = useState('24');
  const [scanLimit, setScanLimit] = useState('10');
  const [minVolume, setMinVolume] = useState('50000');
  const [scanModel, setScanModel] = useState('');

  // Load current config
  useEffect(() => {
    (async () => {
      try {
        const config = await get<any>('/config');
        const poly = config?.polymarket ?? {};
        const notify = poly?.notify ?? {};
        setNotifyEnabled(!!notify.enabled);
        setTelegramChatId(notify.telegram?.chatId ?? '');
        setDiscordChannelId(notify.discord?.channelId ?? '');
        setMinEdge(String((notify.minEdge ?? 0.10) * 100));
        setDedupHours(String(notify.dedupHours ?? 24));
        setScanLimit(String(poly.scanLimit ?? 10));
        setMinVolume(String(poly.minVolume ?? 50000));
        setScanModel(poly.model ?? '');
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await put('/config', {
        polymarket: {
          enabled: true,
          scanLimit: Number(scanLimit) || 10,
          minVolume: Number(minVolume) || 50000,
          model: scanModel || undefined,
          notify: {
            enabled: notifyEnabled,
            telegram: telegramChatId ? { chatId: telegramChatId } : undefined,
            discord: discordChannelId ? { channelId: discordChannelId } : undefined,
            minEdge: (Number(minEdge) || 10) / 100,
            dedupHours: Number(dedupHours) || 24,
          },
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">{t('polymarket.loadingConfig')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* 通知推送 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-800">{t('polymarket.notificationPush')}</h2>
        <p className="mt-1 text-xs text-gray-500">
          {t('polymarket.notificationDesc')}
        </p>

        <div className="mt-4 space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={notifyEnabled}
              onChange={e => setNotifyEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-purple-600"
            />
            <span className="text-sm text-gray-700">{t('polymarket.enableNotification')}</span>
          </label>

          {notifyEnabled && (
            <>
              {/* Telegram */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  ✈️ Telegram Chat ID
                </label>
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={e => setTelegramChatId(e.target.value)}
                  placeholder={t('polymarket.telegramPlaceholder')}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {t('polymarket.telegramHint')}
                </p>
              </div>

              {/* Discord */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  🎮 Discord Channel ID
                </label>
                <input
                  type="text"
                  value={discordChannelId}
                  onChange={e => setDiscordChannelId(e.target.value)}
                  placeholder={t('polymarket.discordPlaceholder')}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {t('polymarket.discordHint')}
                </p>
              </div>

              {/* Min Edge */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('polymarket.minEdgeThreshold')}</label>
                  <input
                    type="number"
                    value={minEdge}
                    onChange={e => setMinEdge(e.target.value)}
                    min="1"
                    max="50"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">{t('polymarket.minEdgeHint')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('polymarket.dedupWindow')}</label>
                  <input
                    type="number"
                    value={dedupHours}
                    onChange={e => setDedupHours(e.target.value)}
                    min="1"
                    max="168"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">{t('polymarket.dedupWindowHint')}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 扫描配置 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-800">{t('polymarket.scanConfig')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t('polymarket.scanConfigDesc')}</p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">{t('polymarket.scanMarketCount')}</label>
            <input
              type="number"
              value={scanLimit}
              onChange={e => setScanLimit(e.target.value)}
              min="1"
              max="50"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <p className="mt-1 text-xs text-gray-400">{t('polymarket.scanMarketCountHint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{t('polymarket.minVolume')}</label>
            <input
              type="number"
              value={minVolume}
              onChange={e => setMinVolume(e.target.value)}
              min="0"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <p className="mt-1 text-xs text-gray-400">{t('polymarket.minVolumeHint')}</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700">{t('polymarket.aiModel')}</label>
          <input
            type="text"
            value={scanModel}
            onChange={e => setScanModel(e.target.value)}
            placeholder={t('polymarket.aiModelPlaceholder')}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <p className="mt-1 text-xs text-gray-400">{t('polymarket.aiModelHint')}</p>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-purple-500 px-4 py-2 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {saving ? t('polymarket.saving') : t('polymarket.saveConfig')}
        </button>
        {saved && <span className="text-sm text-green-600">{t('polymarket.savedSuccess')}</span>}
        {error && <span className="text-sm text-red-600">❌ {error}</span>}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        {t('polymarket.configWarning')}
      </div>
    </div>
  );
};

/* ─── Helper Components ─── */

const StatBadge = ({ label, value, color, tooltip }: { label: string; value: number; color: string; tooltip?: string }) => {
  const colors: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    purple: 'bg-purple-100 text-purple-700',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors[color] || colors.blue}`} title={tooltip}>
      {label}: {value}
    </span>
  );
};

const ProbBadge = ({ label, value, color, tooltip }: { label: string; value: number; color: string; tooltip?: string }) => {
  const colors: Record<string, string> = {
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    green: 'text-green-600',
  };
  return (
    <span className={`text-sm font-medium ${colors[color] || colors.blue}`} title={tooltip}>
      {label}: {(value * 100).toFixed(1)}%
    </span>
  );
};

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
};

export default PolymarketView;
