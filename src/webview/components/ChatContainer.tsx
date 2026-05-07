import React from 'react';
import { ChatMessage } from '../../extension/types';
import { ChatBubble } from './ChatBubble';
import { EventCard } from './EventCard';
import { ContextGroup } from './ContextGroup';
import { CompactionDivider } from './CompactionDivider';
import { ToolMessage } from './ToolMessage';

interface Props {
  messages: ChatMessage[];
  onRevert?: (messageId: string) => void;
  revertActive?: boolean;
  onUnrevert?: () => void;
  contextEvents?: Array<{ id: string; name: string; status: string; content: string; meta?: any }>;
  onLoadSession?: (sessionId: string) => void;
  onRespondPermission?: (permId: string, sessionId: string, response: 'allow' | 'deny', remember?: boolean) => void;
  onOpenDiff?: (filePath: string) => void;
}

export function ChatContainer({ messages, onRevert, revertActive, onUnrevert, contextEvents, onLoadSession, onRespondPermission, onOpenDiff }: Readonly<Props>) {
  if (messages.length === 0 && (!contextEvents || contextEvents.length === 0)) return null;

  const hasContext = contextEvents && contextEvents.length > 0;
  const allDone = contextEvents?.every((e) => e.status === 'completed' || e.status === 'failed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {hasContext && <ContextGroup events={contextEvents!} allDone={!!allDone} />}
      {messages.map((msg) => (
        <div key={msg.id || msg.timestamp}>
          {msg.eventType === 'compacting' ? (
            <CompactionDivider status={msg.eventStatus} />
          ) : msg.role === 'event' ? (
            <EventCard message={msg} onLoadSession={onLoadSession} onRespondPermission={onRespondPermission} onOpenDiff={onOpenDiff} />
          ) : msg.role === 'tool' ? (
            <ToolMessage content={msg.content} />
          ) : (
            <ChatBubble message={msg} onRevert={onRevert} />
          )}
        </div>
      ))}
      {revertActive && onUnrevert && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px 12px',
            backgroundColor: 'rgba(137,180,250,0.08)',
            border: '1px solid rgba(137,180,250,0.3)',
            borderRadius: 10,
            fontSize: 12,
            color: '#89b4fa',
          }}
        >
          <span>⏪ Messages reverted</span>
          <button
            onClick={onUnrevert}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(137,180,250,0.3)',
              background: 'rgba(137,180,250,0.1)',
              color: '#89b4fa',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Restore
          </button>
        </div>
      )}
    </div>
  );
}