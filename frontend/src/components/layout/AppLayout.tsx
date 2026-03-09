import { useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import type { NavTab } from '../../stores/uiStore';
import NavSidebar from './NavSidebar';
import ChatView from '../views/ChatView';
import OverviewView from '../views/OverviewView';
import SessionsView from '../views/SessionsView';
import DebugView from '../views/DebugView';
import LogsView from '../views/LogsView';
import SkillsView from '../views/SkillsView';
import AgentsView from '../views/AgentsView';
import NodesView from '../views/NodesView';
import ChannelsView from '../views/ChannelsView';
import UsageView from '../views/UsageView';
import CronView from '../views/CronView';
import ConfigView from '../views/ConfigView';
import ModelsView from '../views/ModelsView';
import PolymarketView from '../views/PolymarketView';
import StockAnalysisView from '../views/StockAnalysisView';

const VIEW_MAP: Record<NavTab, React.ReactNode> = {
  chat: <ChatView />,
  overview: <OverviewView />,
  sessions: <SessionsView />,
  debug: <DebugView />,
  logs: <LogsView />,
  channels: <ChannelsView />,
  usage: <UsageView />,
  cron: <CronView />,
  agents: <AgentsView />,
  skills: <SkillsView />,
  nodes: <NodesView />,
  models: <ModelsView />,
  polymarket: <PolymarketView />,
  stocks: <StockAnalysisView />,
  config: <ConfigView />,
};


const AppLayout: React.FC = () => {
  const { activeTab, sidebarCollapsed, toggleSidebar } = useUIStore();

  useEffect(() => {
    const handleResize = () => {
      const isSmall = window.innerWidth < 1024;
      const store = useUIStore.getState();
      if (isSmall && !store.sidebarCollapsed) {
        store.toggleSidebar();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex-shrink-0 transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${sidebarCollapsed ? '-translate-x-full' : 'translate-x-0'}`}
      >
        <NavSidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 flex-shrink-0 items-center border-b border-gray-200 bg-white px-4 lg:hidden">
          <button
            className="rounded p-1 text-gray-600 hover:bg-gray-100"
            onClick={toggleSidebar}
            aria-label="切换侧边栏"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <img src="/app.png" alt="OpenPilot" className="ml-2 h-5 w-5 rounded" />
          <span className="ml-1 text-sm font-medium text-gray-700">OpenPilot</span>
        </header>
        <main className="flex-1 overflow-hidden">
          {VIEW_MAP[activeTab]}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
