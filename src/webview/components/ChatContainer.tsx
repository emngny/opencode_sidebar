import React from 'react';
import { ChatMessage } from '../../extension/types';

interface Props {
  messages: ChatMessage[];
}

export function ChatContainer({ messages }: Readonly<Props>) {
  if (messages.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes thinking {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {messages.map((msg) => (
        <div key={msg.id || msg.timestamp}>
          {msg.role === 'event' ? (
            <EventCard message={msg} />
          ) : msg.role === 'tool' ? (
            <ToolMessage content={msg.content} />
          ) : (
            <ChatBubble message={msg} />
          )}
        </div>
      ))}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? '#7c3aed' : '#313244',
        color: '#cdd6f4',
        padding: '10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        maxWidth: '85%',
        wordBreak: 'break-word',
        fontSize: 13,
        lineHeight: 1.5,
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: message.role === 'assistant' && message.isStreaming && !message.content ? 24 : undefined,
      }}
    >
      {message.role === 'assistant' && message.isStreaming && message.content.length < 20 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#89b4fa', fontSize: 12 }}>
          <ThinkingDots />
          <span>Thinking...</span>
        </div>
      )}
      {message.content && (
        <span style={{ whiteSpace: 'pre-wrap' }}>{collapseWhitespace(message.content)}</span>
      )}
      {message.isStreaming && message.content && (
        <span style={{ display: 'inline-block', animation: 'blink 1s step-end infinite', fontSize: 16, lineHeight: 1 }}>
          ▌
        </span>
      )}
    </div>
  );
}

function EventCard({ message }: { message: ChatMessage }) {
  const eventType = message.eventType;
  const status = message.eventStatus;
  const meta = message.eventMeta;

  let icon = '🔧';
  let titleColor = '#cdd6f4';
  let borderColor = '#45475a';
  let bgColor = '#181825';

  if (eventType === 'thinking') {
    icon = '💭';
    borderColor = '#585b70';
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          backgroundColor: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: 10,
          fontSize: 12,
          color: '#a6adc8',
        }}
      >
        <ThinkingDots small />
        <span>Thinking...</span>
      </div>
    );
  }

  if (status === 'running') {
    icon = '⏳';
    borderColor = '#585b70';
    titleColor = '#89b4fa';
  } else if (status === 'completed') {
    icon = '✅';
    borderColor = 'rgba(166,227,161,0.3)';
    bgColor = 'rgba(166,227,161,0.05)';
    titleColor = '#a6e3a1';
  } else if (status === 'failed') {
    icon = '❌';
    borderColor = 'rgba(243,139,168,0.3)';
    bgColor = 'rgba(243,139,168,0.05)';
    titleColor = '#f38ba8';
  }

  // Build event title
  let title = message.content;
  let detail: React.ReactNode = null;

  if (eventType === 'tool_call' && meta?.args) {
    const argStr = typeof meta.args === 'string'
      ? meta.args
      : JSON.stringify(meta.args, null, 2);
    detail = (
      <pre style={{ margin: 0, fontSize: 10, color: '#6c7086', overflow: 'auto', maxHeight: 80 }}>
        {argStr}
      </pre>
    );
  }

  if (eventType === 'tool_result' && meta?.result) {
    const resultStr = typeof meta.result === 'string'
      ? meta.result
      : JSON.stringify(meta.result, null, 2);
    detail = (
      <pre style={{ margin: 0, fontSize: 10, color: '#6c7086', overflow: 'auto', maxHeight: 120 }}>
        {resultStr}
      </pre>
    );
  }

  if ((eventType === 'file_edit' || eventType === 'tool_result') && meta?.path) {
    const added = meta.added ?? 0;
    const deleted = meta.deleted ?? 0;
    if (added > 0 || deleted > 0) {
      detail = (
        <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
          {added > 0 && <span style={{ color: '#a6e3a1' }}>+{added}</span>}
          {deleted > 0 && <span style={{ color: '#f38ba8' }}>-{deleted}</span>}
        </div>
      );
    }
    title = `${meta.path}`;
  }

  return (
    <div
      style={{
        padding: '10px 14px',
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: '90%',
        alignSelf: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, color: titleColor, fontWeight: 500 }}>
          {title}
        </span>
        {status === 'running' && <ThinkingDots small />}
      </div>
      {detail && (
        <div style={{ paddingLeft: 22 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function ThinkingDots({ small }: { small?: boolean }) {
  const size = small ? 4 : 6;
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite' }} />
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.2s' }} />
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.4s' }} />
    </div>
  );
}

function ToolMessage({ content }: { content: string }) {
  const isRunning = content.includes('running') || content.includes('çalıştırılıyor');
  const isCompleted = content.includes('completed') || content.includes('result');
  const isFailed = content.includes('failed') || content.includes('error') || content.includes('başarısız');

  let icon = '🔧';
  let bgColor = '#1e1e2e';
  if (isRunning) { icon = '⏳'; bgColor = '#181825'; }
  if (isCompleted) { icon = '✅'; bgColor = 'rgba(166,227,161,0.08)'; }
  if (isFailed) { icon = '❌'; bgColor = 'rgba(243,139,168,0.08)'; }

  return (
    <div
      style={{
        fontSize: 12,
        color: '#a6adc8',
        padding: '6px 12px',
        textAlign: 'center',
        backgroundColor: bgColor,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      <span>{icon}</span>
      <span>{content}</span>
    </div>
  );
}

function collapseWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
