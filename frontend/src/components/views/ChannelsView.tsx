import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post, put, del } from '../../services/apiClient';

interface ChannelInfo {
  type: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  statusMessage?: string;
  connectedAt?: string;
  messageCount: number;
  accounts?: AccountSnapshot[];
}

interface AccountSnapshot {
  accountId: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number | null;
  lastError?: string | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
}

interface ChannelField {
  key: string;
  label: string;
  type: 'password' | 'text' | 'boolean' | 'array';
  required: boolean;
  envVar?: string;
  description?: string;
}

interface ChannelCapabilities {
  chatTypes?: string[];
  reactions?: boolean;
  edit?: boolean;
  media?: boolean;
  polls?: boolean;
  threads?: boolean;
  streaming?: boolean;
  maxTextLength?: number;
}

interface AvailableChannel {
  type: string;
  label: string;
  icon: string;
  blurb?: string;
  order?: number;
  fields: ChannelField[];
  capabilities?: ChannelCapabilities | null;
  registered: boolean;
  status: string;
  configuredViaEnv: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green-100 text-green-700',
  disconnected: 'bg-gray-100 text-gray-500',
  connecting: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  connected: 'channels.statusConnected',
  disconnected: 'channels.statusDisconnected',
  connecting: 'channels.statusConnecting',
  error: 'channels.statusError',
};

function timeAgo(ts: number | null | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('channels.timeAgoSeconds', { count: Math.floor(diff / 1000) });
  if (diff < 3600_000) return t('channels.timeAgoMinutes', { count: Math.floor(diff / 60_000) });
  if (diff < 86400_000) return t('channels.timeAgoHours', { count: Math.floor(diff / 3600_000) });
  return new Date(ts).toLocaleDateString();
}

const ChannelsView: React.FC = () => {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [available, setAvailable] = useState<AvailableChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveMsgIsError, setSaveMsgIsError] = useState(false);
  const [securityPanel, setSecurityPanel] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [ch, av] = await Promise.all([
        get<ChannelInfo[]>('/channels'),
        get<AvailableChannel[]>('/channels/available'),
      ]);
      setChannels(ch);
      setAvailable(av);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 10000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const handleReconnect = async (type: string) => {
    setBusyType(type);
    try {
      await post(`/channels/${encodeURIComponent(type)}/reconnect`, {});
      await fetchAll();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyType(null); }
  };

  const handleDisconnect = async (type: string) => {
    setBusyType(type);
    try {
      await post(`/channels/${encodeURIComponent(type)}/disconnect`, {});
      await fetchAll();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyType(null); }
  };

  const handleConfigure = async (type: string) => {
    setConfiguring(type);
    setConfigValues({});
    setSaveMsg(null);
    setSaveMsgIsError(false);
    // Fetch existing config (masked) to pre-fill
    try {
      const resp = await get<{ config: Record<string, string> }>(`/channels/${encodeURIComponent(type)}/config`);
      if (resp.config && Object.keys(resp.config).length > 0) {
        // Filter out non-string values like 'enabled: true'
        const vals: Record<string, string> = {};
        for (const [k, v] of Object.entries(resp.config)) {
          vals[k] = String(v ?? '');
        }
        setConfigValues(vals);
      }
    } catch { /* ignore — just show empty form */ }
  };

  const handleSaveConfig = async () => {
    if (!configuring) return;
    setBusyType(configuring);
    setSaveMsg(null);
    try {
      // Filter out masked placeholder values (••••xxxx) — backend keeps existing values for omitted keys
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(configValues)) {
        if (typeof v === 'string' && v.startsWith('••••')) continue; // skip masked placeholders
        filtered[k] = v;
      }
      const result = await put<{ ok: boolean; connectError?: string }>(
        `/channels/${encodeURIComponent(configuring)}/config`,
        { config: filtered, connect: true },
      );
      if (result.connectError) {
        setSaveMsg(t('channels.configSavedConnectFailed', { error: result.connectError }));
        setSaveMsgIsError(true);
      } else {
        setSaveMsg(t('channels.configSavedConnected'));
        setSaveMsgIsError(false);
        setTimeout(() => { setConfiguring(null); setSaveMsg(null); }, 2000);
      }
      await fetchAll();
    } catch (err) {
      setSaveMsg(t('channels.saveFailed', { message: (err as Error).message }));
      setSaveMsgIsError(true);
    } finally {
      setBusyType(null);
    }
  };

  const handleRemoveChannel = async (type: string) => {
    setBusyType(type);
    try {
      await del(`/channels/${encodeURIComponent(type)}/config`);
      await fetchAll();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyType(null); }
  };

  const registered = channels.filter(c => c.status === 'connected' || c.status === 'connecting');
  const unregistered = available.filter(a => !a.registered && !a.configuredViaEnv);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <h1 className="text-lg font-semibold text-gray-800">{t('channels.title')}</h1>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
            {t('channels.connectedCount', { count: registered.length })}
          </span>
        </div>
        <button onClick={fetchAll}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
          {t('channels.refresh')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">{t('channels.loading')}</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
        ) : (
          <div className="space-y-6">
            {/* Active channels */}
            {channels.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-medium text-gray-600">{t('channels.configuredChannels')}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {channels.map(ch => {
                    const av = available.find(a => a.type === ch.type);
                    return (
                      <ChannelCard key={ch.type} channel={ch} avail={av}
                        busy={busyType === ch.type}
                        onReconnect={() => handleReconnect(ch.type)}
                        onDisconnect={() => handleDisconnect(ch.type)}
                        onConfigure={() => handleConfigure(ch.type)}
                        onRemove={() => handleRemoveChannel(ch.type)}
                        onSecurity={() => setSecurityPanel(ch.type)} />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add new channel */}
            {unregistered.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-medium text-gray-400">{t('channels.addChannel')}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {unregistered.map(ch => (
                    <div key={ch.type} className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{ch.icon}</span>
                        <span className="text-sm font-medium text-gray-700">{ch.label}</span>
                      </div>
                      {ch.blurb && (
                        <p className="text-xs text-gray-400 mb-1">{ch.blurb}</p>
                      )}
                      {ch.capabilities && (
                        <CapabilityBadges caps={ch.capabilities} />
                      )}
                      <p className="text-xs text-gray-400 mb-3 mt-1">
                        {ch.fields.filter(f => f.required).map(f => f.label).join('、')} {t('channels.required')}
                      </p>
                      <button onClick={() => handleConfigure(ch.type)}
                        className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600">
                        {t('channels.configure')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {channels.length === 0 && unregistered.length === 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                <div className="mb-3 text-4xl">🔗</div>
                <p className="text-sm text-gray-500">{t('channels.noChannelsAvailable')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Config dialog */}
      {configuring && (
        <ChannelConfigDialog
          channelType={configuring}
          channel={available.find(a => a.type === configuring)}
          values={configValues}
          onChange={setConfigValues}
          onSave={handleSaveConfig}
          onCancel={() => { setConfiguring(null); setSaveMsg(null); }}
          saving={busyType === configuring}
          saveMsg={saveMsg}
        />
      )}

      {/* Security panel */}
      {securityPanel && (
        <SecurityPanel
          channelType={securityPanel}
          onClose={() => setSecurityPanel(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Capability badges
// ---------------------------------------------------------------------------

const CAP_LABEL_KEYS: Record<string, string> = {
  media: 'channels.capMedia',
  reactions: 'channels.capReactions',
  threads: 'channels.capThreads',
  edit: 'channels.capEdit',
  polls: 'channels.capPolls',
  streaming: 'channels.capStreaming',
};

const CapabilityBadges: React.FC<{ caps: ChannelCapabilities }> = ({ caps }) => {
  const { t } = useTranslation();
  const active = Object.entries(CAP_LABEL_KEYS).filter(([k]) => (caps as any)[k]);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {active.map(([k, labelKey]) => (
        <span key={k} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
          {t(labelKey)}
        </span>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Channel card (active channels)
// ---------------------------------------------------------------------------

const ChannelCard: React.FC<{
  channel: ChannelInfo; avail?: AvailableChannel; busy: boolean;
  onReconnect: () => void; onDisconnect: () => void;
  onConfigure: () => void; onRemove: () => void;
  onSecurity: () => void;
}> = ({ channel, avail, busy, onReconnect, onDisconnect, onConfigure, onRemove, onSecurity }) => {
  const { t } = useTranslation();
  const icon = avail?.icon ?? '📡';
  const account = channel.accounts?.[0];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <span className="text-sm font-medium text-gray-700 capitalize">{avail?.label ?? channel.type}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[channel.status]}`}>
          {t(STATUS_LABEL_KEYS[channel.status])}
        </span>
      </div>

      {channel.statusMessage && (
        <p className="mt-2 text-xs text-gray-500">{channel.statusMessage}</p>
      )}

      {avail?.capabilities && <CapabilityBadges caps={avail.capabilities} />}

      {/* Account-level details */}
      {account && (
        <div className="mt-2 space-y-0.5 text-[11px] text-gray-400">
          {account.reconnectAttempts != null && account.reconnectAttempts > 0 && (
            <div className="text-yellow-600">{t('channels.reconnectAttempts', { count: account.reconnectAttempts })}</div>
          )}
          {account.lastError && (
            <div className="text-red-500 truncate" title={account.lastError}>
              {t('channels.error')}: {account.lastError}
            </div>
          )}
          {account.lastInboundAt && (
            <div>{t('channels.lastInbound')}: {timeAgo(account.lastInboundAt, t)}</div>
          )}
          {account.lastOutboundAt && (
            <div>{t('channels.lastOutbound')}: {timeAgo(account.lastOutboundAt, t)}</div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>{t('channels.messages')}: {channel.messageCount}</span>
        {channel.connectedAt && (
          <span>{t('channels.connectedAt')}: {new Date(channel.connectedAt).toLocaleString()}</span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {channel.status === 'connected' || channel.status === 'connecting' ? (
          <>
            <button onClick={onReconnect} disabled={busy}
              className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
              {t('channels.reconnect')}
            </button>
            <button onClick={onDisconnect} disabled={busy}
              className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-300 disabled:opacity-50">
              {t('channels.disconnect')}
            </button>
          </>
        ) : (
          <button onClick={onReconnect} disabled={busy}
            className="rounded bg-green-500 px-2 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-50">
            {t('channels.connect')}
          </button>
        )}
        <button onClick={onConfigure} disabled={busy}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          ⚙️ {t('channels.configure')}
        </button>
        <button onClick={onSecurity} disabled={busy}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          🛡️ {t('channels.security')}
        </button>
        <button onClick={onRemove} disabled={busy}
          className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50">
          {t('channels.delete')}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Channel config dialog
// ---------------------------------------------------------------------------

const ChannelConfigDialog: React.FC<{
  channelType: string;
  channel?: AvailableChannel;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveMsg: string | null;
}> = ({ channelType, channel, values, onChange, onSave, onCancel, saving, saveMsg }) => {
  const { t } = useTranslation();
  const fields = channel?.fields ?? [];
  const requiredFilled = fields.filter(f => f.required).every(f => values[f.key]?.trim());

  // Track which password fields are revealed and their raw values
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [rawCache, setRawCache] = useState<Record<string, string>>({});
  const [loadingRaw, setLoadingRaw] = useState(false);
  // Track which fields the user has manually edited (so we don't submit masked placeholders)
  const [edited, setEdited] = useState<Set<string>>(new Set());

  const isMasked = (val: string) => val.startsWith('••••');

  const handleReveal = async (fieldKey: string) => {
    if (revealed[fieldKey]) {
      // Toggle back to masked
      setRevealed(prev => ({ ...prev, [fieldKey]: false }));
      return;
    }
    // If we already have the raw value cached, just reveal
    if (rawCache[fieldKey]) {
      setRevealed(prev => ({ ...prev, [fieldKey]: true }));
      return;
    }
    // Fetch raw config from backend
    setLoadingRaw(true);
    try {
      const resp = await get<{ config: Record<string, string> }>(
        `/channels/${encodeURIComponent(channelType)}/config/raw`
      );
      if (resp.config) {
        const newCache: Record<string, string> = {};
        for (const [k, v] of Object.entries(resp.config)) {
          if (typeof v === 'string') newCache[k] = v;
        }
        setRawCache(newCache);
      }
      setRevealed(prev => ({ ...prev, [fieldKey]: true }));
    } catch { /* ignore */ }
    finally { setLoadingRaw(false); }
  };

  const handleFieldChange = (key: string, val: string) => {
    setEdited(prev => new Set(prev).add(key));
    onChange({ ...values, [key]: val });
  };

  // When saving, the parent handleSaveConfig filters out masked placeholders
  const handleSaveFiltered = () => {
    onSave();
  };

  const getDisplayValue = (field: ChannelField): string => {
    const val = values[field.key] ?? '';
    if (field.type === 'password' && revealed[field.key] && rawCache[field.key] && !edited.has(field.key)) {
      return rawCache[field.key];
    }
    return val;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-4">
          <span className="text-xl">{channel?.icon ?? '📡'}</span>
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              {t('channels.configureChannel', { name: channel?.label ?? channelType })}
            </h3>
            {channel?.blurb && (
              <p className="text-xs text-gray-400">{channel.blurb}</p>
            )}
          </div>
        </div>
        <div className="space-y-4 px-5 py-4">
          {fields.map(field => {
            const val = values[field.key] ?? '';
            const isPasswordField = field.type === 'password';
            const isRevealed = revealed[field.key];
            const hasMaskedValue = isMasked(val) && !edited.has(field.key);
            const displayVal = getDisplayValue(field);

            return (
              <div key={field.key}>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                {field.type === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={values[field.key] === 'true'}
                      onChange={e => handleFieldChange(field.key, e.target.checked ? 'true' : 'false')}
                      className="rounded border-gray-300" />
                    <span className="text-xs text-gray-500">{t('channels.enable')}</span>
                  </label>
                ) : (
                  <div className="relative">
                    <input
                      type={isPasswordField && !isRevealed ? 'password' : 'text'}
                      value={displayVal}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.envVar ? t('channels.orSetEnvVar', { envVar: field.envVar }) : ''}
                      className={`w-full rounded border px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                        hasMaskedValue ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-300'
                      } ${isPasswordField ? 'pr-16' : ''}`}
                    />
                    {isPasswordField && isMasked(val) && !edited.has(field.key) && (
                      <button
                        type="button"
                        onClick={() => handleReveal(field.key)}
                        disabled={loadingRaw}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-blue-500 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {loadingRaw ? '...' : isRevealed ? t('channels.hide') : t('channels.show')}
                      </button>
                    )}
                  </div>
                )}
                {field.description && (
                  <p className="mt-0.5 text-xs text-gray-400">{field.description}</p>
                )}
                {hasMaskedValue && !isRevealed && (
                  <p className="mt-0.5 text-xs text-green-600">{t('channels.configuredOverride')}</p>
                )}
              </div>
            );
          })}
        </div>
        {saveMsg && (
          <div className={`mx-5 mb-2 rounded px-3 py-1.5 text-xs ${saveMsgIsError ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {saveMsg}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            {t('channels.cancel')}
          </button>
          <button onClick={handleSaveFiltered} disabled={!requiredFilled || saving}
            className="rounded bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
            {saving ? t('channels.saving') : t('channels.saveAndConnect')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChannelsView;

// ---------------------------------------------------------------------------
// Security & Pairing Management Panel
// ---------------------------------------------------------------------------

interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt?: string;
  meta?: Record<string, string>;
}

interface AllowFromData {
  channel: string;
  accountId: string;
  store: string[];
  config: string[];
  merged: string[];
}

interface SecurityInfo {
  channel: string;
  dmPolicy: string;
  allowFrom: string[];
}

const SecurityPanel: React.FC<{
  channelType: string;
  onClose: () => void;
}> = ({ channelType, onClose }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'pairing' | 'allowlist'>('pairing');
  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [allowFromData, setAllowFromData] = useState<AllowFromData | null>(null);
  const [securityInfo, setSecurityInfo] = useState<SecurityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEntry, setNewEntry] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [requests, allowFrom, security] = await Promise.all([
        get<PairingRequest[]>(`/pairing/requests?channel=${encodeURIComponent(channelType)}`),
        get<AllowFromData>(`/channels/${encodeURIComponent(channelType)}/allow-from`),
        get<SecurityInfo>(`/channels/${encodeURIComponent(channelType)}/security`),
      ]);
      setPairingRequests(Array.isArray(requests) ? requests : []);
      setAllowFromData(allowFrom);
      setSecurityInfo(security);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [channelType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleApprove = async (code: string) => {
    try {
      await post('/pairing/approve', { channel: channelType, code });
      setMsg(t('channels.approved'));
      setMsgIsError(false);
      await fetchData();
    } catch (err) { setMsg(t('channels.approveFailed', { message: (err as Error).message })); setMsgIsError(true); }
  };

  const handleAddEntry = async () => {
    if (!newEntry.trim()) return;
    try {
      await post(`/channels/${encodeURIComponent(channelType)}/allow-from`, { entry: newEntry.trim() });
      setNewEntry('');
      setMsg(t('channels.added'));
      setMsgIsError(false);
      await fetchData();
    } catch (err) { setMsg(t('channels.addFailed', { message: (err as Error).message })); setMsgIsError(true); }
  };

  const handleRemoveEntry = async (entry: string) => {
    try {
      await del(`/channels/${encodeURIComponent(channelType)}/allow-from`, { entry });
      setMsg(t('channels.removed'));
      setMsgIsError(false);
      await fetchData();
    } catch (err) { setMsg(t('channels.removeFailed', { message: (err as Error).message })); setMsgIsError(true); }
  };

  const POLICY_LABELS: Record<string, string> = {
    open: t('channels.policyOpen'),
    pairing: t('channels.policyPairing'),
    allowlist: t('channels.policyAllowlist'),
    disabled: t('channels.policyDisabled'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">{t('channels.securityManagement', { type: channelType })}</h3>
            {securityInfo && (
              <p className="text-xs text-gray-400 mt-0.5">
                {POLICY_LABELS[securityInfo.dmPolicy] ?? securityInfo.dmPolicy}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button onClick={() => setTab('pairing')}
            className={`flex-1 px-4 py-2 text-xs font-medium ${tab === 'pairing' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400'}`}>
            {t('channels.pairingRequests')} {pairingRequests.length > 0 && `(${pairingRequests.length})`}
          </button>
          <button onClick={() => setTab('allowlist')}
            className={`flex-1 px-4 py-2 text-xs font-medium ${tab === 'allowlist' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400'}`}>
            {t('channels.allowlist')} {allowFromData?.merged?.length ? `(${allowFromData.merged.length})` : ''}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-8">{t('channels.loading')}</div>
          ) : tab === 'pairing' ? (
            <div className="space-y-3">
              {pairingRequests.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-8">
                  {t('channels.noPairingRequests')}
                </div>
              ) : (
                pairingRequests.map(req => (
                  <div key={req.code} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                    <div>
                      <div className="text-sm font-mono text-gray-700">{req.id}</div>
                      <div className="text-xs text-gray-400">
                        {t('channels.pairingCode')}: <span className="font-mono font-semibold text-blue-600">{req.code}</span>
                        {' · '}{t('channels.createdAt')}: {new Date(req.createdAt).toLocaleString()}
                      </div>
                      {req.meta?.senderName && (
                        <div className="text-xs text-gray-400">{t('channels.name')}: {req.meta.senderName}</div>
                      )}
                    </div>
                    <button onClick={() => handleApprove(req.code)}
                      className="rounded bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600">
                      {t('channels.approve')}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Add new entry */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newEntry}
                  onChange={e => setNewEntry(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
                  placeholder={t('channels.enterUserId')}
                  className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button onClick={handleAddEntry} disabled={!newEntry.trim()}
                  className="rounded bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50">
                  {t('channels.add')}
                </button>
              </div>

              {/* Config entries (read-only) */}
              {allowFromData?.config && allowFromData.config.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">{t('channels.configAllowlistReadonly')}</div>
                  {allowFromData.config.map(entry => (
                    <div key={`cfg-${entry}`} className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-3 py-1.5 mb-1">
                      <span className="text-sm font-mono text-gray-600">{entry}</span>
                      <span className="text-[10px] text-gray-400">{t('channels.configLabel')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Store entries (editable) */}
              {allowFromData?.store && allowFromData.store.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">{t('channels.pairedAllowlist')}</div>
                  {allowFromData.store.map(entry => (
                    <div key={`store-${entry}`} className="flex items-center justify-between rounded border border-gray-200 px-3 py-1.5 mb-1">
                      <span className="text-sm font-mono text-gray-700">{entry}</span>
                      <button onClick={() => handleRemoveEntry(entry)}
                        className="text-xs text-red-400 hover:text-red-600">
                        {t('channels.remove')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {(!allowFromData?.merged || allowFromData.merged.length === 0) && (
                <div className="text-center text-sm text-gray-400 py-4">
                  {t('channels.allowlistEmpty')}
                </div>
              )}
            </div>
          )}
        </div>

        {msg && (
          <div className={`mx-5 mb-3 rounded px-3 py-1.5 text-xs ${msgIsError ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
};
