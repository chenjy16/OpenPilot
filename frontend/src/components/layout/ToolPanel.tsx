import { useUIStore } from '../../stores/uiStore';

const TOOL_TABS = [
  { id: 'system-monitor', label: '系统监控' },
  { id: 'file-browser', label: '文件浏览器' },
  { id: 'browser-control', label: '浏览器控制' },
  { id: 'web-automation', label: '网页自动化' },
  { id: 'operation-recorder', label: '操作录制' },
  { id: 'process-manager', label: '进程管理' },
  { id: 'script-executor', label: '脚本执行' },
  { id: 'audit-log', label: '审计日志' },
  { id: 'network-client', label: '网络操作' },
  { id: 'email-client', label: '邮件操作' },
  { id: 'task-scheduler', label: '定时任务' },
  { id: 'crypto-manager', label: '加密解密' },
  { id: 'code-toolkit', label: '开发工具' },
  { id: 'media-processor', label: '多媒体处理' },
  { id: 'db-manager', label: '数据库操作' },
  { id: 'cloud-service', label: '云服务' },
  { id: 'system-config', label: '系统配置' },
] as const;

function ToolPlaceholder({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-gray-400">
      <p>{label}（{id}）</p>
    </div>
  );
}

const ToolPanel: React.FC = () => {
  const { activeToolTab, setActiveToolTab } = useUIStore();

  const activeTab = TOOL_TABS.find((t) => t.id === activeToolTab) ?? TOOL_TABS[0];

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable tab bar */}
      <nav
        className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-gray-200 px-2 py-1"
        role="tablist"
        aria-label="工具面板标签页"
      >
        {TOOL_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeToolTab}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              tab.id === activeToolTab
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
            onClick={() => setActiveToolTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Active tool content */}
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        <ToolPlaceholder id={activeTab.id} label={activeTab.label} />
      </div>
    </div>
  );
};

export default ToolPanel;
