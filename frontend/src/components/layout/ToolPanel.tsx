import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';

const TOOL_TABS = [
  { id: 'system-monitor', labelKey: 'toolPanel.systemMonitor' },
  { id: 'file-browser', labelKey: 'toolPanel.fileBrowser' },
  { id: 'browser-control', labelKey: 'toolPanel.browserControl' },
  { id: 'web-automation', labelKey: 'toolPanel.webAutomation' },
  { id: 'operation-recorder', labelKey: 'toolPanel.operationRecorder' },
  { id: 'process-manager', labelKey: 'toolPanel.processManager' },
  { id: 'script-executor', labelKey: 'toolPanel.scriptExecutor' },
  { id: 'audit-log', labelKey: 'toolPanel.auditLog' },
  { id: 'network-client', labelKey: 'toolPanel.networkClient' },
  { id: 'email-client', labelKey: 'toolPanel.emailClient' },
  { id: 'task-scheduler', labelKey: 'toolPanel.taskScheduler' },
  { id: 'crypto-manager', labelKey: 'toolPanel.cryptoManager' },
  { id: 'code-toolkit', labelKey: 'toolPanel.codeToolkit' },
  { id: 'media-processor', labelKey: 'toolPanel.mediaProcessor' },
  { id: 'db-manager', labelKey: 'toolPanel.dbManager' },
  { id: 'cloud-service', labelKey: 'toolPanel.cloudService' },
  { id: 'system-config', labelKey: 'toolPanel.systemConfig' },
] as const;

function ToolPlaceholder({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-gray-400">
      <p>{label}（{id}）</p>
    </div>
  );
}

const ToolPanel: React.FC = () => {
  const { t } = useTranslation();
  const { activeToolTab, setActiveToolTab } = useUIStore();

  const activeTab = TOOL_TABS.find((tab) => tab.id === activeToolTab) ?? TOOL_TABS[0];

  return (
    <div className="flex h-full flex-col">
      <nav
        className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-gray-200 px-2 py-1"
        role="tablist"
        aria-label={t('toolPanel.label')}
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
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        <ToolPlaceholder id={activeTab.id} label={t(activeTab.labelKey)} />
      </div>
    </div>
  );
};

export default ToolPanel;
