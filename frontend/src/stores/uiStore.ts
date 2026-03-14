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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Chat',
    tabs: [{ id: 'chat', label: '对话', icon: '💬' }],
  },
  {
    label: 'Control',
    tabs: [
      { id: 'overview', label: '总览', icon: '📊' },
      { id: 'channels', label: '渠道', icon: '🔗' },
      { id: 'sessions', label: '会话', icon: '📄' },
      { id: 'usage', label: '用量', icon: '📈' },
      { id: 'cron', label: '定时任务', icon: '⏰' },
    ],
  },
  {
    label: 'Agent',
    tabs: [
      { id: 'agents', label: '智能体', icon: '🤖' },
      { id: 'skills', label: '技能', icon: '⚡' },
      { id: 'nodes', label: '节点', icon: '🖥️' },
    ],
  },
  {
    label: 'Scenario Navigators',
    tabs: [
      { id: 'polymarket', label: 'Polymarket Copilot', icon: '🔮' },
      { id: 'stocks', label: 'Quant Copilot', icon: '📈' },
      { id: 'portfolio', label: '投资组合', icon: '💼' },
      { id: 'trading', label: '量化交易', icon: '📊' },
      { id: 'performance', label: '交易绩效', icon: '🏆' },
      { id: 'live', label: '实盘大屏', icon: '📺' },
    ],
  },
  {
    label: 'Settings',
    tabs: [
      { id: 'models', label: '模型', icon: '🧩' },
      { id: 'config', label: '配置', icon: '⚙️' },
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
