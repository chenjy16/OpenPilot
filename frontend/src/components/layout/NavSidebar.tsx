import React, { useState } from 'react';
import { useUIStore, NAV_GROUPS } from '../../stores/uiStore';
import type { NavTab } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';

type Theme = 'system' | 'light' | 'dark';

const NavSidebar: React.FC = () => {
  const { activeTab, setActiveTab } = useUIStore();
  const wsStatus = useChatStore((s) => s.wsStatus);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('openpilot-theme') as Theme) ?? 'system';
  });

  const statusColor =
    wsStatus === 'connected' ? 'bg-green-400' :
    wsStatus === 'reconnecting' ? 'bg-yellow-400' : 'bg-red-400';

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const cycleTheme = () => {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    localStorage.setItem('openpilot-theme', next);
    // Apply theme to document
    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  };

  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '💻';

  return (
    <div className="flex h-full w-56 flex-col bg-gray-900 text-gray-300">
      {/* App header */}
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/app.png" alt="OpenPilot" className="h-7 w-7 rounded" />
        <span className="text-base font-semibold text-white">OpenPilot</span>
        <span className={`ml-auto h-2 w-2 rounded-full ${statusColor}`} title={wsStatus} />
      </div>

      {/* Navigation groups (§2.3) */}
      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="主导航">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-2">
            <button
              onClick={() => toggleGroup(group.label)}
              className="flex w-full items-center justify-between px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-400"
            >
              <span>{group.label}</span>
              <span className="text-[8px]">{collapsedGroups[group.label] ? '▸' : '▾'}</span>
            </button>
            {!collapsedGroups[group.label] && group.tabs.map((tab) => (
              <NavItem
                key={tab.id}
                id={tab.id}
                label={tab.label}
                icon={tab.icon}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Footer with theme toggle */}
      <div className="border-t border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">v0.1.0</span>
          <button
            onClick={cycleTheme}
            className="rounded p-1 text-sm hover:bg-gray-800"
            title={`主题: ${theme}`}
          >
            {themeIcon}
          </button>
        </div>
      </div>
    </div>
  );
};

interface NavItemProps {
  id: NavTab;
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ label, icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
      active
        ? 'bg-gray-700 text-white'
        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
    }`}
  >
    <span className="text-base">{icon}</span>
    <span>{label}</span>
  </button>
);

export default NavSidebar;
