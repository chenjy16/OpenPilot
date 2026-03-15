import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChatArea from '../chat/ChatArea';
import SessionList from '../session/SessionList';
import ModelSelector from '../model/ModelSelector';

const ChatView: React.FC = () => {
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <div className="flex h-full">
      {/* Session sidebar (within chat view) */}
      {panelOpen && (
        <div className="flex w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-medium text-gray-700">{t('nav.sessions')}</span>
            <button
              onClick={() => setPanelOpen(false)}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label={t('chat.collapse')}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <SessionList />
          </div>
          <div className="border-t border-gray-200 p-3">
            <ModelSelector />
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!panelOpen && (
          <button
            onClick={() => setPanelOpen(true)}
            className="absolute left-14 top-16 z-10 rounded-r bg-white px-1 py-2 shadow-md hover:bg-gray-50"
            aria-label={t('chat.expandAll')}
          >
            <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7" />
            </svg>
          </button>
        )}
        <ChatArea />
      </div>
    </div>
  );
};

export default ChatView;
