import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, put, post } from '../../services/apiClient';
import type { SkillStatusReport, CommunitySkillResult, CommunityInstallResult } from '../../types';

const SOURCE_KEYS: Record<string, string> = {
  bundled: 'bundled', managed: 'managed', workspace: 'workspace',
  'workspace-openpilot': 'workspace', 'agents-personal': 'personal', 'agents-project': 'project',
};
const SOURCE_ORDER_KEYS = ['managed', 'bundled', 'workspace', 'personal', 'project'];
type TabKey = 'local' | 'community';

const SkillsView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('local');
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
        <span className="text-2xl">⚡</span>
        <div>
          <h1 className="text-lg font-semibold text-gray-800">{t('skills.title')}</h1>
          <p className="text-xs text-gray-400">{t('skills.subtitle')}</p>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-gray-300 text-sm">
          <button onClick={() => setTab('local')}
            className={`px-4 py-1.5 rounded-l-lg ${tab === 'local' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >{t('skills.local')}</button>
          <button onClick={() => setTab('community')}
            className={`px-4 py-1.5 rounded-r-lg ${tab === 'community' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >{t('skills.community')}</button>
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
  const { t } = useTranslation();
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
  for (const s of filtered) { const k = SOURCE_KEYS[s.source] || s.source; const label = t(`skills.source${k.charAt(0).toUpperCase() + k.slice(1)}` as any) as string; if (!grouped.has(label)) grouped.set(label, []); grouped.get(label)!.push(s); }
  const sourceOrderLabels = SOURCE_ORDER_KEYS.map(k => t(`skills.source${k.charAt(0).toUpperCase() + k.slice(1)}` as any) as string);
  const sortedGroups = Array.from(grouped.entries()).sort(([a], [b]) => (sourceOrderLabels.indexOf(a) === -1 ? 99 : sourceOrderLabels.indexOf(a)) - (sourceOrderLabels.indexOf(b) === -1 ? 99 : sourceOrderLabels.indexOf(b)));

  const handleToggle = async (s: SkillStatusReport) => { setBusyKey(s.name); try { await put(`/skills/${encodeURIComponent(s.name)}`, { enabled: !s.enabled }); setMessages(m => ({ ...m, [s.name]: { text: s.enabled ? t('skills.disabled') : t('skills.enabled'), ok: true } })); await fetchSkills(); } catch (e: any) { setMessages(m => ({ ...m, [s.name]: { text: e.message, ok: false } })); } finally { setBusyKey(null); } };
  const handleSaveApiKey = async (s: SkillStatusReport) => { const k = apiKeyEdits[s.name]; if (!k) return; setBusyKey(s.name); try { await put(`/skills/${encodeURIComponent(s.name)}`, { apiKey: k }); setMessages(m => ({ ...m, [s.name]: { text: t('skills.apiKeySaved'), ok: true } })); setApiKeyEdits(e => { const n = { ...e }; delete n[s.name]; return n; }); await fetchSkills(); } catch (e: any) { setMessages(m => ({ ...m, [s.name]: { text: e.message, ok: false } })); } finally { setBusyKey(null); } };
  const handleInstall = async (s: SkillStatusReport) => { setBusyKey(s.name); try { const r = await post<{ message: string }>(`/skills/${encodeURIComponent(s.name)}/install`, {}); setMessages(m => ({ ...m, [s.name]: { text: r.message || t('skills.installStarted'), ok: true } })); await fetchSkills(); } catch (e: any) { setMessages(m => ({ ...m, [s.name]: { text: e.message, ok: false } })); } finally { setBusyKey(null); } };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-2">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('skills.searchLocal')}
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-xs text-gray-400">{filtered.length} {t('skills.items')}</span>
        <button onClick={() => fetchSkills(true)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">{t('skills.refresh')}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {loading && <p className="text-sm text-gray-500">{t('skills.loading')}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && filtered.length === 0 && <div className="flex h-40 items-center justify-center text-sm text-gray-400">{search ? t('skills.noMatchingSkills') : t('skills.noLoadedSkills')}</div>}
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
  const { t } = useTranslation();
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
      setMessages(m => ({ ...m, [skill.slug]: { text: r.ok ? (r.message || t('skills.installSuccess')) : (r.message || t('skills.installFailed')), ok: r.ok } }));
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
          placeholder={t('skills.searchCommunity')}
          className="flex-1 max-w-md rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={doSearch} disabled={loading}
          className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50">
          {loading ? t('skills.searching') : t('skills.search')}
        </button>
        {mode === 'search' && (
          <button onClick={() => { setQuery(''); loadHot(); }}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200">
            {t('skills.backToHot')}
          </button>
        )}
        <span className="text-xs text-gray-400">{total} {t('skills.items')}</span>
      </div>

      {/* Sort tabs for hot mode */}
      {mode === 'hot' && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-50">
          <span className="text-xs text-gray-400">{t('skills.sortLabel')}</span>
          <button onClick={() => handleSortChange('downloads')}
            className={`rounded px-2 py-0.5 text-xs ${hotSort === 'downloads' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            🔥 {t('skills.downloads')}
          </button>
          <button onClick={() => handleSortChange('stars')}
            className={`rounded px-2 py-0.5 text-xs ${hotSort === 'stars' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            ⭐ {t('skills.stars')}
          </button>
          <div className="flex-1" />
          <span className="text-xs text-gray-300">{t('skills.dataSource')}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
        {!loading && results.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-gray-400">
            {mode === 'search' ? t('skills.noMatchingCommunitySkills') : t('skills.loading')}
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

const CommunitySkillCard: React.FC<CommunitySkillCardProps> = ({ skill, busy, message, onInstall }) => {
  const { t } = useTranslation();
  return (
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
    <p className="mt-1.5 line-clamp-2 text-xs text-gray-500">{skill.description || t('skills.noDescription')}</p>
    <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
      {typeof skill.downloads === 'number' && <span>📥 {skill.downloads.toLocaleString()}</span>}
      {typeof skill.stars === 'number' && <span>⭐ {skill.stars}</span>}
      {skill.source === 'skillsmp' && <span className="rounded bg-purple-50 px-1 text-purple-500">SkillsMP</span>}
    </div>
    {skill.tags && skill.tags.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-1">
        {skill.tags.slice(0, 4).map(tg => (
          <span key={tg} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{tg}</span>
        ))}
      </div>
    )}
    <div className="mt-3 flex items-center justify-between">
      <button onClick={onInstall} disabled={busy}
        className="rounded-lg bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-50">
        {busy ? t('skills.installing') : t('skills.install')}
      </button>
      {message && (
        <span className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-500'}`}>{message.text}</span>
      )}
    </div>
  </div>
  );
};

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
  const { t } = useTranslation();
  const hasMissing = skill.missing && (skill.missing.bins.length > 0 || skill.missing.env.length > 0 || skill.missing.config.length > 0);
  const needsApiKey = skill.missing && skill.missing.env.length > 0;
  const hasConfiguredKey = !needsApiKey && skill.requirements?.env && skill.requirements.env.length > 0;
  const [showKeyOverride, setShowKeyOverride] = useState(false);
  return (
    <div className={`rounded-lg border px-4 py-3 ${skill.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center gap-3">
        <span className="text-lg">{skill.emoji || '📦'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-800">{skill.name}</span>
            {hasMissing && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-700">{t('skills.missingDeps')}</span>}
          </div>
          <p className="truncate text-xs text-gray-400">{skill.filePath}</p>
        </div>
        <div className="flex items-center gap-2">
          {skill.installSpecs && skill.installSpecs.length > 0 && hasMissing && (
            <button onClick={onInstall} disabled={busy}
              className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
              {busy ? '...' : t('skills.installDeps')}
            </button>
          )}
          <button onClick={onToggle} disabled={busy}
            className={`rounded-full px-3 py-1 text-xs ${skill.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>
            {skill.enabled ? t('skills.enabled') : t('skills.disabled')}
          </button>
        </div>
      </div>
      {needsApiKey && (
        <div className="mt-2 flex items-center gap-2">
          <input type="password" value={apiKeyEdit} onChange={e => onApiKeyChange(e.target.value)}
            placeholder={t('skills.setEnvPlaceholder', { env: skill.missing!.env[0] })}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={onSaveApiKey} disabled={busy || !apiKeyEdit}
            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">{t('skills.save')}</button>
        </div>
      )}
      {hasConfiguredKey && (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600">✓ {skill.requirements!.env!.join(', ')} {t('skills.configured')}</span>
            <button onClick={() => setShowKeyOverride(!showKeyOverride)}
              className="text-xs text-blue-500 hover:underline">
              {showKeyOverride ? t('skills.collapse') : t('skills.modify')}
            </button>
          </div>
          {showKeyOverride && (
            <div className="mt-1 flex items-center gap-2">
              <input type="password" value={apiKeyEdit} onChange={e => onApiKeyChange(e.target.value)}
                placeholder={t('skills.overrideEnvPlaceholder', { env: skill.requirements!.env![0] })}
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={onSaveApiKey} disabled={busy || !apiKeyEdit}
                className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">{t('skills.save')}</button>
            </div>
          )}
        </div>
      )}
      {message && <p className={`mt-1 text-xs ${message.ok ? 'text-green-600' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  );
};

export default SkillsView;
