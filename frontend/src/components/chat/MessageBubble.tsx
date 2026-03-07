import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../../types';

interface MessageBubbleProps {
  message: Message;
}

const CodeBlock: React.FC<React.ComponentPropsWithoutRef<'code'> & { inline?: boolean }> = ({
  className,
  children,
  inline,
  ...props
}) => {
  const match = /language-(\w+)/.exec(className || '');
  const code = String(children).replace(/\n$/, '');

  if (!inline && match) {
    return (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
      >
        {code}
      </SyntaxHighlighter>
    );
  }

  return (
    <code className={`${className ?? ''} bg-gray-200 text-sm rounded px-1`} {...props}>
      {children}
    </code>
  );
};

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[70%] rounded-lg p-3 ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        <ReactMarkdown
          components={{
            code: CodeBlock as React.ComponentType<React.ComponentPropsWithoutRef<'code'>>,
          }}
        >
          {message.content}
        </ReactMarkdown>
        {message.isStreaming && (
          <span className="animate-pulse" data-testid="streaming-cursor">▊</span>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
