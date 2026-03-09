import { useState, useEffect, useCallback } from 'react';
import { get, put, post, del } from '../../services/apiClient';
import type { AgentInfo, ToolSection, SkillStatusReport } from '../../types';

type AgentPanel = 'overview' | 'files' | 'tools' | 'skills' | 'channels' | 'cron';

interface ModelOption { ref: string; name: string; provider: string; }

const PANELS: { id: AgentPanel; label: string; icon: string }[] = [
  { id: 'overview', label: '概览', icon: '📋' },
  { id: 'files', label: '文件', icon: '📁' },
  { id: 'tools', label: '工具', icon: '🔧' },
  { id: 'skills', label: '技能', icon: '⚡' },
  { id: 'channels', label: '渠道', icon: '🔗' },
  { id: 'cron', label: '定时', icon: '⏰' },
];

const FALLBACK_MODELS: ModelOption[] = [
  { ref: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { ref: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { ref: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic' },
  { ref: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
];

const AgentsView: React.FC = () => {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<AgentPanel>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createId, setCreateId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const data = await get<AgentInfo[]>('/agents');
      setAgents(data);
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleCreate = async () => {
    if (!createId.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      const agent = await post<AgentInfo>('/agents', {
        id: createId.trim().toLowerCase().replace(/\s+/g, '-'),
        name: createName.trim() || createId.trim(),
        description: createDesc.trim(),
      });
      setShowCreate(false); setCreateId(''); setCreateName(''); setCreateDesc('');
      await fetchAgents();
      setSelectedId(agent.id);
    } catch (err: any) {
      setCreateError(err.message);
    } finally { setCreating(false); }
  };

  const handleDelete = async (agentId: string) => {
    if (agentId === 'default') return;
    if (!confirm(`确定删除智能体 "${agentId}"？此操作不可撤销。`)) return;
    try {
      await del(`/agents/${agentId}`);
      if (selectedId === agentId) setSelectedId(null);
      await fetchAgents();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  const selected = agents.find(a => a.id === selectedId);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Agent list sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">🤖 智能体</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowCreate(true)} className="rounded bg-blue-500 px-2 py-0.5 text-xs text-white hover:bg-blue-600">+ 新建</button>
            <button onClick={fetchAgents} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
          </div>
        </div>

        {/* Create agent dialog */}
        {showCreate && (
          <div className="border-b border-gray-200 bg-white p-3 space-y-2">
            <input type="text" value={createId} onChange={e => setCreateId(e.target.value)}
              placeholder="ID (如: my-agent)" className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
              placeholder="名称 (可选)" className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <input type="text" value={createDesc} onChange={e => setCreateDesc(e.target.value)}
              placeholder="描述 (可选)" className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <div className="flex gap-1">
              <button onClick={handleCreate} disabled={creating || !createId.trim()}
                className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
                {creating ? '创建中...' : '创建'}
              </button>
              <button onClick={() => { setShowCreate(false); setCreateError(null); }}
                className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-300">取消</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {loading && <p className="px-2 py-4 text-xs text-gray-400">加载中...</p>}
          {error && <p className="px-2 py-4 text-xs text-red-500">{error}</p>}
          {agents.map(agent => (
            <div key={agent.id} className="group relative mb-1">
              <button
                onClick={() => { setSelectedId(agent.id); setActivePanel('overview'); }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selectedId === agent.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{agent.name}</div>
                <div className="truncate text-xs text-gray-400">{agent.id}</div>
              </button>
              {agent.id !== 'default' && (
                <button onClick={() => handleDelete(agent.id)}
                  className="absolute right-1 top-1 hidden rounded p-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
                  title="删除">✕</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Detail area */}
      <div className="flex flex-1 flex-col min-w-0">
        {selected ? (
          <>
            {/* Panel tabs */}
            <div className="flex border-b border-gray-200 px-4">
              {PANELS.map(p => (
                <button key={p.id} onClick={() => setActivePanel(p.id)}
                  className={`px-3 py-2.5 text-sm transition-colors ${
                    activePanel === p.id ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {activePanel === 'overview' && <AgentOverview agent={selected} onUpdate={fetchAgents} />}
              {activePanel === 'files' && <AgentFiles agentId={selected.id} />}
              {activePanel === 'tools' && <AgentTools agent={selected} onUpdate={fetchAgents} />}
              {activePanel === 'skills' && <AgentSkills agent={selected} onUpdate={fetchAgents} />}
              {activePanel === 'channels' && <AgentChannels agentId={selected.id} />}
              {activePanel === 'cron' && <AgentCron agentId={selected.id} />}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            选择一个智能体查看详情
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Overview — editable model selection
// ---------------------------------------------------------------------------
const AgentOverview: React.FC<{ agent: AgentInfo; onUpdate: () => void }> = ({ agent, onUpdate }) => {
  const [primaryModel, setPrimaryModel] = useState(agent.model?.primary || '');
  const [fallbacks, setFallbacks] = useState(agent.model?.fallbacks?.join(', ') || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [defaultModel, setDefaultModel] = useState('');

  useEffect(() => {
    get<any[]>('/models/configured')
      .then(data => setAvailableModels(data.map(m => ({ ref: m.ref, name: m.name, provider: m.providerLabel ?? m.provider }))))
      .catch(() => {});
    get<Record<string, any>>('/config')
      .then(data => {
        const dm = data?.agents?.defaults?.model?.primary;
        if (dm) setDefaultModel(dm);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPrimaryModel(agent.model?.primary || '');
    setFallbacks(agent.model?.fallbacks?.join(', ') || '');
  }, [agent]);

  const isDirty = primaryModel !== (agent.model?.primary || '') ||
    fallbacks !== (agent.model?.fallbacks?.join(', ') || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await put(`/agents/${agent.id}`, {
        model: {
          primary: primaryModel,
          fallbacks: fallbacks.split(',').map(s => s.trim()).filter(Boolean),
        },
      });
      setMsg('已保存');
      onUpdate();
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg(`失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Info grid */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">基本信息</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">ID</dt><dd className="text-gray-800 font-mono text-xs">{agent.id}</dd>
          <dt className="text-gray-500">名称</dt><dd className="text-gray-800">{agent.name}</dd>
          <dt className="text-gray-500">描述</dt><dd className="text-gray-800">{agent.description || '—'}</dd>
          <dt className="text-gray-500">工具配置</dt><dd className="text-gray-800">{agent.toolProfile || 'coding'}</dd>
          <dt className="text-gray-500">技能过滤</dt>
          <dd className="text-gray-800">{agent.skillFilter?.length ? `${agent.skillFilter.length} 项` : '全部技能'}</dd>
          <dt className="text-gray-500">创建时间</dt><dd className="text-gray-800">{new Date(agent.createdAt).toLocaleString()}</dd>
        </dl>
      </div>

      {/* Model selection */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">模型配置</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">主模型</label>
            <select value={primaryModel} onChange={e => setPrimaryModel(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">继承全局默认{defaultModel ? ` (${defaultModel})` : ''}</option>
              {availableModels.map(m => <option key={m.ref} value={m.ref}>{m.name} ({m.provider})</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">回退链（逗号分隔）</label>
            <input type="text" value={fallbacks} onChange={e => setFallbacks(e.target.value)}
              placeholder="gpt-3.5-turbo, claude-3-sonnet"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={!isDirty || saving}
              className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith('失败') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Files — file editor with draft tracking
// ---------------------------------------------------------------------------
const AgentFiles: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    get<string[]>(`/agents/${agentId}/files`).then(setFiles).catch(() => {});
  }, [agentId]);

  useEffect(() => {
    if (!selectedFile) return;
    get<{ content: string }>(`/agents/${agentId}/files/${selectedFile}`)
      .then(d => { setContent(d.content); setDraft(d.content); setMsg(null); })
      .catch(() => {});
  }, [agentId, selectedFile]);

  const isDirty = draft !== content;

  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await put(`/agents/${agentId}/files/${selectedFile}`, { content: draft });
      setContent(draft);
      setMsg('已保存');
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg(`失败: ${err.message}`);
    }
    setSaving(false);
  };

  return (
    <div className="flex h-full gap-4">
      <div className="w-40 flex-shrink-0 space-y-1">
        <p className="mb-2 text-xs font-medium text-gray-500">核心文件</p>
        {files.map(f => (
          <button key={f} onClick={() => setSelectedFile(f)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs ${
              selectedFile === f ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            {f}
          </button>
        ))}
        {files.length === 0 && <p className="text-xs text-gray-400">无文件</p>}
      </div>
      <div className="flex flex-1 flex-col">
        {selectedFile ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">{selectedFile}</span>
              {isDirty && (
                <>
                  <button onClick={handleSave} disabled={saving}
                    className="rounded bg-blue-500 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button onClick={() => setDraft(content)}
                    className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-300">重置</button>
                </>
              )}
              {msg && <span className={`text-xs ${msg.startsWith('失败') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
            </div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)}
              className="flex-1 resize-none rounded-lg border border-gray-300 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              spellCheck={false} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">选择文件查看内容</div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tools — per-tool toggle controls with profile presets
// ---------------------------------------------------------------------------
const TOOL_PROFILES = ['full', 'standard', 'minimal', 'none'] as const;

const AgentTools: React.FC<{ agent: AgentInfo; onUpdate: () => void }> = ({ agent, onUpdate }) => {
  const [catalog, setCatalog] = useState<ToolSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(agent.toolProfile || 'coding');
  const [allowSet, setAllowSet] = useState<Set<string>>(new Set(agent.tools?.allow || []));
  const [denySet, setDenySet] = useState<Set<string>>(new Set(agent.tools?.deny || []));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    get<ToolSection[]>('/tools/catalog')
      .then(d => { setCatalog(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setProfile(agent.toolProfile || 'coding');
    setAllowSet(new Set(agent.tools?.allow || []));
    setDenySet(new Set(agent.tools?.deny || []));
  }, [agent]);

  const allToolIds = catalog.flatMap(s => s.tools.map(t => t.id));
  const enabledCount = allToolIds.filter(id => {
    if (denySet.has(id)) return false;
    if (allowSet.size > 0) return allowSet.has(id);
    return true;
  }).length;

  const toggleTool = (id: string) => {
    const newDeny = new Set(denySet);
    const newAllow = new Set(allowSet);
    if (newDeny.has(id)) {
      newDeny.delete(id);
    } else {
      newDeny.add(id);
      newAllow.delete(id);
    }
    setDenySet(newDeny);
    setAllowSet(newAllow);
  };

  const enableAll = () => { setDenySet(new Set()); };
  const disableAll = () => { setDenySet(new Set(allToolIds)); setAllowSet(new Set()); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await put(`/agents/${agent.id}`, {
        toolProfile: profile,
        tools: {
          allow: Array.from(allowSet),
          deny: Array.from(denySet),
        },
      });
      setMsg('已保存');
      onUpdate();
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg(`失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const isDirty = profile !== (agent.toolProfile || 'coding') ||
    JSON.stringify([...allowSet].sort()) !== JSON.stringify([...(agent.tools?.allow || [])].sort()) ||
    JSON.stringify([...denySet].sort()) !== JSON.stringify([...(agent.tools?.deny || [])].sort());

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">工具访问策略</h3>
            <p className="text-xs text-gray-400">{enabledCount}/{allToolIds.length} 已启用</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={enableAll} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100">全部启用</button>
            <button onClick={disableAll} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">全部禁用</button>
            <button onClick={handleSave} disabled={!isDirty || saving}
              className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith('失败') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
          </div>
        </div>

        {/* Profile presets */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">预设:</span>
          {TOOL_PROFILES.map(p => (
            <button key={p} onClick={() => { setProfile(p); setDenySet(new Set()); setAllowSet(new Set()); }}
              className={`rounded px-2 py-0.5 text-xs ${profile === p ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Tool list */}
      {loading ? (
        <p className="text-xs text-gray-400">加载工具目录...</p>
      ) : catalog.map(section => (
        <div key={section.name} className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">{section.name}</h3>
          <div className="space-y-1">
            {section.tools.map(tool => {
              const denied = denySet.has(tool.id);
              const allowed = allowSet.size === 0 || allowSet.has(tool.id);
              const enabled = !denied && allowed;
              return (
                <div key={tool.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${denied ? 'opacity-50' : ''}`}>
                  <button onClick={() => toggleTool(tool.id)}
                    className={`h-5 w-9 flex-shrink-0 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-gray-300'}`}
                    role="switch" aria-checked={enabled} aria-label={`切换 ${tool.label}`}>
                    <div className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <span>{tool.emoji}</span>
                  <span className="font-mono text-xs text-gray-700">{tool.id}</span>
                  <span className="text-xs text-gray-400 truncate">{tool.description}</span>
                  {tool.ownerOnly && <span className="ml-auto text-xs text-amber-500">仅所有者</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Skills — per-skill toggle (whitelist mode)
// ---------------------------------------------------------------------------
const AgentSkills: React.FC<{ agent: AgentInfo; onUpdate: () => void }> = ({ agent, onUpdate }) => {
  const [skills, setSkills] = useState<SkillStatusReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Set<string>>(new Set(agent.skillFilter || []));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const hasFilter = filter.size > 0 || (agent.skillFilter && agent.skillFilter.length > 0);

  useEffect(() => {
    get<SkillStatusReport[]>('/skills/status')
      .then(d => { setSkills(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setFilter(new Set(agent.skillFilter || []));
  }, [agent]);

  const toggleSkill = (name: string) => {
    const next = new Set(filter);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setFilter(next);
  };

  const useAll = () => setFilter(new Set());
  const disableAll = () => setFilter(new Set(['__none__'])); // empty whitelist = nothing

  const handleSave = async () => {
    setSaving(true);
    try {
      const skillFilter = filter.size > 0 ? Array.from(filter).filter(s => s !== '__none__') : [];
      await put(`/agents/${agent.id}`, { skillFilter });
      setMsg('已保存');
      onUpdate();
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg(`失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const isDirty = JSON.stringify([...filter].sort()) !== JSON.stringify([...(agent.skillFilter || [])].sort());

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">技能白名单</h3>
            <p className="text-xs text-gray-400">
              {hasFilter ? `${filter.size} 项已选` : '全部技能可用'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={useAll} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100">全部启用</button>
            <button onClick={disableAll} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">全部禁用</button>
            <button onClick={handleSave} disabled={!isDirty || saving}
              className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith('失败') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">加载技能列表...</p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="space-y-1">
            {skills.map(skill => {
              const enabled = !hasFilter || filter.has(skill.name);
              return (
                <div key={skill.name} className={`flex items-center gap-2 rounded px-2 py-1.5 ${!enabled ? 'opacity-50' : ''}`}>
                  <button onClick={() => toggleSkill(skill.name)}
                    className={`h-5 w-9 flex-shrink-0 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-gray-300'}`}
                    role="switch" aria-checked={enabled} aria-label={`切换 ${skill.name}`}>
                    <div className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <span>{skill.emoji || '📦'}</span>
                  <span className="text-sm text-gray-700">{skill.name}</span>
                  <span className="text-xs text-gray-400">{skill.source}</span>
                  {!skill.enabled && <span className="ml-auto text-xs text-amber-500">全局已禁用</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Channels — read-only channel status with agent context
// ---------------------------------------------------------------------------
const AgentChannels: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [channels, setChannels] = useState<any[]>([]);
  const [bindings, setBindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newBinding, setNewBinding] = useState({ channel: 'telegram', peerKind: '', peerId: '', guildId: '' });

  const fetchData = useCallback(async () => {
    try {
      const [ch, b] = await Promise.all([
        get<any[]>('/channels'),
        get<any[]>(`/agents/${encodeURIComponent(agentId)}/bindings`),
      ]);
      setChannels(ch);
      setBindings(b);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddBinding = async () => {
    const match: any = { channel: newBinding.channel };
    if (newBinding.peerId) {
      match.peer = { kind: newBinding.peerKind || 'direct', id: newBinding.peerId };
    }
    if (newBinding.guildId) match.guildId = newBinding.guildId;

    const updated = [...bindings, { match }];
    try {
      await put(`/agents/${encodeURIComponent(agentId)}/bindings`, { bindings: updated });
      setMsg('绑定已添加');
      setAdding(false);
      setNewBinding({ channel: 'telegram', peerKind: '', peerId: '', guildId: '' });
      await fetchData();
    } catch (err) { setMsg(`失败: ${(err as Error).message}`); }
  };

  const handleRemoveBinding = async (idx: number) => {
    const updated = bindings.filter((_, i) => i !== idx);
    try {
      await put(`/agents/${encodeURIComponent(agentId)}/bindings`, { bindings: updated });
      setMsg('绑定已移除');
      await fetchData();
    } catch (err) { setMsg(`失败: ${(err as Error).message}`); }
  };

  const MATCH_LABELS: Record<string, string> = {
    direct: '私聊', group: '群组', channel: '频道',
  };

  return (
    <div className="space-y-4">
      {/* Channel status */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">渠道状态</h3>
        {loading ? (
          <p className="text-xs text-gray-400">加载中...</p>
        ) : channels.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 p-6 text-center">
            <div className="mb-2 text-2xl">🔗</div>
            <p className="text-xs text-gray-400">暂无可用渠道</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {channels.map((ch: any) => (
              <div key={ch.type} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${ch.status === 'connected' ? 'bg-green-400' : 'bg-gray-300'}`} />
                  <div>
                    <span className="text-sm font-medium text-gray-700 capitalize">{ch.type}</span>
                    <p className="text-xs text-gray-400">{ch.status}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bindings */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">路由绑定</h3>
          <button onClick={() => setAdding(!adding)}
            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600">
            {adding ? '取消' : '+ 添加绑定'}
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-400">
          绑定规则将特定渠道/用户/群组的消息路由到此智能体。优先级：对等体 &gt; 服务器+角色 &gt; 服务器 &gt; 团队 &gt; 账户 &gt; 渠道。
        </p>

        {adding && (
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 space-y-2">
            <div className="flex gap-2">
              <select value={newBinding.channel} onChange={e => setNewBinding({ ...newBinding, channel: e.target.value })}
                className="rounded border border-gray-300 px-2 py-1 text-xs">
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="signal">Signal</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <select value={newBinding.peerKind} onChange={e => setNewBinding({ ...newBinding, peerKind: e.target.value })}
                className="rounded border border-gray-300 px-2 py-1 text-xs">
                <option value="">（无对等体）</option>
                <option value="direct">私聊</option>
                <option value="group">群组</option>
                <option value="channel">频道</option>
              </select>
            </div>
            {newBinding.peerKind && (
              <input type="text" placeholder="对等体 ID（用户/群组 ID）" value={newBinding.peerId}
                onChange={e => setNewBinding({ ...newBinding, peerId: e.target.value })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" />
            )}
            <input type="text" placeholder="Guild/Server ID（可选）" value={newBinding.guildId}
              onChange={e => setNewBinding({ ...newBinding, guildId: e.target.value })}
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" />
            <button onClick={handleAddBinding}
              className="rounded bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600">
              确认添加
            </button>
          </div>
        )}

        {bindings.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 p-4 text-center">
            <p className="text-xs text-gray-400">暂无绑定规则 — 使用默认路由</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bindings.map((b: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
                <div className="text-xs">
                  <span className="font-medium text-gray-700 capitalize">{b.match?.channel ?? '?'}</span>
                  {b.match?.peer && (
                    <span className="ml-2 text-gray-500">
                      {MATCH_LABELS[b.match.peer.kind] ?? b.match.peer.kind}: <span className="font-mono">{b.match.peer.id}</span>
                    </span>
                  )}
                  {b.match?.guildId && (
                    <span className="ml-2 text-gray-500">Guild: <span className="font-mono">{b.match.guildId}</span></span>
                  )}
                  {b.match?.teamId && (
                    <span className="ml-2 text-gray-500">Team: <span className="font-mono">{b.match.teamId}</span></span>
                  )}
                  {b.comment && <span className="ml-2 text-gray-400">({b.comment})</span>}
                </div>
                <button onClick={() => handleRemoveBinding(idx)}
                  className="text-xs text-red-400 hover:text-red-600">移除</button>
              </div>
            ))}
          </div>
        )}

        {msg && (
          <div className={`mt-2 rounded px-3 py-1.5 text-xs ${msg.includes('失败') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Cron — read-only cron jobs filtered by agent
// ---------------------------------------------------------------------------
const AgentCron: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<any[]>('/cron/jobs')
      .then(data => {
        setJobs(data.filter((j: any) => j.agentId === agentId));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">关联定时任务</h3>
        <p className="mb-3 text-xs text-gray-400">
          此智能体关联的定时任务。在"定时任务"页面可创建和管理。
        </p>
        {loading ? (
          <p className="text-xs text-gray-400">加载中...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 p-6 text-center">
            <div className="mb-2 text-2xl">⏰</div>
            <p className="text-xs text-gray-400">暂无关联的定时任务</p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{job.schedule}</code>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${job.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {job.enabled ? '启用' : '禁用'}
                    </span>
                    {job.lastStatus && (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${job.lastStatus === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                        {job.lastStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 truncate max-w-md">{job.message}</p>
                  {job.lastRunAt && <p className="mt-0.5 text-xs text-gray-300">上次: {new Date(job.lastRunAt).toLocaleString()}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentsView;
