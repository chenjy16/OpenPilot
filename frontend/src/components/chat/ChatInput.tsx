import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chatStore';
import { wsClient } from '../../services/wsClient';

const ChatInput: React.FC = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const { isStreaming, sendMessage } = useChatStore();
  const [queue, setQueue] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Stop commands
    if (isStreaming && /^(\/stop|stop|esc|abort|wait|exit)$/i.test(trimmed)) {
      handleAbort();
      setInput('');
      return;
    }

    // Queue if busy
    if (isStreaming) {
      setQueue((q) => [...q, trimmed]);
      setInput('');
      return;
    }

    setInput('');
    await sendMessage(trimmed);

    // Flush queue after send completes (if not streaming)
    flushQueue();
  };

  const flushQueue = () => {
    setQueue((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      // Fire and forget — next message
      useChatStore.getState().sendMessage(next);
      return rest;
    });
  };

  const handleAbort = () => {
    wsClient.send({ type: 'abort' });
    useChatStore.getState().endStreaming();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const removeFromQueue = (index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-gray-200">
      {/* Message queue indicator */}
      {queue.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pt-2">
          {queue.map((msg, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700"
            >
              <span className="max-w-[120px] truncate">{msg}</span>
              <button
                onClick={() => removeFromQueue(i)}
                className="ml-0.5 text-blue-400 hover:text-blue-600"
                aria-label={t('chat.removeQueued')}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? t('chat.inputPlaceholderStreaming') : t('chat.inputPlaceholder')}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="rounded-lg bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          >
            {t('chat.stop')}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {queue.length > 0 ? t('chat.queue') : t('chat.send')}
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
