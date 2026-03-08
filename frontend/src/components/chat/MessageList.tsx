import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import MessageBubble from './MessageBubble';
import ToolCallMessage from './ToolCallMessage';

const MessageList: React.FC = () => {
  const messages = useChatStore((state) => state.messages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Track scroll position to show/hide the "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
    // Re-enable auto-scroll when user scrolls near bottom
    setAutoScroll(distFromBottom < 60);
  }, []);

  // Auto-scroll on new messages (only if user hasn't scrolled up)
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
  };

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto p-4"
        data-testid="message-list"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-gray-400 text-sm">
            发送消息开始对话
          </div>
        )}
        {messages.map((message) => (
          <React.Fragment key={message.id}>
            <MessageBubble message={message} />
            {message.toolCalls && message.toolCalls.length > 0 && (
              <ToolCallMessage
                toolCalls={message.toolCalls}
                toolResults={message.toolResults}
              />
            )}
          </React.Fragment>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to top */}
      {showScrollBtn && (
        <button
          onClick={scrollToTop}
          className="absolute right-4 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-opacity"
          aria-label="滚动到顶部"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute right-4 bottom-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-opacity"
          aria-label="滚动到底部"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default MessageList;
