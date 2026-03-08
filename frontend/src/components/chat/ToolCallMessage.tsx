import React, { useState } from 'react';
import type { ToolCall, ToolResult } from '../../types';

interface ToolCallMessageProps {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
}

const ToolCallMessage: React.FC<ToolCallMessageProps> = ({ toolCalls, toolResults }) => {
  const getResult = (toolCallId: string): ToolResult | undefined =>
    toolResults?.find((r) => r.id === toolCallId);

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] space-y-1.5 w-full">
        {toolCalls.map((tc) => {
          const result = getResult(tc.id);
          return <ToolCallItem key={tc.id} toolCall={tc} result={result} />;
        })}
      </div>
    </div>
  );
};

const ToolCallItem: React.FC<{ toolCall: ToolCall; result?: ToolResult }> = ({ toolCall: tc, result }) => {
  const [expanded, setExpanded] = useState(false);
  const hasError = !!result?.error;

  return (
    <div
      className={`border rounded-lg bg-white shadow-sm text-sm ${
        hasError ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      {/* Header — always visible, clickable */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gray-50 rounded-lg transition-colors"
      >
        <span className="text-xs text-gray-400 select-none">{expanded ? '▼' : '▶'}</span>
        <span role="img" aria-label="tool">🔧</span>
        <span className="font-medium text-gray-700 truncate flex-1">{tc.name}</span>
        {hasError && (
          <span className="text-xs text-red-500 font-medium shrink-0">失败</span>
        )}
        {result && !hasError && (
          <span className="text-xs text-green-600 font-medium shrink-0">完成</span>
        )}
        {!result && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400 shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-2">
          {/* Arguments */}
          <div>
            <div className="text-xs text-gray-400 mb-1">参数</div>
            <div className="text-xs bg-gray-50 rounded p-2 max-h-40 overflow-auto">
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(tc.arguments, null, 2)}
              </pre>
            </div>
          </div>

          {/* Result */}
          {result && (
            <div>
              <div className="text-xs text-gray-400 mb-1">结果</div>
              {result.error ? (
                <div className="text-xs text-red-600 bg-red-50 rounded p-2 max-h-40 overflow-auto">
                  <pre className="whitespace-pre-wrap break-words">{result.error}</pre>
                </div>
              ) : (
                <div className="text-xs text-green-700 bg-green-50 rounded p-2 max-h-40 overflow-auto">
                  <pre className="whitespace-pre-wrap break-words">
                    {typeof result.result === 'string'
                      ? result.result
                      : JSON.stringify(result.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallMessage;
