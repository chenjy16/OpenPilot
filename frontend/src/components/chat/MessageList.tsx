import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import MessageBubble from './MessageBubble';
import ToolCallMessage from './ToolCallMessage';

const MessageList: React.FC = () => {
  const messages = useChatStore((state) => state.messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4" data-testid="message-list">
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
  );
};

export default MessageList;
