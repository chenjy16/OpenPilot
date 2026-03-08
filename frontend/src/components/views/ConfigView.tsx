import { useState, useEffect, useCallback, useMemo } from 'react';
import { get, put } from '../../services/apiClient';

interface ModelOption { ref: string; name: string; provider: string; providerLabel?: string; configured?: boolean; }

// Module-level model options cache (set by ConfigView, read by FieldEditor/ArrayField)
let _modelOptions: ModelOption[] = [];

// Paths that should render as model selectors
const MODEL_FIELD_PATHS = new Set([
  'agents.defaults.model.primary',
]);
// Paths that should render as model multi-select (arrays)
const MODEL_ARRAY_PATHS = new Set([
  'agents.defaults.model.fallbacks',
]);
function isModelField(path: string): boolean {
  return MODEL_FIELD_PATHS.has(path);
}
function isModelArrayField(path: string): boolean {
  return MODEL_ARRAY_PATHS.has(path);
}

// Section metadata — aligned with OpenClaw config structure
const SECTION_META: Record<string, { icon: string; label: string; description: string; order: number }> = {
  gateway: { icon: '🌐', label: '网关配置', description: '端口、绑定、认证、TLS、热重载', order: 1 },
  agents: { icon: '🤖', label: '智能体配置', description: '模型、压缩、沙箱、心跳、子智能体', order: 2 },
  models: { icon: '🧩', label: '自定义模型', description: '自定义模型提供商、Bedrock 发现', order: 3 },
  tools: { icon: '🔧', label: '工具配置', description: '工具策略、执行、搜索/抓取、媒体、循环检测', order: 4 },
  skills: { icon: '⚡', label: '技能配置', description: '技能加载、白名单、限制', order: 5 },
  plugins: { icon: '�', label: '插件系统', description: '插件加载、白名单、插槽绑定', order: 6 },
  channels: { icon: '�', label: '渠道配置', description: 'Telegram、Discord、Slack 等', order: 7 },
  bindings: { icon: '🔀', label: '路由绑定', description: '智能体路由绑定规则', order: 8 },
  session: { icon: '�', label: '会话管理', description: '范围、重置、维护清理', order: 9 },
  logging: { icon: '📋', label: '日志配置', description: '级别、文件、脱敏', order: 10 },
  cron: { icon: '⏰', label: '定时任务', description: '调度器、并发、重试', order: 11 },
  messages: { icon: '�', label: '消息处理', description: '前缀、队列、TTS', order: 12 },
  commands: { icon: '⌨️', label: '命令系统', description: '原生命令、文本命令、Bash、权限', order: 13 },
  broadcast: { icon: '📡', label: '广播配置', description: '广播策略与对等节点映射', order: 14 },
  memory: { icon: '🧠', label: '记忆系统', description: '后端、引用模式', order: 15 },
  diagnostics: { icon: '�', label: '诊断遥测', description: 'OpenTelemetry、标志', order: 16 },
  update: { icon: '🔄', label: '自动更新', description: '通道、启动检查', order: 17 },
  hooks: { icon: '🪝', label: 'Webhook', description: 'Hook 端点、映射', order: 18 },
  browser: { icon: '🌍', label: '浏览器工具', description: '无头模式、CDP', order: 19 },
  approvals: { icon: '✅', label: '审批配置', description: '执行审批流', order: 20 },
  auth: { icon: '�', label: '认证 Profile', description: '模型提供商认证与退避策略', order: 21 },
  discovery: { icon: '�', label: '服务发现', description: 'mDNS 广播与广域发现', order: 22 },
  talk: { icon: '🎙️', label: '实时语音', description: 'Talk 实时语音模式', order: 23 },
  imageGeneration: { icon: '🖼️', label: '图片生成', description: 'Provider 配置（Qwen/Stability/OpenAI/本地SD）', order: 24 },
  documentGeneration: { icon: '📄', label: '文档生成', description: 'PDF/PPT 输出目录、渲染器、默认样式', order: 25 },
  polymarket: { icon: '📈', label: 'PolyOracle', description: '预测市场扫描、信号阈值、通知', order: 26 },
  ui: { icon: '🎨', label: 'UI 外观', description: 'Web UI 主题色、助手名称', order: 27 },
  cli: { icon: '💻', label: 'CLI 配置', description: 'CLI 横幅与标语模式', order: 28 },
  secrets: { icon: '🔒', label: '密钥管理', description: '密钥来源提供商', order: 29 },
  env: { icon: '🌱', label: '环境变量', description: '环境变量注入与 Shell 导入', order: 30 },
  meta: { icon: '📝', label: '配置元数据', description: '配置文件版本与时间戳', order: 31 },
  apiKeys: { icon: '🔑', label: 'API 密钥', description: '环境变量设置', order: 32 },
  nodeEnv: { icon: '⚙️', label: '运行环境', description: '环境标识', order: 33 },
  logLevel: { icon: '📊', label: '全局日志级别', description: '日志级别', order: 34 },
  databasePath: { icon: '💾', label: '数据库路径', description: 'SQLite 路径', order: 35 },
  debug: { icon: '🐛', label: '调试模式', description: '调试输出', order: 36 },
};

// Known enum fields for select rendering
const ENUM_FIELDS: Record<string, string[]> = {
  'nodeEnv': ['development', 'production', 'test'],
  'logLevel': ['error', 'warn', 'info', 'debug'],
  'gateway.bind': ['auto', 'lan', 'loopback', 'tailnet', 'custom'],
  'gateway.mode': ['local', 'remote'],
  'gateway.auth.mode': ['none', 'token', 'password', 'trusted-proxy'],
  'gateway.reload.mode': ['off', 'restart', 'hot', 'hybrid'],
  'session.scope': ['per-sender', 'global'],
  'session.dmScope': ['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer'],
  'session.reset.mode': ['daily', 'idle'],
  'session.maintenance.mode': ['enforce', 'warn'],
  'logging.level': ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'],
  'logging.consoleLevel': ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'],
  'logging.consoleStyle': ['pretty', 'compact', 'json'],
  'logging.redactSensitive': ['off', 'tools'],
  'memory.backend': ['builtin', 'qmd'],
  'memory.citations': ['auto', 'on', 'off'],
  'update.channel': ['stable', 'beta', 'dev'],
  'agents.defaults.compaction.mode': ['default', 'safeguard'],
  'agents.defaults.sandbox.mode': ['off', 'non-main', 'all'],
  'agents.defaults.sandbox.scope': ['session', 'agent', 'shared'],
  'agents.defaults.sandbox.workspaceAccess': ['none', 'ro', 'rw'],
  'agents.defaults.thinkingDefault': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'],
  'agents.defaults.blockStreaming.blockStreamingDefault': ['off', 'on'],
  'agents.defaults.blockStreaming.blockStreamingBreak': ['text_end', 'message_end'],
  'agents.defaults.blockStreaming.humanDelay.mode': ['off', 'natural', 'custom'],
  'agents.defaults.contextPruning.mode': ['off', 'cache-ttl'],
  'channels.defaults.groupPolicy': ['open', 'disabled', 'allowlist'],
  'tools.profile': ['minimal', 'coding', 'messaging', 'full'],
  'tools.exec.host': ['sandbox', 'gateway', 'node'],
  'tools.exec.security': ['deny', 'allowlist', 'full'],
  'tools.exec.ask': ['off', 'on-miss', 'always'],
  'tools.web.search.provider': ['brave', 'perplexity', 'grok', 'gemini', 'kimi'],
  'tools.sessions.visibility': ['self', 'tree', 'agent', 'all'],
  'models.mode': ['merge', 'replace'],
  'messages.tts.auto': ['off', 'always', 'inbound', 'tagged'],
  'messages.tts.provider': ['elevenlabs', 'openai', 'edge'],
  'discovery.mdns.mode': ['off', 'minimal', 'full'],
  'imageGeneration.provider': ['', 'qwen', 'openai', 'stability', 'local_sd'],
  'documentGeneration.pdf.renderer': ['html', 'puppeteer'],
  'documentGeneration.pdf.defaultPageSize': ['A4', 'A3', 'Letter', 'Legal'],
  'cli.banner.taglineMode': ['random', 'default', 'off'],
};

const ConfigView: React.FC = () => {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [originalConfig, setOriginalConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<'form' | 'raw'>('form');
  const [rawJson, setRawJson] = useState('');
  const [originalRaw, setOriginalRaw] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const [data, models] = await Promise.all([
        get<Record<string, unknown>>('/config'),
        get<ModelOption[]>('/models').catch(() => [] as ModelOption[]),
      ]);
      setConfig(data);
      setOriginalConfig(JSON.parse(JSON.stringify(data)));
      const raw = JSON.stringify(data, null, 2);
      setRawJson(raw);
      setOriginalRaw(raw);
      setModelOptions(models);
      _modelOptions = models;
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const changes = useMemo(() => {
    if (!config || !originalConfig) return [];
    const diffs: { path: string; oldVal: string; newVal: string }[] = [];
    const walk = (orig: any, curr: any, prefix: string) => {
      const allKeys = new Set([...Object.keys(orig || {}), ...Object.keys(curr || {})]);
      for (const k of allKeys) {
        const path = prefix ? `${prefix}.${k}` : k;
        const ov = orig?.[k], cv = curr?.[k];
        if (typeof ov === 'object' && ov !== null && typeof cv === 'object' && cv !== null && !Array.isArray(ov)) {
          walk(ov, cv, path);
        } else if (JSON.stringify(ov) !== JSON.stringify(cv)) {
          diffs.push({ path, oldVal: truncVal(ov), newVal: truncVal(cv) });
        }
      }
    };
    walk(originalConfig, config, '');
    return diffs;
  }, [config, originalConfig]);

  const isDirty = mode === 'raw' ? rawJson !== originalRaw : changes.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = mode === 'raw' ? JSON.parse(rawJson) : config;
      const result = await put<{ ok: boolean; savedTo?: string; saveError?: string }>('/config', payload);
      if (result.saveError) {
        setSaveMsg(`已保存到内存，文件写入失败: ${result.saveError}`);
      } else {
        setSaveMsg(result.savedTo ? `已保存到 ${result.savedTo}` : '配置已保存');
      }
      await fetchConfig();
      setTimeout(() => setSaveMsg(null), 5000);
    } catch (err) {
      setSaveMsg(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalConfig) {
      setConfig(JSON.parse(JSON.stringify(originalConfig)));
      setRawJson(originalRaw);
    }
  };

  // Build sorted section list
  const sections = config ? Object.entries(config).filter(([, v]) => v !== undefined) : [];
  const sortedSections = sections.sort(([a], [b]) => {
    const oa = SECTION_META[a]?.order ?? 99;
    const ob = SECTION_META[b]?.order ?? 99;
    return oa - ob;
  });

  const filteredSections = activeSection
    ? sortedSections.filter(([k]) => k === activeSection)
    : search
      ? sortedSections.filter(([k]) => {
          const meta = SECTION_META[k];
          const haystack = `${k} ${meta?.label ?? ''} ${meta?.description ?? ''}`.toLowerCase();
          return haystack.includes(search.toLowerCase());
        })
      : sortedSections;

  const navItems = [
    { key: null, label: '全部设置', icon: '📋' },
    ...sortedSections.map(([k]) => ({
      key: k,
      label: SECTION_META[k]?.label || k,
      icon: SECTION_META[k]?.icon || '📄',
    })),
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="border-b border-gray-200 px-3 py-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">系统配置</span>
        </div>
        <div className="px-3 py-2">
          <input
            type="text" value={search} onChange={e => { setSearch(e.target.value); setActiveSection(null); }}
            placeholder="搜索配置项..."
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {navItems.map(item => (
            <button
              key={item.key ?? '__all'}
              onClick={() => { setActiveSection(item.key); setSearch(''); }}
              className={`mb-0.5 w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                activeSection === item.key ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
        <div className="border-t border-gray-200 p-3 flex gap-1">
          <button onClick={() => setMode('form')}
            className={`flex-1 rounded py-1 text-xs ${mode === 'form' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
            表单
          </button>
          <button onClick={() => setMode('raw')}
            className={`flex-1 rounded py-1 text-xs ${mode === 'raw' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
            JSON
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2">
          <button onClick={fetchConfig} disabled={loading}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            🔄 重新加载
          </button>
          <button onClick={handleSave} disabled={!isDirty || saving}
            className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
            {saving ? '保存中...' : '💾 保存到文件'}
          </button>
          {isDirty && (
            <button onClick={handleReset}
              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
              ↩ 撤销
            </button>
          )}
          <div className="flex-1" />
          {isDirty && (
            <span className="text-xs text-amber-600">
              {mode === 'form' ? `${changes.length} 项未保存变更` : '有未保存变更'}
            </span>
          )}
          {saveMsg && (
            <span className={`text-xs ${saveMsg.includes('失败') ? 'text-red-500' : 'text-green-600'}`}>
              {saveMsg}
            </span>
          )}
        </div>

        {mode === 'form' && changes.length > 0 && (
          <details className="border-b border-amber-200 bg-amber-50 px-4 py-2">
            <summary className="cursor-pointer text-xs text-amber-700">
              查看 {changes.length} 项变更
            </summary>
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {changes.map(c => (
                <div key={c.path} className="text-xs font-mono text-gray-600">
                  <span className="text-gray-800">{c.path}</span>:{' '}
                  <span className="text-red-500 line-through">{c.oldVal}</span> →{' '}
                  <span className="text-green-600">{c.newVal}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-gray-400">加载中...</div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
          ) : mode === 'raw' ? (
            <textarea
              value={rawJson}
              onChange={e => setRawJson(e.target.value)}
              className="h-full w-full resize-none rounded-lg border border-gray-300 p-4 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              spellCheck={false}
            />
          ) : (
            <div className="space-y-3">
              {filteredSections.map(([key, value]) => {
                const meta = SECTION_META[key] ?? { icon: '📄', label: key, description: '', order: 99 };
                return (
                  <ConfigSection
                    key={key}
                    sectionKey={key}
                    icon={meta.icon}
                    label={meta.label}
                    description={meta.description}
                    value={value}
                    onChange={(newVal) => setConfig(prev => prev ? { ...prev, [key]: newVal } : prev)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function truncVal(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 37) + '...' : s;
}

function getEnumOptions(path: string): string[] | null {
  return ENUM_FIELDS[path] ?? null;
}

// Editable config section
const ConfigSection: React.FC<{
  sectionKey: string; icon: string; label: string; description: string;
  value: unknown; onChange: (v: unknown) => void;
}> = ({ sectionKey, icon, label, description, value, onChange }) => {
  const [expanded, setExpanded] = useState(false);
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isSimple = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <div>
          <div className="flex items-center gap-2">
            <span>{icon}</span>
            <span className="text-sm font-medium text-gray-700">{label}</span>
            <span className="text-xs text-gray-400">{sectionKey}</span>
          </div>
          {description && <p className="mt-0.5 text-xs text-gray-400 ml-6">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {isSimple && (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 font-mono">{String(value)}</span>
          )}
          <span className="text-xs text-gray-400">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {isSimple ? (
            <FieldEditor path={sectionKey} value={value} onChange={onChange} />
          ) : isObject ? (
            <NestedFields path={sectionKey} value={value as Record<string, unknown>} onChange={onChange} />
          ) : Array.isArray(value) ? (
            <ArrayField path={sectionKey} value={value as unknown[]} onChange={onChange} />
          ) : (
            <pre className="text-xs text-gray-600 font-mono">{JSON.stringify(value, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
};

// Generic field editor with enum detection
const FieldEditor: React.FC<{ path: string; value: unknown; onChange: (v: unknown) => void }> = ({ path, value, onChange }) => {
  const enumOpts = getEnumOptions(path);
  // Must declare all hooks before any early returns (React Rules of Hooks)
  const isPassword = path.includes('apiKey') || path.includes('token') || path.includes('password') || path.includes('secret');
  const [showPassword, setShowPassword] = useState(false);

  // Model selector for model-related fields
  if (isModelField(path) && _modelOptions.length > 0) {
    const grouped = new Map<string, ModelOption[]>();
    for (const m of _modelOptions) {
      const key = m.providerLabel ?? m.provider;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(m);
    }
    const currentVal = String(value ?? '');
    const isValid = _modelOptions.some(m => m.ref === currentVal);
    return (
      <div>
        <select value={currentVal} onChange={e => onChange(e.target.value)}
          className={`w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${isValid ? 'border-gray-300' : 'border-orange-400 bg-orange-50'}`}>
          {!isValid && currentVal && <option value={currentVal}>⚠️ {currentVal} (未配置)</option>}
          {[...grouped.entries()].map(([provider, models]) => (
            <optgroup key={provider} label={provider}>
              {models.map(m => (
                <option key={m.ref} value={m.ref}>
                  {m.name} {m.configured ? '' : '(未配置)'} — {m.ref}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {!isValid && currentVal && (
          <p className="mt-1 text-xs text-orange-600">当前值 "{currentVal}" 不在已知模型列表中</p>
        )}
      </div>
    );
  }

  if (enumOpts) {
    return (
      <select value={String(value)} onChange={e => onChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
        {enumOpts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <button
          onClick={() => onChange(!value)}
          className={`h-5 w-9 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-gray-300'}`}
          role="switch" aria-checked={value}
        >
          <div className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-sm text-gray-700">{value ? '启用' : '禁用'}</span>
      </label>
    );
  }

  if (typeof value === 'number') {
    return (
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="rounded border border-gray-300 px-2 py-1 text-sm font-mono w-40 focus:outline-none focus:ring-1 focus:ring-blue-400" />
    );
  }

  // String
  const isMaskedVal = typeof value === 'string' && (value as string).startsWith('••••');
  return (
    <div className="relative">
      <input
        type={isPassword && !showPassword ? 'password' : 'text'}
        value={value != null ? String(value) : ''}
        onChange={e => onChange(e.target.value)}
        placeholder={isPassword ? '(未设置)' : ''}
        className={`w-full rounded border px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${
          isMaskedVal ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-300'
        } ${isPassword ? 'pr-14' : ''}`}
      />
      {isPassword && value && (
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-blue-500 hover:bg-blue-50"
        >
          {showPassword ? '🙈' : '👁'}
        </button>
      )}
      {isMaskedVal && !showPassword && (
        <p className="mt-0.5 text-xs text-green-600">✓ 已配置（输入新值可覆盖）</p>
      )}
    </div>
  );
};

// Nested object fields with recursive rendering
const NestedFields: React.FC<{
  path: string; value: Record<string, unknown>; onChange: (v: unknown) => void;
}> = ({ path, value, onChange }) => {
  // Guard against null/undefined values
  if (!value || typeof value !== 'object') {
    return <span className="text-xs text-gray-400 font-mono">{JSON.stringify(value)}</span>;
  }
  const entries = Object.entries(value);
  const isApiKeys = path === 'apiKeys';

  const handleFieldChange = (key: string, newVal: unknown) => {
    onChange({ ...value, [key]: newVal });
  };

  return (
    <div className="space-y-3">
      {entries.map(([k, v]) => {
        const fieldPath = `${path}.${k}`;
        const isNested = v !== null && typeof v === 'object' && !Array.isArray(v);
        const isArray = Array.isArray(v);
        const isSimple = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

        return (
          <div key={k}>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500">
              <span>{k}</span>
              {getEnumOptions(fieldPath) && (
                <span className="text-gray-300">enum</span>
              )}
            </label>
            {v === null || v === undefined ? (
              <span className="text-xs text-gray-400 font-mono italic">(未设置)</span>
            ) : isApiKeys ? (
              <input
                type="password"
                value={v ? String(v) : ''}
                onChange={e => handleFieldChange(k, e.target.value || undefined)}
                placeholder="(环境变量设置)"
                disabled
                className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm font-mono text-gray-400"
              />
            ) : isSimple || getEnumOptions(fieldPath) ? (
              <FieldEditor path={fieldPath} value={v} onChange={newVal => handleFieldChange(k, newVal)} />
            ) : isArray ? (
              <ArrayField path={fieldPath} value={v as unknown[]} onChange={newVal => handleFieldChange(k, newVal)} />
            ) : isNested ? (
              <NestedBlock path={fieldPath} value={v as Record<string, unknown>} onChange={newVal => handleFieldChange(k, newVal)} />
            ) : (
              <span className="text-xs text-gray-400 font-mono">{JSON.stringify(v)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Collapsible nested block for deep objects
const NestedBlock: React.FC<{
  path: string; value: Record<string, unknown>; onChange: (v: unknown) => void;
}> = ({ path, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const keyCount = Object.keys(value).length;

  return (
    <div className="rounded border border-gray-100 bg-gray-50">
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-100">
        <span>{open ? '▼' : '▶'} {keyCount} 项</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3 py-2">
          <NestedFields path={path} value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
};

// Array field editor
const ArrayField: React.FC<{
  path: string; value: unknown[]; onChange: (v: unknown) => void;
}> = ({ path, value, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value.join(', '));
  const isModelArray = isModelArrayField(path) && _modelOptions.length > 0;

  // Sync text when value changes externally
  useEffect(() => {
    if (!editing) {
      setText(value.join(', '));
    }
  }, [value, editing]);

  // Model array: tag-based UI with add dropdown
  if (isModelArray) {
    const currentRefs = value.map(String);
    const available = _modelOptions.filter(m => !currentRefs.includes(m.ref));
    const grouped = new Map<string, ModelOption[]>();
    for (const m of available) {
      const key = m.providerLabel ?? m.provider;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(m);
    }

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {currentRefs.length === 0 ? (
            <span className="text-xs text-gray-400">(空)</span>
          ) : (
            currentRefs.map((ref, i) => {
              const meta = _modelOptions.find(m => m.ref === ref);
              const isValid = !!meta;
              return (
                <span key={i} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono ${isValid ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                  {meta?.name ?? ref}{!isValid && ' ⚠️'}
                  <button onClick={() => onChange(currentRefs.filter((_, j) => j !== i))}
                    className="ml-0.5 text-gray-400 hover:text-red-500" title="移除">×</button>
                </span>
              );
            })
          )}
        </div>
        {available.length > 0 && (
          <select
            value=""
            onChange={e => { if (e.target.value) onChange([...currentRefs, e.target.value]); }}
            className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">+ 添加 fallback 模型...</option>
            {[...grouped.entries()].map(([provider, models]) => (
              <optgroup key={provider} label={provider}>
                {models.map(m => (
                  <option key={m.ref} value={m.ref}>
                    {m.name} {m.configured ? '' : '(未配置)'} — {m.ref}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input type="text" value={text} onChange={e => setText(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="逗号分隔" />
        <button onClick={() => {
          onChange(text.split(',').map(s => s.trim()).filter(Boolean));
          setEditing(false);
        }} className="rounded bg-blue-500 px-2 py-1 text-xs text-white">确定</button>
        <button onClick={() => setEditing(false)} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600">取消</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-wrap gap-1">
        {value.length === 0 ? (
          <span className="text-xs text-gray-400">(空)</span>
        ) : (
          value.map((item, i) => (
            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
              {String(item)}
            </span>
          ))
        )}
      </div>
      <button onClick={() => { setText(value.join(', ')); setEditing(true); }}
        className="ml-1 text-xs text-blue-500 hover:underline">编辑</button>
    </div>
  );
};

export default ConfigView;
