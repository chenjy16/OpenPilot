import { useState, useEffect, useCallback } from 'react';
import { get, put, post } from '../../services/apiClient';
import type { SkillStatusReport, CommunitySkillResult, CommunityInstallResult } from '../../types';

const SOURCE_LABELS: Record<string, string> = {
  bundled: '内置', managed: '托管', workspace: '工作区',
  'workspace-openpilot': '工作区', 'agents-personal': '个人', 'agents-project': '项目',
};
const SOURCE_ORDER = ['托管', '内置', '工作区', '个人', '项目'];
type TabKey = 'local' | 'community';

const SkillsView: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('local');
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
        <span className="text-2xl">⚡</span>
        <div>
          <h1 className="text-lg font-semibold text-gray-800">技能管理</h1>
          <p className="text-xs text-gray-400">本地技能 &amp; 社区技能</p>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-gray-300 text-sm">
          <button onClick={() => setTab('local')}
            className={`px-4 py-1.5 rounded-l-lg ${tab === 'local' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >本地</button>
          <button onClick={() => setTab('community')}
            className={`px-4 py-1.5 rounded-r-lg ${tab === 'community' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >社区</button>
        </div>
      </div>
      {tab === 'local' ? <LocalSkillsTab /> : <CommunitySkillsTab />}
    </div>
  );
};

// ============================================================
// Local Skills Tab
// ============================================================
const LocalSkillsTab: React.FC = () => {
  const [skills, setSkills] = useState<SkillStatusReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});

  const fetchSkills = useCallback(async (clearMsgs = false) => {
    try { setLoading(true); const d = await get<SkillStatusReport[]>('/skills/status'); setSkills(d); setError(null); if (clearMsgs) setMessages({}); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const filtered = skills.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const grouped = new Map<string, SkillStatusReport[]>();
  for (const s of filtered) { const k = SOURCE_LABELS[s.source] || s.source; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k)!.push(s); }
  const sortedGroups = Array.from(grouped.entries()).sort(([a], [b]) => (SOURCE_ORDER.indexOf(a) === -1 ? 99 : SOURCE_ORDER.indexOf(a)) - (SOURCE_ORDER.indexOf(b) === -1 ? 99 : SOURCE_ORDER.indexOf(b)));

  const handleToggle = async (s: SkillStatusReport) => { setBusyKey(s.name); try { await put(`/skills/${encodeURIComponent(s.name)}`, { enabled: !s.enabled }); setMessages(m => ({ ...m, [s.name]: { text: s.enabled ? '已禁用' : '已启用', ok: true } })); await fetchSkills(); } catch (e: any) { setMessages(m => ({ ...m, [s.name]: { text: e.message, ok: false } })); } finally { setBusyKey(null); } };
  const handleSaveApiKey = async (s: SkillStatusReport) => { const k = apiKeyEdits[s.name]; if (!k) return; setBusyKey(s.name); try { await put(`/skills/${encodeURIComponent(s.name)}`, { apiKey: k }); setMessages(m => ({ ...m, [s.name]: { text: 'API Key 已保存', ok: true } })); setApiKeyEdits(e => { const n = { ...e }; delete n[s.name]; return n; }); await fetchSkills(); } catch (e: any) { setMessages(m => ({ ...m, [s.name]: { text: e.message, ok: false } })); } finally { setBusyKey(null); } };
  const handleInstall = async (s: SkillStatusReport) => { setBusyKey(s.name); try { const r = await post<{ message: string }>(`/skills/${encodeURIComponent(s.name)}/install`, {}); setMessages(m => ({ ...m, [s.name]: { text: r.message || '安装已启动', ok: true } })); await fetchSkills(); } catch (e: any) { setMessages(m => ({ ...m, [s.name]: { text: e.message, ok: false } })); } finally { setBusyKey(null); } };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-2">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索本地技能..."
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-xs text-gray-400">{filtered.length} 项</span>
        <button onClick={() => fetchSkills(true)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">刷新</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {loading && <p className="text-sm text-gray-500">加载中...</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && filtered.length === 0 && <div className="flex h-40 items-center justify-center text-sm text-gray-400">{search ? '没有匹配的技能' : '暂无已加载的技能'}</div>}
        {sortedGroups.map(([source, items], gi) => (
          <SkillGroup key={source} source={source} items={items} defaultOpen={gi === 0}
            busyKey={busyKey} messages={messages} apiKeyEdits={apiKeyEdits}
            onToggle={handleToggle} onSaveApiKey={handleSaveApiKey} onInstall={handleInstall}
            onApiKeyChange={(n, v) => setApiKeyEdits(e => ({ ...e, [n]: v }))} />
        ))}
      </div>
    </>
  );
};

// ============================================================
// Community Skills Tab (ClawHub default + SkillsMP optional)
// ============================================================
const CommunitySkillsTab: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommunitySkillResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [hotSort, setHotSort] = useState<'downloads' | 'stars'>('downloads');
  const [mode, setMode] = useState<'hot' | 'search'>('hot');

  // Load hot skills on mount
  const loadHot = useCallback(async (sort: 'downloads' | 'stars' = hotSort) => {
    setLoading(true); setError(null); setMode('hot');
    try {
      const d = await get<{ results: CommunitySkillResult[]; total: number }>(`/skills/community/hot?sort=${sort}&limit=18`);
      setResults(d.results || []); setTotal(d.total || 0);
    } catch (e: any) { setError(e.message); setResults([]); }
    finally { setLoading(false); }
  }, [hotSort]);

  useEffect(() => { loadHot(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async () => {
    if (!query.trim()) { loadHot(); return; }
    setLoading(true); setError(null); setMode('search');
    try {
      const d = await get<{ results: CommunitySkillResult[]; total: number }>(
        `/skills/community/search?q=${encodeURIComponent(query)}&source=clawhub&limit=20`
      );
      setResults(d.results || []); setTotal(d.total || 0);
    } catch (e: any) { setError(e.message); setResults([]); }
    finally { setLoading(false); }
  }, [query, loadHot]);

  const handleInstall = async (skill: CommunitySkillResult) => {
    setBusySlug(skill.slug);
    try {
      const r = await post<CommunityInstallResult>(
        `/skills/community/${encodeURIComponent(skill.slug)}/install`,
        { source: skill.source }
      );
      setMessages(m => ({ ...m, [skill.slug]: { text: r.ok ? (r.message || '安装成功') : (r.message || '安装失败'), ok: r.ok } }));
    } catch (e: any) {
      setMessages(m => ({ ...m, [skill.slug]: { text: e.message, ok: false } }));
    } finally { setBusySlug(null); }
  };

  const handleSortChange = (s: 'downloads' | 'stars') => { setHotSort(s); loadHot(s); };

  return (
    <>
      {/* Search bar */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-3">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="搜索 ClawHub 社区技能..."
          className="flex-1 max-w-md rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={doSearch} disabled={loading}
          className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50">
          {loading ? '搜索中...' : '搜索'}
        </button>
        {mode === 'search' && (
          <button onClick={() => { setQuery(''); loadHot(); }}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200">
            返回热门
          </button>
        )}
        <span className="text-xs text-gray-400">{total} 项</span>
      </div>

      {/* Sort tabs for hot mode */}
      {mode === 'hot' && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-50">
          <span className="text-xs text-gray-400">排序:</span>
          <button onClick={() => handleSortChange('downloads')}
            className={`rounded px-2 py-0.5 text-xs ${hotSort === 'downloads' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            🔥 下载量
          </button>
          <button onClick={() => handleSortChange('stars')}
            className={`rounded px-2 py-0.5 text-xs ${hotSort === 'stars' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            ⭐ 星标
          </button>
          <div className="flex-1" />
          <span className="text-xs text-gray-300">数据来源: ClawHub (clawhub.ai)</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
        {!loading && results.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-gray-400">
            {mode === 'search' ? '没有找到匹配的社区技能' : '加载中...'}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map(skill => (
            <CommunitySkillCard key={skill.slug} skill={skill}
              busy={busySlug === skill.slug} message={messages[skill.slug]}
              onInstall={() => handleInstall(skill)} />
          ))}
        </div>
      </div>
    </>
  );
};

// ============================================================
// Community Skill Card
// ============================================================
interface CommunitySkillCardProps {
  skill: CommunitySkillResult;
  busy: boolean;
  message?: { text: string; ok: boolean };
  onInstall: () => void;
}

const CommunitySkillCard: React.FC<CommunitySkillCardProps> = ({ skill, busy, message, onInstall }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-gray-800">{skill.name}</h3>
        {skill.author && <p className="text-xs text-gray-400">{skill.author}</p>}
      </div>
      {skill.version && (
        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">v{skill.version}</span>
      )}
    </div>
    <p className="mt-1.5 line-clamp-2 text-xs text-gray-500">{skill.description || '暂无描述'}</p>
    <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
      {typeof skill.downloads === 'number' && <span>📥 {skill.downloads.toLocaleString()}</span>}
      {typeof skill.stars === 'number' && <span>⭐ {skill.stars}</span>}
      {skill.source === 'skillsmp' && <span className="rounded bg-purple-50 px-1 text-purple-500">SkillsMP</span>}
    </div>
    {skill.tags && skill.tags.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-1">
        {skill.tags.slice(0, 4).map(t => (
          <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{t}</span>
        ))}
      </div>
    )}
    <div className="mt-3 flex items-center justify-between">
      <button onClick={onInstall} disabled={busy}
        className="rounded-lg bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-50">
        {busy ? '安装中...' : '安装'}
      </button>
      {message && (
        <span className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-500'}`}>{message.text}</span>
      )}
    </div>
  </div>
);

// ============================================================
// Skill Group (collapsible, for local tab)
// ============================================================
interface SkillGroupProps {
  source: string;
  items: SkillStatusReport[];
  defaultOpen: boolean;
  busyKey: string | null;
  messages: Record<string, { text: string; ok: boolean }>;
  apiKeyEdits: Record<string, string>;
  onToggle: (s: SkillStatusReport) => void;
  onSaveApiKey: (s: SkillStatusReport) => void;
  onInstall: (s: SkillStatusReport) => void;
  onApiKeyChange: (name: string, value: string) => void;
}

const SkillGroup: React.FC<SkillGroupProps> = ({
  source, items, defaultOpen, busyKey, messages, apiKeyEdits,
  onToggle, onSaveApiKey, onInstall, onApiKeyChange,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
        <span className="text-xs">{open ? '▼' : '▶'}</span>
        <span>{source}</span>
        <span className="text-xs text-gray-400">({items.length})</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 pl-2">
          {items.map(s => (
            <SkillCard key={s.name} skill={s} busy={busyKey === s.name}
              message={messages[s.name]} apiKeyEdit={apiKeyEdits[s.name] ?? ''}
              onToggle={() => onToggle(s)} onSaveApiKey={() => onSaveApiKey(s)}
              onInstall={() => onInstall(s)}
              onApiKeyChange={v => onApiKeyChange(s.name, v)} />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Local Skill Card
// ============================================================
interface SkillCardProps {
  skill: SkillStatusReport;
  busy: boolean;
  message?: { text: string; ok: boolean };
  apiKeyEdit: string;
  onToggle: () => void;
  onSaveApiKey: () => void;
  onInstall: () => void;
  onApiKeyChange: (v: string) => void;
}

const SkillCard: React.FC<SkillCardProps> = ({
  skill, busy, message, apiKeyEdit, onToggle, onSaveApiKey, onInstall, onApiKeyChange,
}) => {
  const hasMissing = skill.missing && (skill.missing.bins.length > 0 || skill.missing.env.length > 0 || skill.missing.config.length > 0);
  const needsApiKey = skill.missing && skill.missing.env.length > 0;
  return (
    <div className={`rounded-lg border px-4 py-3 ${skill.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center gap-3">
        <span className="text-lg">{skill.emoji || '📦'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-800">{skill.name}</span>
            {hasMissing && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-700">缺少依赖</span>}
          </div>
          <p className="truncate text-xs text-gray-400">{skill.filePath}</p>
        </div>
        <div className="flex items-center gap-2">
          {skill.installSpecs && skill.installSpecs.length > 0 && hasMissing && (
            <button onClick={onInstall} disabled={busy}
              className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
              {busy ? '...' : '安装依赖'}
            </button>
          )}
          <button onClick={onToggle} disabled={busy}
            className={`rounded-full px-3 py-1 text-xs ${skill.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>
            {skill.enabled ? '已启用' : '已禁用'}
          </button>
        </div>
      </div>
      {needsApiKey && (
        <div className="mt-2 flex items-center gap-2">
          <input type="password" value={apiKeyEdit} onChange={e => onApiKeyChange(e.target.value)}
            placeholder={`设置 ${skill.missing!.env[0]} ...`}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={onSaveApiKey} disabled={busy || !apiKeyEdit}
            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">保存</button>
        </div>
      )}
      {message && <p className={`mt-1 text-xs ${message.ok ? 'text-green-600' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  );
};

export default SkillsView;
