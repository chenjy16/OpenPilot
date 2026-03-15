import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import ErrorBanner from '../common/ErrorBanner';
import SessionItem from './SessionItem';
import type { Message } from '../../types';
import { get } from '../../services/apiClient';

const SessionList: React.FC = () => {
  const { t } = useTranslation();
  const {
    sessions,
    activeSessionId,
    loading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
    setActiveSession,
  } = useSessionStore();

  const setMessages = useChatStore((s) => s.setMessages);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Auto-select first session if none is active
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0 && !loading) {
      handleSelect(sessions[0].id);
    }
  }, [sessions, activeSessionId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = async (id: string) => {
    if (id === activeSessionId) return;
    useChatStore.setState({ error: null });
    await setActiveSession(id);
    try {
      const session = await get<{ messages: Message[] }>(`/sessions/${id}`);
      setMessages(session.messages ?? []);
    } catch {
      // setActiveSession already handles errors
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        onClick={createSession}
        disabled={loading}
      >
        {t('session.newSession')}
      </button>

      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => useSessionStore.setState({ error: null })}
        />
      )}

      {!loading && sessions.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-500">
          {t('session.noSessions')}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onSelect={handleSelect}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
};

export default SessionList;
