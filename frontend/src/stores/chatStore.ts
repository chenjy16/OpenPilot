import { create } from 'zustand';
import { get, post } from '../services/apiClient';
import { wsClient } from '../services/wsClient';
import type { Message } from '../types';
import { useSessionStore } from './sessionStore';
import { useConfigStore } from './configStore';
import type { WSStatus } from '../services/wsClient';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  wsStatus: WSStatus;
  error: string | null;

  sendMessage: (text: string) => Promise<void>;
  startStreaming: (sessionId: string) => void;
  appendChunk: (text: string) => void;
  endStreaming: (usage?: unknown) => void;
  compactSession: (id: string) => Promise<void>;
  setMessages: (messages: Message[]) => void;
  setWsStatus: (status: WSStatus) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  wsStatus: 'disconnected',
  error: null,

  sendMessage: async (text: string) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    const model = useConfigStore.getState().selectedModel;

    if (!sessionId) {
      set({ error: 'No active session' });
      return;
    }

    // Add user message to the list immediately
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      error: null,
    }));

    try {
      // Send via WebSocket for streaming response
      const sent = wsClient.send({ sessionId, message: text, model });
      if (!sent) {
        set({ error: 'WebSocket not connected. Please wait for reconnection.' });
      }
      // Streaming response arrives via WebSocket events (stream_start → stream_chunk → stream_end)
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  startStreaming: (sessionId: string) => {
    const activeSessionId = useSessionStore.getState().activeSessionId;
    if (sessionId !== activeSessionId) return;

    const assistantMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    set((state) => ({
      messages: [...state.messages, assistantMessage],
      isStreaming: true,
    }));
  },

  appendChunk: (text: string) => {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + text,
        };
      }
      return { messages };
    });
  },

  endStreaming: (_usage?: unknown) => {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        messages[messages.length - 1] = {
          ...last,
          isStreaming: false,
        };
      }
      return { messages, isStreaming: false };
    });
  },

  compactSession: async (id: string) => {
    set({ error: null });
    try {
      await post(`/sessions/${id}/compact`);
      // Reload messages after successful compaction
      const session = await get<{ messages: Message[] }>(`/sessions/${id}`);
      set({ messages: session.messages ?? [] });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setMessages: (messages: Message[]) => {
    set({ messages });
  },

  setWsStatus: (status: WSStatus) => {
    set({ wsStatus: status });
  },
}));
