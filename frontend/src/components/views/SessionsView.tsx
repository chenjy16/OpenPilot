import React, { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { get } from '../../services/apiClient';
import type { SessionSummary, Message } from '../../types';

const SessionsView: React.FC = () => {
  const { sessions, fetchSessions, deleteSession, setActiveSession, loading, error } = useSessionStore();
  const setMessages = useChatStore((s) => s.setMessages);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const filtered = sessions.filter((s) =>
    !filter || s.title?.toLowerCase().includes(filter.toLowerCase()) || s.id.includes(filter)
  );

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when filter changes
  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(0);
  };

  const handleOpenChat = async (session: SessionSummary) => {
    await setActiveSession(session.id);
    try {
      const data = await get<{ messages: Message[] }>(`/sessions/${session.id}`);
      setMessages(data.messages ?? []);
    } catch { /* handled by store */ }
    setActiveTab('chat');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此会话？')) return;
    await deleteSession(id);
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">会话管理</h2>
        <span className="text-sm text-gray-500">{filtered.length} / {sessions.length} 个会话</span>
      </div>

      {/* Filters */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="搜索会话..."
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading && <div className="py-8 text-center text-sm text-gray-500">加载中...</div>}

      {!loading && filtered.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-500">暂无会话</div>
      )}

      {/* Sessions table */}
      {paged.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">会话</th>
                <th className="px-4 py-3">模型</th>
                <th className="px-4 py-3">消息数</th>
                <th className="px-4 py-3">更新时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleOpenChat(s)}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {s.title || s.id.slice(0, 8)}
                    </button>
                    <div className="text-xs text-gray-400">{s.id.slice(0, 12)}...</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{s.model || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.messageCount}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(s.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>第 {page + 1} / {totalPages} 页</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              首页
            </button>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              下一页
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
            >
              末页
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionsView;
