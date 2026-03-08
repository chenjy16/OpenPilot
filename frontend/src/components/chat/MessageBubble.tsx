import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../../types';

interface MessageBubbleProps {
  message: Message;
}

const MAX_COLLAPSED_HEIGHT = 400; // px

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
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (contentRef.current && !isUser) {
      setIsOverflow(contentRef.current.scrollHeight > MAX_COLLAPSED_HEIGHT);
    }
  }, [message.content, isUser]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        <div
          ref={contentRef}
          className={`overflow-hidden transition-all ${
            !expanded && isOverflow ? '' : ''
          }`}
          style={
            !expanded && isOverflow
              ? { maxHeight: MAX_COLLAPSED_HEIGHT, maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)' }
              : undefined
          }
        >
          <ReactMarkdown
            components={{
              code: CodeBlock as React.ComponentType<React.ComponentPropsWithoutRef<'code'>>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {isOverflow && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className={`mt-1 text-xs font-medium ${
              isUser ? 'text-blue-200 hover:text-white' : 'text-blue-500 hover:text-blue-700'
            }`}
          >
            {expanded ? '收起 ▲' : '展开全部 ▼'}
          </button>
        )}
        {message.isStreaming && (
          <span className="animate-pulse" data-testid="streaming-cursor">▊</span>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
