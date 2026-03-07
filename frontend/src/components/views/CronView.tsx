import { useState, useEffect, useCallback } from 'react';
import { get, post, del } from '../../services/apiClient';

interface CronJob {
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

interface CronStatus {
  enabled: boolean;
  running: number;
  total: number;
  nextRunAt: string | null;
}

const CronView: React.FC = () => {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ schedule: '', agentId: 'default', message: '' });

  const fetchData = useCallback(async () => {
    try {
      const [jobsData, statusData] = await Promise.all([
        get<CronJob[]>('/cron/jobs'),
        get<CronStatus>('/cron/status'),
      ]);
      setJobs(jobsData);
      setStatus(statusData);
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

  const handleToggle = async (id: string) => {
    try {
      await post(`/cron/jobs/${id}/toggle`);
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await del(`/cron/jobs/${id}`);
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRun = async (id: string) => {
    try {
      await post(`/cron/jobs/${id}/run`);
      fetchData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⏰</span>
          <h1 className="text-lg font-semibold text-gray-800">定时任务</h1>
          {status && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {status.total} 个任务
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          {showForm ? '取消' : '+ 新建任务'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {showForm && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-blue-700">新建定时任务</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Cron 表达式</label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={e => setFormData(d => ({ ...d, schedule: e.target.value }))}
                  placeholder="*/30 * * * * (每30分钟)"
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">智能体 ID</label>
                <input
                  type="text"
                  value={formData.agentId}
                  onChange={e => setFormData(d => ({ ...d, agentId: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">任务消息</label>
                <textarea
                  value={formData.message}
                  onChange={e => setFormData(d => ({ ...d, message: e.target.value }))}
                  placeholder="要发送给智能体的消息..."
                  rows={3}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!formData.schedule || !formData.message}
                className="rounded bg-blue-500 px-4 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">加载中...</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <div className="mb-3 text-4xl">⏰</div>
            <p className="text-sm text-gray-500">暂无定时任务</p>
            <p className="mt-1 text-xs text-gray-400">点击"新建任务"创建第一个定时任务</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(job => (
              <div key={job.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggle(job.id)}
                      className={`h-5 w-9 rounded-full transition-colors ${job.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}
                      aria-label={job.enabled ? '禁用' : '启用'}
                    >
                      <div className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${job.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
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
                    <button onClick={() => handleRun(job.id)} className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50">▶ 运行</button>
                    <button onClick={() => handleDelete(job.id)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">删除</button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-600">{job.message}</p>
                {job.lastRunAt && (
                  <p className="mt-1 text-xs text-gray-400">上次运行: {new Date(job.lastRunAt).toLocaleString()}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CronView;
