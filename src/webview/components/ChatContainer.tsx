import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage } from '../../shared/types';
import { ChatBubble } from './ChatBubble';
import { EventCard } from './EventCard';
import { ContextGroup } from './ContextGroup';
import { CompactionDivider } from './CompactionDivider';
import { ToolMessage } from './ToolMessage';
import { DEFAULT_VISIBLE_MESSAGE_COUNT, expandVisibleCount, getVisibleWindow } from './ChatContainer.windowing';

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

export function getMessageKey(message: ChatMessage, index: number): string {
  return message.id || `message-${index}`;
}

export function ChatContainer({
  messages,
  onRevert,
  revertActive,
  onUnrevert,
  contextEvents,
  onLoadSession,
  onRespondPermission,
  onOpenDiff,
}: Readonly<Props>) {
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_MESSAGE_COUNT);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const {
    messages: visibleMessages,
    hiddenCount,
    hasMore,
  } = useMemo(() => getVisibleWindow(messages, visibleCount), [messages, visibleCount]);

  useLayoutEffect(() => {
    const pendingScroll = pendingScrollRef.current;
    if (!pendingScroll) return;

    pendingScrollRef.current = null;
    const scrollParent = containerRef.current?.parentElement;
    if (scrollParent) {
      const heightDelta = scrollParent.scrollHeight - pendingScroll.scrollHeight;
      scrollParent.scrollTop = pendingScroll.scrollTop + heightDelta;
    }
  }, [visibleMessages]);

  const loadOlder = (loadAll = false) => {
    const scrollParent = containerRef.current?.parentElement;
    if (scrollParent) {
      pendingScrollRef.current = {
        scrollTop: scrollParent.scrollTop,
        scrollHeight: scrollParent.scrollHeight,
      };
    }
    setVisibleCount((current) => (loadAll ? messages.length : expandVisibleCount(current, messages.length)));
  };

  if (messages.length === 0 && (!contextEvents || contextEvents.length === 0)) return null;

  const hasContext = contextEvents && contextEvents.length > 0;
  const allDone = contextEvents?.every((e) => e.status === 'completed' || e.status === 'failed');

  return (
    <div ref={containerRef} style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ fontSize: 11, color: '#6c7086' }}>{hiddenCount} older messages hidden</span>
          <button
            onClick={() => loadOlder()}
            style={{
              border: '1px solid #45475a',
              borderRadius: 6,
              background: '#181825',
              color: '#cdd6f4',
              cursor: 'pointer',
              padding: '4px 10px',
            }}
          >
            Load older
          </button>
          <button
            onClick={() => loadOlder(true)}
            style={{ border: 0, background: 'transparent', color: '#89b4fa', cursor: 'pointer', fontSize: 11 }}
          >
            Load all
          </button>
        </div>
      )}
      {hasContext && <ContextGroup events={contextEvents!} allDone={!!allDone} />}
      {visibleMessages.map((msg, index) => {
        let content: React.ReactNode;
        if (msg.eventType === 'compacting') {
          content = <CompactionDivider status={msg.eventStatus} />;
        } else if (msg.role === 'event') {
          content = (
            <EventCard
              message={msg}
              onLoadSession={onLoadSession}
              onRespondPermission={onRespondPermission}
              onOpenDiff={onOpenDiff}
            />
          );
        } else if (msg.role === 'tool') {
          content = <ToolMessage content={msg.content} />;
        } else {
          content = <ChatBubble message={msg} onRevert={onRevert} />;
        }
        return (
          <div data-testid="chat-message" key={getMessageKey(msg, messages.length - visibleMessages.length + index)}>
            {content}
          </div>
        );
      })}
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
