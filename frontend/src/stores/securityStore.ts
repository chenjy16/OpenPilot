import { create } from 'zustand';
import { get, post } from '../services/apiClient';
import type { AuditLogEntry } from '../types';

export interface AuditLogFilters {
  startTime?: string;
  endTime?: string;
  action?: string;
}

interface SecurityState {
  auditLogs: AuditLogEntry[];
  domainWhitelist: string[];
  userPermissionLevel: 'normal' | 'elevated' | 'admin';
  loading: boolean;
  error: string | null;

  fetchAuditLogs: (filters?: AuditLogFilters) => Promise<void>;
  logAction: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => Promise<void>;
  fetchWhitelist: () => Promise<void>;
  isDomainAllowed: (url: string) => boolean;
}

export const useSecurityStore = create<SecurityState>((set, getState) => ({
  auditLogs: [],
  domainWhitelist: [],
  userPermissionLevel: 'admin',
  loading: false,
  error: null,

  fetchAuditLogs: async (filters?: AuditLogFilters) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filters?.startTime) params.set('startTime', filters.startTime);
      if (filters?.endTime) params.set('endTime', filters.endTime);
      if (filters?.action) params.set('action', filters.action);
      const query = params.toString();
      const endpoint = `/audit-logs${query ? `?${query}` : ''}`;
      const logs = await get<AuditLogEntry[]>(endpoint);
      set({ auditLogs: logs, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  logAction: async (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
    try {
      const newEntry = await post<AuditLogEntry>('/audit-logs', entry);
      set((state) => ({
        auditLogs: [newEntry, ...state.auditLogs],
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchWhitelist: async () => {
    try {
      const whitelist = await get<string[]>('/security/whitelist');
      set({ domainWhitelist: whitelist });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  isDomainAllowed: (url: string): boolean => {
    const { domainWhitelist } = getState();
    if (domainWhitelist.length === 0) return true;
    try {
      const hostname = new URL(url).hostname;
      return domainWhitelist.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
    } catch {
      return false;
    }
  },
}));
