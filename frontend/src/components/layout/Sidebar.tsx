import React from 'react';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  className?: string;
  sessionList?: React.ReactNode;
  modelSelector?: React.ReactNode;
}

const Sidebar: React.FC<SidebarProps> = ({
  className = '',
  sessionList,
  modelSelector,
}) => {
  const { t } = useTranslation();
  return (
    <div className={`flex h-full flex-col ${className}`}>
      <div className="flex-shrink-0 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-800">AI Assistant</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        {sessionList ?? (
          <p className="text-sm text-gray-500">{t('session.noSessions')}</p>
        )}
      </div>
      <div className="flex-shrink-0 border-t border-gray-200 px-4 py-3">
        {modelSelector ?? (
          <p className="text-sm text-gray-500">{t('model.label')}</p>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
