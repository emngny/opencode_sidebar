import { useState, useRef, useCallback } from 'react';
import { ChatMessage } from '../../extension/types';

interface ContextEvent {
  id: string;
  name: string;
  status: string;
  content: string;
  meta?: any;
}

export function useChatState() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [contextEvents, setContextEvents] = useState<ContextEvent[]>([]);

  const pendingChunkRef = useRef<string>('');
  const chunkFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const DEBOUNCE_MS = 80;

  const flushPendingChunk = useCallback(() => {
    if (!pendingChunkRef.current) return;
    const chunkContent = pendingChunkRef.current;
    pendingChunkRef.current = '';

    if (chunkFlushTimerRef.current) {
      clearTimeout(chunkFlushTimerRef.current);
      chunkFlushTimerRef.current = null;
    }

    setMessages((prev) => {
      let lastAssistantIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'assistant') {
          lastAssistantIdx = i;
          break;
        }
      }
      const updated = [...prev];
      if (lastAssistantIdx < 0) {
        const newId = Math.random().toString(36).slice(2);
        streamingMsgIdRef.current = newId;
        updated.push({
          role: 'assistant',
          content: chunkContent,
          timestamp: Date.now(),
          id: newId,
          isStreaming: true,
        });
      } else {
        updated[lastAssistantIdx] = {
          ...updated[lastAssistantIdx],
          content: updated[lastAssistantIdx].content + chunkContent,
          isStreaming: true,
        };
      }
      return updated;
    });
  }, []);

  const cleanupStreaming = useCallback(() => {
    if (chunkFlushTimerRef.current) {
      clearTimeout(chunkFlushTimerRef.current);
      chunkFlushTimerRef.current = null;
    }
  }, []);

  return {
    messages, setMessages, busy, setBusy, contextEvents, setContextEvents,
    pendingChunkRef, chunkFlushTimerRef, streamingMsgIdRef, DEBOUNCE_MS,
    flushPendingChunk, cleanupStreaming,
  };
}
