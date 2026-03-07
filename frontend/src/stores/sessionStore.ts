import { create } from 'zustand';
import { get, post, del } from '../services/apiClient';
import type { SessionSummary } from '../types';

interface SessionState {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;

  fetchSessions: () => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setActiveSession: (id: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, getState) => ({
  sessions: [],
  activeSessionId: null,
  loading: false,
  error: null,

  fetchSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await get<SessionSummary[]>('/sessions');
      set({ sessions, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createSession: async () => {
    set({ loading: true, error: null });
    try {
      const session = await post<SessionSummary>('/sessions');
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  deleteSession: async (id: string) => {
    set({ error: null });
    try {
      await del(`/sessions/${id}`);
      const { activeSessionId, sessions } = getState();
      const remaining = sessions.filter((s) => s.id !== id);
      const newActiveId =
        activeSessionId === id
          ? remaining.length > 0
            ? remaining[0].id
            : null
          : activeSessionId;
      set({ sessions: remaining, activeSessionId: newActiveId });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setActiveSession: async (id: string) => {
    set({ loading: true, error: null, activeSessionId: id });
    try {
      await get(`/sessions/${id}`);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },
}));
