import React from 'react';
import type { ToolCall, ToolResult } from '../../types';

interface ToolCallMessageProps {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
}

const ToolCallMessage: React.FC<ToolCallMessageProps> = ({ toolCalls, toolResults }) => {
  const getResult = (toolCallId: string): ToolResult | undefined =>
    toolResults?.find((r) => r.id === toolCallId);

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[70%] space-y-2">
        {toolCalls.map((tc) => {
          const result = getResult(tc.id);
          return (
            <div
              key={tc.id}
              className="border border-gray-300 rounded-lg p-3 bg-white shadow-sm"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base" role="img" aria-label="tool">🔧</span>
                <span className="font-semibold text-sm text-gray-700">{tc.name}</span>
              </div>

              <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 mb-2 overflow-auto">
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
              </div>

              {result && (
                <div className="border-t border-gray-200 pt-2 mt-2">
                  {result.error ? (
                    <div className="text-xs text-red-600 bg-red-50 rounded p-2">
                      <span className="font-semibold">Error: </span>
                      {result.error}
                    </div>
                  ) : (
                    <div className="text-xs text-green-700 bg-green-50 rounded p-2 overflow-auto">
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
          );
        })}
      </div>
    </div>
  );
};

export default ToolCallMessage;
