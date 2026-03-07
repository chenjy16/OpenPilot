import React from 'react';
import type { SessionSummary } from '../../types';

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isActive,
  onSelect,
  onDelete,
}) => {
  const formattedTime = new Date(session.updatedAt).toLocaleString();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(session.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
        isActive
          ? 'bg-blue-100 text-blue-800'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(session.id);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{session.title || '新会话'}</p>
        <p className="truncate text-xs text-gray-500">{formattedTime}</p>
      </div>
      <button
        className="ml-2 flex-shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
        onClick={handleDelete}
        aria-label={`删除会话 ${session.title || '新会话'}`}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
};

export default SessionItem;
