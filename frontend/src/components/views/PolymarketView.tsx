import { useState, useEffect, useCallback } from 'react';
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
      setError(`分析失败: ${(err as Error).message}`);
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
      setLastScan(`${result.signals.length} 信号, ${result.opportunities.length} 机会 (${(result.durationMs / 1000).toFixed(0)}s)`);
      if (result.errors.length > 0) {
        setError(`扫描完成，但有 ${result.errors.length} 个错误`);
      }
      await fetchMarkets();
      await fetchSignals();
    } catch (err) {
      setError(`扫描失败: ${(err as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const tabs: [Tab, string][] = [
    ['about', 'ℹ️ 关于'],
    ['markets', '📡 热门市场'],
    ['signals', '📊 AI 信号'],
    ['cron', '⏰ 定时任务'],
    ['settings', '⚙️ 通知设置'],
  ];

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
          {lastScan && <span className="text-xs text-gray-400">上次扫描: {lastScan}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFullScan}
            disabled={scanning}
            className="rounded-md bg-purple-500 px-3 py-1.5 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
            title="对所有热门市场批量运行 AI 概率分析，约需 1-2 分钟"
          >
            {scanning ? '⏳ 扫描中...' : '🔍 全量扫描'}
          </button>
          <button
            onClick={() => { fetchMarkets(); fetchSignals(); }}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
            title="刷新市场数据和 AI 信号"
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* Stats bar with tooltips */}
      <div className="flex gap-4 border-b border-gray-100 bg-gray-50 px-6 py-3">
        <StatBadge label="热门市场" value={markets.length} color="blue" tooltip="Polymarket 上按 24h 交易量排名的活跃预测市场数量" />
        <StatBadge label="AI 信号" value={signals.length} color="green" tooltip="AI 已分析并给出概率估计的市场数量（历史累计）" />
        <StatBadge label="+EV 机会" value={opportunities.length} color="amber" tooltip="AI 概率与市场概率差距 ≥ 5% 的潜在正期望值机会" />
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
const AboutPanel: React.FC = () => (
  <div className="space-y-6">
    {/* 产品介绍 */}
    <div className="rounded-lg border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        🔮 什么是 PolyOracle？
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        PolyOracle 是基于 OpenPilot 的 AI 预测市场分析助手。它自动扫描
        <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="mx-1 text-purple-600 underline">Polymarket</a>
        （全球最大的加密货币预测市场）上的热门事件，利用 AI 重新评估事件概率，
        找出市场可能存在的概率错配（+EV 机会）。
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FeatureCard emoji="📡" title="市场雷达" desc="实时扫描 Polymarket 热门市场，按交易量排序" />
        <FeatureCard emoji="🧠" title="AI 概率分析" desc="AI 独立评估事件概率，对比市场定价" />
        <FeatureCard emoji="⚡" title="+EV 机会检测" desc="当 AI 概率与市场概率差距 ≥ 5% 时标记为机会" />
      </div>
      <p className="mt-4 text-xs text-gray-400">
        ⚠️ 仅供分析参考，不构成投资建议。MVP 版本不包含任何交易功能。
      </p>
    </div>

    {/* 数据来源 */}
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        📊 数据来源
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        市场数据来自 Polymarket 官方的
        <a href="https://gamma-api.polymarket.com" target="_blank" rel="noopener noreferrer" className="mx-1 text-purple-600 underline">Gamma API</a>，
        实时获取市场价格、交易量和流动性数据。AI 分析使用配置的语言模型（默认 qwen3.5-flash）进行概率推理。
      </p>
    </div>

    {/* 指标说明 */}
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        📖 指标说明
      </h2>
      <div className="mt-3 space-y-3">
        <MetricExplain
          badge={<span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">市场: 55.0%</span>}
          title="市场概率"
          desc="Polymarket 上 YES 份额的当前价格，代表市场对事件发生的隐含概率。例如 55% 表示市场认为该事件有 55% 的概率发生。"
        />
        <MetricExplain
          badge={<span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">AI: 65.0%</span>}
          title="AI 概率"
          desc="AI 模型根据事件背景和当前信息独立评估的概率。这是 AI 认为的「真实概率」，可能高于或低于市场价格。"
        />
        <MetricExplain
          badge={<span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Edge: +10.0%</span>}
          title="Edge（优势）"
          desc="AI 概率减去市场概率的差值。正值表示 AI 认为市场低估了该事件（潜在买入 YES 机会），负值表示高估（潜在买入 NO 机会）。"
        />
        <MetricExplain
          badge={<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚡ +EV 机会</span>}
          title="+EV（正期望值）"
          desc="当 |Edge| ≥ 5% 时标记。+EV 表示如果 AI 的概率估计正确，长期重复下注该市场将获得正收益。Edge 越大，潜在机会越大。"
        />
        <MetricExplain
          badge={<span className="rounded bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600">置信度: medium</span>}
          title="置信度"
          desc="AI 对自身概率估计的信心程度。high = 信息充分、判断确定；medium = 有一定依据但存在不确定性；low = 信息不足、仅为粗略估计。"
        />
        <MetricExplain
          badge={<span className="text-xs text-gray-400">交易量: $106.9M · 24h: $10.0M · 流动性: $4.6M</span>}
          title="交易量 / 流动性"
          desc="交易量 = 该市场历史总交易额；24h = 最近 24 小时交易额（反映市场热度）；流动性 = 当前订单簿深度（越高滑点越小）。"
        />
      </div>
    </div>

    {/* 使用流程 */}
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
        🚀 使用流程
      </h2>
      <div className="mt-3 space-y-2 text-sm text-gray-600">
        <Step n={1} text="浏览「热门市场」Tab，查看 Polymarket 上交易量最大的预测市场" />
        <Step n={2} text="对感兴趣的市场点击「🧠 AI 分析」，AI 会给出独立的概率估计和推理" />
        <Step n={3} text="或点击右上角「🔍 全量扫描」，批量分析所有热门市场（约 1-2 分钟）" />
        <Step n={4} text="切到「AI 信号」Tab，按 Edge 排序查看所有分析结果，寻找 +EV 机会" />
        <Step n={5} text="在「⏰ 定时任务」Tab 可查看/控制自动扫描（默认每 4 小时一次）" />
        <Step n={6} text="在「⚙️ 通知设置」Tab 配置 Telegram/Discord 推送，自动接收 +EV 提醒" />
      </div>
    </div>
  </div>
);

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
  if (loading) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">正在从 Polymarket 获取热门市场数据...</div>;
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">📡</div>
        <p className="text-sm text-gray-500">暂无市场数据</p>
        <p className="mt-1 text-xs text-gray-400">请检查网络连接，或前往「ℹ️ 关于」了解更多</p>
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
                    title="在 Polymarket 上查看此市场"
                  >
                    {market.question}
                  </a>
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <ProbBadge label="市场" value={market.probability} color="blue" tooltip="Polymarket 当前 YES 价格（隐含概率）" />
                  {signal && <ProbBadge label="AI" value={signal.ai_probability} color="purple" tooltip="AI 模型独立评估的概率" />}
                  {edge !== null && (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${edge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                      title={`AI 概率 - 市场概率 = ${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%。${edge > 0 ? '正值表示 AI 认为市场低估' : '负值表示 AI 认为市场高估'}`}
                    >
                      Edge: {edge > 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
                    </span>
                  )}
                  {isOpportunity && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700" title="AI 与市场概率差距 ≥ 5%，可能存在正期望值机会">
                      ⚡ +EV 机会
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                  <span title="该市场历史总交易额">交易量: ${formatNumber(market.volume)}</span>
                  <span>·</span>
                  <span title="最近 24 小时交易额">24h: ${formatNumber(market.volume24hr)}</span>
                  <span>·</span>
                  <span title="当前订单簿深度">流动性: ${formatNumber(market.liquidity)}</span>
                  {market.endDate && (
                    <>
                      <span>·</span>
                      <span title="市场结算截止日期">截止: {new Date(market.endDate).toLocaleDateString()}</span>
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
                title="使用 AI 模型分析此市场的真实概率"
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
        <p className="mt-1 text-xs text-gray-400">在「热门市场」中点击「🧠 AI 分析」或使用「🔍 全量扫描」生成信号</p>
      </div>
    );
  }

  const sorted = [...signals].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
        💡 信号按 |Edge| 从大到小排序。Edge 绝对值越大，AI 认为市场定价偏差越大。橙色边框 = +EV 机会（|Edge| ≥ 5%）。
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
              <ProbBadge label="市场" value={signal.market_probability} color="blue" tooltip="分析时的市场概率" />
              <span className="text-gray-300">→</span>
              <ProbBadge label="AI" value={signal.ai_probability} color="purple" tooltip="AI 评估的概率" />
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${signal.edge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                title="AI 概率与市场概率的差值"
              >
                Edge: {signal.edge > 0 ? '+' : ''}{(signal.edge * 100).toFixed(1)}%
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  signal.confidence === 'high' ? 'bg-green-50 text-green-600' :
                  signal.confidence === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                  'bg-gray-50 text-gray-500'
                }`}
                title="AI 对自身判断的信心程度"
              >
                置信度: {signal.confidence}
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
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">加载定时任务...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
        💡 定时任务使用 cron 表达式调度。<code className="mx-1 rounded bg-blue-100 px-1">0 */4 * * *</code> 表示每 4 小时执行一次。
        任务会自动扫描热门市场并运行 AI 分析，结果保存到数据库。
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl">⏰</div>
          <p className="text-sm text-gray-500">暂无定时任务</p>
        </div>
      ) : (
        jobs.map(job => (
          <div key={job.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-800">{job.name}</h3>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  <span title="Cron 表达式">📅 {job.schedule}</span>
                  <span title="执行的处理器">🔧 {job.handler}</span>
                  <span className={`rounded px-1.5 py-0.5 ${job.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {job.enabled ? '已启用' : '已禁用'}
                  </span>
                </div>
                {job.lastRunAt && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    <span>上次运行: {new Date(job.lastRunAt * 1000).toLocaleString()}</span>
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
                  {job.enabled ? '禁用' : '启用'}
                </button>
                <button
                  onClick={() => handleTrigger(job.id)}
                  disabled={triggering === job.id}
                  className="rounded-md bg-purple-500 px-3 py-1 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
                >
                  {triggering === job.id ? '运行中...' : '▶ 立即运行'}
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
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">加载配置...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 通知推送 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-800">🔔 通知推送</h2>
        <p className="mt-1 text-xs text-gray-500">
          当 AI 扫描发现 +EV 机会时，自动推送到你的 Telegram 或 Discord。需要先在「渠道配置」中连接对应的 Bot。
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
            <span className="text-sm text-gray-700">启用通知推送</span>
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
                  placeholder="例如: 123456789"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  向你的 Telegram Bot 发送任意消息，然后在聊天中发送 /start 获取 Chat ID。
                  也可以将 Bot 加入群组，使用群组的 Chat ID。
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
                  placeholder="例如: 1234567890123456789"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  在 Discord 中右键点击频道 → 复制频道 ID（需开启开发者模式）。
                </p>
              </div>

              {/* Min Edge */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">最小 Edge 阈值 (%)</label>
                  <input
                    type="number"
                    value={minEdge}
                    onChange={e => setMinEdge(e.target.value)}
                    min="1"
                    max="50"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">只推送 |Edge| ≥ 此值的信号</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">去重窗口 (小时)</label>
                  <input
                    type="number"
                    value={dedupHours}
                    onChange={e => setDedupHours(e.target.value)}
                    min="1"
                    max="168"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">同一市场在此时间内不重复推送</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 扫描配置 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-800">📡 扫描配置</h2>
        <p className="mt-1 text-xs text-gray-500">控制市场扫描的参数。</p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">扫描市场数量</label>
            <input
              type="number"
              value={scanLimit}
              onChange={e => setScanLimit(e.target.value)}
              min="1"
              max="50"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <p className="mt-1 text-xs text-gray-400">每次扫描分析的市场数量上限</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">最小交易量 ($)</label>
            <input
              type="number"
              value={minVolume}
              onChange={e => setMinVolume(e.target.value)}
              min="0"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <p className="mt-1 text-xs text-gray-400">过滤掉交易量低于此值的市场</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700">AI 分析模型（可选）</label>
          <input
            type="text"
            value={scanModel}
            onChange={e => setScanModel(e.target.value)}
            placeholder="留空自动选择，例如: qwen/qwen3.5-flash"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <p className="mt-1 text-xs text-gray-400">指定用于概率分析的模型。留空则自动选择已配置的模型。</p>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-purple-500 px-4 py-2 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {saving ? '保存中...' : '💾 保存配置'}
        </button>
        {saved && <span className="text-sm text-green-600">✅ 已保存（重启后生效）</span>}
        {error && <span className="text-sm text-red-600">❌ {error}</span>}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        ⚠️ 通知配置保存后，需要重启服务才能完全生效。扫描配置（市场数量、交易量阈值）会在下次扫描时立即生效。
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
