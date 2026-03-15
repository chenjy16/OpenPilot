import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Navigation tabs matching OpenClaw product design doc §2.3
export type NavTab =
  | 'chat'
  | 'overview'
  | 'channels'
  | 'sessions'
  | 'usage'
  | 'cron'
  | 'agents'
  | 'skills'
  | 'nodes'
  | 'models'
  | 'polymarket'
  | 'stocks'
  | 'portfolio'
  | 'trading'
  | 'performance'
  | 'live'
  | 'config';

export interface NavGroup {
  label: string;
  tabs: { id: NavTab; label: string; icon: string }[];
}

// Nav group definitions use i18n keys for labels (resolved at render time)
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Chat',
    tabs: [{ id: 'chat', label: 'nav.chat', icon: '💬' }],
  },
  {
    label: 'Control',
    tabs: [
      { id: 'overview', label: 'nav.overview', icon: '📊' },
      { id: 'channels', label: 'nav.channels', icon: '🔗' },
      { id: 'sessions', label: 'nav.sessions', icon: '📄' },
      { id: 'usage', label: 'nav.usage', icon: '📈' },
      { id: 'cron', label: 'nav.cron', icon: '⏰' },
    ],
  },
  {
    label: 'Agent',
    tabs: [
      { id: 'agents', label: 'nav.agents', icon: '🤖' },
      { id: 'skills', label: 'nav.skills', icon: '⚡' },
      { id: 'nodes', label: 'nav.nodes', icon: '🖥️' },
    ],
  },
  {
    label: 'Scenario Navigators',
    tabs: [
      { id: 'polymarket', label: 'nav.polymarket', icon: '🔮' },
      { id: 'stocks', label: 'nav.stocks', icon: '📈' },
      { id: 'portfolio', label: 'nav.portfolio', icon: '💼' },
      { id: 'trading', label: 'nav.trading', icon: '📊' },
      { id: 'performance', label: 'nav.performance', icon: '🏆' },
      { id: 'live', label: 'nav.live', icon: '📺' },
    ],
  },
  {
    label: 'Settings',
    tabs: [
      { id: 'models', label: 'nav.models', icon: '🧩' },
      { id: 'config', label: 'nav.config', icon: '⚙️' },
    ],
  },
];

interface UIState {
  activeTab: NavTab;
  sidebarCollapsed: boolean;
  // Legacy compat — kept for existing tests
  toolPanelCollapsed: boolean;
  activeToolTab: string;
  focusMode: boolean;

  setActiveTab: (tab: NavTab) => void;
  toggleSidebar: () => void;
  toggleToolPanel: () => void;
  setActiveToolTab: (tab: string) => void;
  setFocusMode: (on: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeTab: 'chat',
      sidebarCollapsed: false,
      toolPanelCollapsed: true,
      activeToolTab: 'system-monitor',
      focusMode: false,

      setActiveTab: (tab: NavTab) => set({ activeTab: tab }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleToolPanel: () => set((s) => ({ toolPanelCollapsed: !s.toolPanelCollapsed })),
      setActiveToolTab: (tab: string) => set({ activeToolTab: tab }),
      setFocusMode: (on: boolean) => set({ focusMode: on }),
    }),
    { name: 'openpilot-ui' }
  )
);
