import React from 'react';
import { ChatMessage } from '../extension/types';

interface Props {
  messages: ChatMessage[];
}

export function ChatContainer({ messages }: Readonly<Props>) {
  if (messages.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {messages.map((msg) => (
        <div key={msg.id || msg.timestamp}>
          {msg.role === 'tool' ? (
            <div
              style={{
                fontSize: 12,
                color: '#a6adc8',
                fontStyle: 'italic',
                padding: '4px 8px',
                textAlign: 'center',
              }}
            >
              {msg.content}
            </div>
          ) : (
            <div
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                backgroundColor: msg.role === 'user' ? '#7c3aed' : '#313244',
                color: '#cdd6f4',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                maxWidth: '85%',
                wordBreak: 'break-word',
                fontSize: 13,
                lineHeight: 1.5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {msg.content}
              {msg.isStreaming && (
                <span style={{ display: 'inline-block', animation: 'blink 1s step-end infinite', fontSize: 16, lineHeight: 1 }}>
                  ▌
                </span>
              )}
            </div>
          )}
        </div>
      ))}
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
