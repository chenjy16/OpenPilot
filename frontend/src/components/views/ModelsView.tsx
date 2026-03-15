import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../services/apiClient';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ModelCatalogEntry {
  ref: string;
  provider: string;
  modelId: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  configured: boolean;
  providerLabel?: string;
}

interface ProviderStatus {
  id: string;
  label: string;
  detected: boolean;
  profileCount: number;
  maskedKey?: string;
}

/* ------------------------------------------------------------------ */
/*  Inline API-Key form (shown per provider)                           */
/* ------------------------------------------------------------------ */

const ProviderKeyForm: React.FC<{
  providerId: string;
  providerLabel: string;
  detected: boolean;
  maskedKey?: string;
  onSaved: () => void;
}> = ({ providerId, providerLabel, detected, maskedKey, onSaved }) => {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const result = await post<{ ok: boolean; totalConfigured: number; savedTo?: string }>(
        '/models/providers',
        { providerId, apiKey: apiKey.trim(), models: [] },
      );
      setMsg(t('models.providerEnabled', { provider: providerLabel, count: result.totalConfigured }));
      setApiKey('');
      onSaved();
    } catch (err) {
      setMsg(t('models.failed', { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '8px 12px', background: '#1a1a2e', borderRadius: 6, marginTop: 4 }}>
      {detected && maskedKey && (
        <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 6 }}>
          {t('models.apiKeyConfigured')} <span style={{ fontFamily: 'monospace', color: '#93c5fd' }}>{maskedKey}</span>
        </div>
      )}
      {detected && !maskedKey && (
        <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 6 }}>
          {t('models.apiKeyDetectedEnv')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="password"
          placeholder={detected ? t('models.placeholderOverrideKey') : t('models.placeholderEnterKey', { provider: providerLabel })}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          style={{
            flex: 1, padding: '6px 10px', background: '#0d1117', border: '1px solid #333',
            borderRadius: 4, color: '#e6e6e6', fontSize: 13, fontFamily: 'monospace',
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
          style={{
            padding: '6px 14px', background: saving ? '#555' : '#3b82f6', color: '#fff',
            border: 'none', borderRadius: 4, cursor: saving ? 'default' : 'pointer', fontSize: 13,
          }}
        >
          {saving ? t('models.saving') : t('models.save')}
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 6, color: msg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{msg}</div>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Custom provider form (for non-built-in providers)                  */
/* ------------------------------------------------------------------ */

const CustomProviderForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelsText, setModelsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (!providerId.trim() || !apiKey.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const models = modelsText.split('\n').map(l => l.trim()).filter(Boolean).map(id => ({ id, name: id }));
      const result = await post<{ ok: boolean; totalConfigured: number; savedTo?: string }>(
        '/models/providers',
        { providerId: providerId.trim(), apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined, models },
      );
      setMsg(t('models.providerAdded', { provider: providerId, count: result.totalConfigured }));
      setProviderId(''); setApiKey(''); setBaseUrl(''); setModelsText('');
      onSaved();
    } catch (err) {
      setMsg(t('models.failed', { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', background: '#0d1117', border: '1px solid #333',
    borderRadius: 4, color: '#e6e6e6', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box',
  };

  return (
    <div style={{ padding: 16, background: '#1a1a2e', borderRadius: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#e6e6e6' }}>{t('models.addCustomProvider')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 2 }}>{t('models.labelProviderId')}</label>
          <input placeholder={t('models.placeholderProviderId')} value={providerId} onChange={e => setProviderId(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 2 }}>{t('models.labelApiKey')}</label>
          <input type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 2 }}>{t('models.labelBaseUrl')}</label>
          <input placeholder="https://api.example.com/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 2 }}>{t('models.labelModelList')}</label>
          <textarea
            placeholder={'model-a\nmodel-b'}
            value={modelsText}
            onChange={e => setModelsText(e.target.value)}
            rows={3}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !providerId.trim() || !apiKey.trim()}
          style={{
            padding: '8px 0', background: saving ? '#555' : '#3b82f6', color: '#fff',
            border: 'none', borderRadius: 4, cursor: saving ? 'default' : 'pointer', fontSize: 14, fontWeight: 500,
          }}
        >
          {saving ? t('models.saving') : t('models.addProvider')}
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 8, color: msg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{msg}</div>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main ModelsView                                                    */
/* ------------------------------------------------------------------ */

type Tab = 'catalog' | 'providers' | 'custom';

const ModelsView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('catalog');
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        get<ModelCatalogEntry[]>('/models'),
        get<ProviderStatus[]>('/models/providers'),
      ]);
      setCatalog(c);
      setProviders(p);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Group catalog by provider
  const grouped = catalog.reduce<Record<string, ModelCatalogEntry[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  const providerMap = providers.reduce<Record<string, ProviderStatus>>((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {});

  const toggleProvider = (pid: string) => setExpandedProvider(prev => prev === pid ? null : pid);

  /* ---- Tab bar ---- */
  const tabBar = (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
      {([
        ['catalog', t('models.tabCatalog')],
        ['providers', t('models.tabProviders')],
        ['custom', t('models.tabCustom')],
      ] as [Tab, string][]).map(([tabKey, label]) => (
        <button
          key={tabKey}
          onClick={() => setTab(tabKey)}
          style={{
            padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
            background: tab === tabKey ? '#3b82f6' : '#1e1e2e', color: tab === tabKey ? '#fff' : '#999',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div style={{ padding: 24, color: '#999' }}>
        {tabBar}
        <div>{t('models.loading')}</div>
      </div>
    );
  }

  /* ---- Catalog tab ---- */
  const renderCatalog = () => {
    const providerIds = Object.keys(grouped);
    if (providerIds.length === 0) return <div style={{ color: '#999' }}>{t('models.noModelData')}</div>;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {providerIds.map(pid => {
          const models = grouped[pid];
          const ps = providerMap[pid];
          const isExpanded = expandedProvider === pid;
          const configuredCount = models.filter(m => m.configured).length;

          return (
            <div key={pid} style={{ background: '#12121a', borderRadius: 8, overflow: 'hidden' }}>
              {/* Provider header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: '#1a1a2e',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#e6e6e6' }}>
                    {ps?.label ?? pid}
                  </span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: configuredCount > 0 ? '#065f46' : '#3f3f46',
                    color: configuredCount > 0 ? '#6ee7b7' : '#a1a1aa',
                  }}>
                    {t('models.available', { configured: configuredCount, total: models.length })}
                  </span>
                </div>
                <button
                  onClick={() => toggleProvider(pid)}
                  style={{
                    padding: '4px 12px', fontSize: 12, border: '1px solid #444', borderRadius: 4,
                    background: isExpanded ? '#3b82f6' : 'transparent',
                    color: isExpanded ? '#fff' : '#93c5fd', cursor: 'pointer',
                  }}
                >
                  {isExpanded ? t('models.collapse') : t('models.configureApiKey')}
                </button>
              </div>

              {/* Inline key form */}
              {isExpanded && (
                <div style={{ padding: '0 14px 10px' }}>
                  <ProviderKeyForm
                    providerId={pid}
                    providerLabel={ps?.label ?? pid}
                    detected={ps?.detected ?? false}
                    maskedKey={ps?.maskedKey}
                    onSaved={refresh}
                  />
                </div>
              )}

              {/* Model list */}
              <div style={{ padding: '6px 14px 10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#888', textAlign: 'left' }}>
                      <th style={{ padding: '4px 6px', fontWeight: 500 }}>{t('models.colModel')}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 500 }}>{t('models.colContext')}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 500 }}>{t('models.colInput')}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 500 }}>{t('models.colReasoning')}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>{t('models.colCost')}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'center' }}>{t('models.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map(m => (
                      <tr key={m.ref} style={{ borderTop: '1px solid #1e1e2e' }}>
                        <td style={{ padding: '5px 6px', color: '#e6e6e6' }}>
                          <div>{m.name}</div>
                          <div style={{ fontSize: 11, color: '#666' }}>{m.ref}</div>
                        </td>
                        <td style={{ padding: '5px 6px', color: '#999' }}>{(m.contextWindow / 1000).toFixed(0)}K</td>
                        <td style={{ padding: '5px 6px', color: '#999' }}>{m.input.join(', ')}</td>
                        <td style={{ padding: '5px 6px' }}>{m.reasoning ? '🧠' : '—'}</td>
                        <td style={{ padding: '5px 6px', color: '#999', textAlign: 'right' }}>
                          ${m.cost.input} / ${m.cost.output}
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                          {m.configured
                            ? <span style={{ color: '#4ade80' }}>✅</span>
                            : <span style={{ color: '#666' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /* ---- Providers tab ---- */
  const renderProviders = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {providers.map(p => {
        const isExpanded = expandedProvider === p.id;
        return (
          <div key={p.id} style={{ background: '#12121a', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#e6e6e6' }}>{p.label}</span>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: p.detected ? '#065f46' : '#3f3f46',
                  color: p.detected ? '#6ee7b7' : '#a1a1aa',
                }}>
                  {p.detected ? t('models.providerConfigured', { count: p.profileCount }) : t('models.providerNotConfigured')}
                </span>
              </div>
              <button
                onClick={() => toggleProvider(p.id)}
                style={{
                  padding: '4px 12px', fontSize: 12, border: '1px solid #444', borderRadius: 4,
                  background: isExpanded ? '#3b82f6' : 'transparent',
                  color: isExpanded ? '#fff' : '#93c5fd', cursor: 'pointer',
                }}
              >
                {isExpanded ? t('models.collapse') : t('models.configure')}
              </button>
            </div>
            {isExpanded && (
              <ProviderKeyForm
                providerId={p.id}
                providerLabel={p.label}
                detected={p.detected}
                maskedKey={p.maskedKey}
                onSaved={refresh}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  /* ---- Custom provider tab ---- */
  const renderCustom = () => <CustomProviderForm onSaved={refresh} />;

  /* ---- Summary bar ---- */
  const totalConfigured = catalog.filter(m => m.configured).length;

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e6e6e6' }}>🧩 {t('models.title')}</div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
            {t('models.summary', { total: catalog.length, configured: totalConfigured })}
          </div>
        </div>
        <button
          onClick={() => { setLoading(true); refresh(); }}
          style={{
            padding: '6px 14px', background: '#1e1e2e', color: '#93c5fd', border: '1px solid #333',
            borderRadius: 4, cursor: 'pointer', fontSize: 13,
          }}
        >
          {t('models.refresh')}
        </button>
      </div>

      {tabBar}

      {tab === 'catalog' && renderCatalog()}
      {tab === 'providers' && renderProviders()}
      {tab === 'custom' && renderCustom()}
    </div>
  );
};

export default ModelsView;
