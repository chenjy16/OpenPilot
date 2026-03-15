import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post, put, del } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Legacy in-memory cron job (agent-based) */
interface LegacyCronJob {
  id: string;
  schedule: string;
  agentId: string;
  message: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
}

/** DB-backed scheduler job (handler-based) */
interface SchedulerJob {
  id: string;
  name: string;
  schedule: string;
  handler: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  lastRunAt?: number;
  lastStatus?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}


// ---------------------------------------------------------------------------
// Scheduler Job Card (editable)
// ---------------------------------------------------------------------------

function SchedulerJobCard({
  job,
  onToggle,
  onTrigger,
  onSave,
}: {
  job: SchedulerJob;
  onToggle: () => void;
  onTrigger: () => void;
  onSave: (updates: Partial<SchedulerJob>) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(job.name);
  const [schedule, setSchedule] = useState(job.schedule);
  const [configStr, setConfigStr] = useState(job.config ? JSON.stringify(job.config, null, 2) : '');
  const [triggering, setTriggering] = useState(false);

  const handleSave = () => {
    const updates: Partial<SchedulerJob> = {};
    if (name !== job.name) updates.name = name;
    if (schedule !== job.schedule) updates.schedule = schedule;
    try {
      const parsed = configStr.trim() ? JSON.parse(configStr) : undefined;
      if (JSON.stringify(parsed) !== JSON.stringify(job.config)) {
        updates.config = parsed;
      }
    } catch { /* ignore parse error */ }
    onSave(updates);
    setEditing(false);
  };

  const handleTrigger = async () => {
    setTriggering(true);
    onTrigger();
    // Keep spinner for a bit since trigger is async
    setTimeout(() => setTriggering(false), 3000);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${job.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}
            aria-label={job.enabled ? t('cron.disable') : t('cron.enable')}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${job.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded border border-gray-300 px-2 py-0.5 text-sm"
            />
          ) : (
            <span className="text-sm font-medium text-gray-800">{job.name}</span>
          )}
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{job.handler}</span>
        </div>
        <div className="flex items-center gap-2">
          {job.lastStatus && (
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              job.lastStatus === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {job.lastStatus}
            </span>
          )}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            {triggering ? t('cron.runningNow') : t('cron.runNow')}
          </button>
          <button
            onClick={() => editing ? handleSave() : setEditing(true)}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            {editing ? `💾 ${t('common.save')}` : `✏️ ${t('common.edit')}`}
          </button>
          {editing && (
            <button
              onClick={() => { setEditing(false); setName(job.name); setSchedule(job.schedule); setConfigStr(job.config ? JSON.stringify(job.config, null, 2) : ''); }}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* Schedule */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-gray-500">{t('cron.schedule')}:</span>
        {editing ? (
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs font-mono"
            placeholder="0 */4 * * *"
          />
        ) : (
          <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{job.schedule}</code>
        )}
      </div>

      {/* Config */}
      {(editing || job.config) && (
        <div className="mt-2">
          <span className="text-xs text-gray-500">{t('cron.config')}:</span>
          {editing ? (
            <textarea
              value={configStr}
              onChange={(e) => setConfigStr(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
          ) : (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
              {JSON.stringify(job.config, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Meta */}
      <div className="mt-2 flex gap-4 text-xs text-gray-400">
        {job.lastRunAt && (
          <span>{t('cron.lastRun')}: {new Date(job.lastRunAt * 1000).toLocaleString()}</span>
        )}
        {job.lastError && (
          <span className="text-red-400">{t('cron.errorLabel')}: {job.lastError}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const CronView: React.FC = () => {
  const { t } = useTranslation();
  const [legacyJobs, setLegacyJobs] = useState<LegacyCronJob[]>([]);
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ schedule: '', agentId: 'default', message: '' });

  const fetchData = useCallback(async () => {
    try {
      const [jobsData, schedulerData] = await Promise.all([
        get<LegacyCronJob[]>('/cron/jobs'),
        get<SchedulerJob[]>('/cron/scheduler/jobs'),
      ]);
      setLegacyJobs(jobsData);
      setSchedulerJobs(schedulerData);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 10000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // Legacy job actions
  const handleCreate = async () => {
    if (!formData.schedule || !formData.message) return;
    try {
      await post('/cron/jobs', formData);
      setShowForm(false);
      setFormData({ schedule: '', agentId: 'default', message: '' });
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleLegacyToggle = async (id: string) => {
    try { await post(`/cron/jobs/${id}/toggle`); fetchData(); } catch (err) { setError((err as Error).message); }
  };
  const handleLegacyDelete = async (id: string) => {
    try { await del(`/cron/jobs/${id}`); fetchData(); } catch (err) { setError((err as Error).message); }
  };
  const handleLegacyRun = async (id: string) => {
    try { await post(`/cron/jobs/${id}/run`); fetchData(); } catch (err) { setError((err as Error).message); }
  };

  // Scheduler job actions
  const handleSchedulerToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await put(`/cron/scheduler/jobs/${id}`, { enabled: !currentEnabled });
      fetchData();
    } catch (err) { setError((err as Error).message); }
  };
  const handleSchedulerTrigger = async (id: string) => {
    try { await post(`/cron/scheduler/jobs/${id}/trigger`); setTimeout(fetchData, 5000); } catch (err) { setError((err as Error).message); }
  };
  const handleSchedulerSave = async (id: string, updates: Partial<SchedulerJob>) => {
    if (Object.keys(updates).length === 0) return;
    try {
      await put(`/cron/scheduler/jobs/${id}`, updates);
      fetchData();
    } catch (err) { setError((err as Error).message); }
  };

  const totalJobs = legacyJobs.length + schedulerJobs.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⏰</span>
          <h1 className="text-lg font-semibold text-gray-800">{t('cron.title')}</h1>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {t('cron.taskCount', { count: totalJobs })}
          </span>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          {showForm ? t('common.cancel') : t('cron.newTask')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {showForm && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-blue-700">{t('cron.createTask')}</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">{t('cron.cronExpression')}</label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={e => setFormData(d => ({ ...d, schedule: e.target.value }))}
                  placeholder={t('cron.cronPlaceholder')}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">{t('cron.agentId')}</label>
                <input
                  type="text"
                  value={formData.agentId}
                  onChange={e => setFormData(d => ({ ...d, agentId: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">{t('cron.taskMessage')}</label>
                <textarea
                  value={formData.message}
                  onChange={e => setFormData(d => ({ ...d, message: e.target.value }))}
                  placeholder={t('cron.taskMessagePlaceholder')}
                  rows={3}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!formData.schedule || !formData.message}
                className="rounded bg-blue-500 px-4 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {t('cron.create')}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">{t('common.loading')}</div>
        ) : totalJobs === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <div className="mb-3 text-4xl">⏰</div>
            <p className="text-sm text-gray-500">{t('cron.noTasks')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('cron.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Scheduler Jobs (DB-backed) */}
            {schedulerJobs.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-gray-600">{t('cron.systemTasks')}</h2>
                <div className="space-y-3">
                  {schedulerJobs.map(job => (
                    <SchedulerJobCard
                      key={job.id}
                      job={job}
                      onToggle={() => handleSchedulerToggle(job.id, job.enabled)}
                      onTrigger={() => handleSchedulerTrigger(job.id)}
                      onSave={(updates) => handleSchedulerSave(job.id, updates)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Legacy Jobs (agent-based) */}
            {legacyJobs.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-gray-600">{t('cron.agentTasks')}</h2>
                <div className="space-y-3">
                  {legacyJobs.map(job => (
                    <div key={job.id} className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleLegacyToggle(job.id)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${job.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}
                            aria-label={job.enabled ? t('cron.disable') : t('cron.enable')}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${job.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                          <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{job.schedule}</code>
                          <span className="text-xs text-gray-500">→ {job.agentId}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {job.lastStatus && (
                            <span className={`rounded-full px-2 py-0.5 text-xs ${
                              job.lastStatus === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {job.lastStatus}
                            </span>
                          )}
                          <button onClick={() => handleLegacyRun(job.id)} className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50">{t('cron.runNow')}</button>
                          <button onClick={() => handleLegacyDelete(job.id)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">{t('common.delete')}</button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-gray-600">{job.message}</p>
                      {job.lastRunAt && (
                        <p className="mt-1 text-xs text-gray-400">{t('cron.lastRun')}: {new Date(job.lastRunAt).toLocaleString()}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CronView;
