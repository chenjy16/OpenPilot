import React from 'react';

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
  return (
    <div className={`flex h-full flex-col ${className}`}>
      {/* Header area with app title */}
      <div className="flex-shrink-0 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-800">AI 助手</h1>
      </div>

      {/* Scrollable session list area */}
      <div className="flex-1 overflow-y-auto px-4">
        {sessionList ?? (
          <p className="text-sm text-gray-500">会话列表将在此处展示</p>
        )}
      </div>

      {/* Bottom area for model selector */}
      <div className="flex-shrink-0 border-t border-gray-200 px-4 py-3">
        {modelSelector ?? (
          <p className="text-sm text-gray-500">模型选择器</p>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
