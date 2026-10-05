import { useState, useRef, useCallback } from 'react';
import { ChatMessage } from '../../shared/types';

export function genId(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

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

  const pendingChunkRef = useRef<Map<string, string>>(new Map());
  const chunkFlushTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const streamingMsgIdRef = useRef<Map<string, string>>(new Map());
  // requestId → server messageId of the step currently streaming. Lets the
  // handler detect a step boundary and flush the previous step's buffer into
  // the previous bubble before any text lands in the new one.
  const streamingStepRef = useRef<Map<string, string>>(new Map());
  const DEBOUNCE_MS = 80;

  const flushPendingChunk = useCallback((requestId?: string) => {
    const requestIds = requestId ? [requestId] : [...pendingChunkRef.current.keys()];
    for (const id of requestIds) {
      const chunkContent = pendingChunkRef.current.get(id);
      if (!chunkContent) continue;
      pendingChunkRef.current.delete(id);
      const timer = chunkFlushTimerRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        chunkFlushTimerRef.current.delete(id);
      }

      setMessages((prev) => {
        // Follow the bubble the current step opened. Falling back to "first
        // assistant message of the request" would land debounced text from a
        // later step in the bubble that predates it.
        const streamingId = streamingMsgIdRef.current.get(id);
        const messageIndex = streamingId
          ? prev.findIndex((message) => message.id === streamingId)
          : prev.findIndex((message) => message.role === 'assistant' && message.requestId === id);
        if (messageIndex < 0) return prev;
        const updated = [...prev];
        const message = updated[messageIndex];
        updated[messageIndex] = { ...message, content: message.content + chunkContent, isStreaming: true };
        return updated;
      });
    }
  }, []);

  const cleanupStreaming = useCallback((requestId?: string) => {
    const requestIds = requestId ? [requestId] : [...chunkFlushTimerRef.current.keys()];
    for (const id of requestIds) {
      const timer = chunkFlushTimerRef.current.get(id);
      if (timer) clearTimeout(timer);
      chunkFlushTimerRef.current.delete(id);
      if (requestId) {
        pendingChunkRef.current.delete(id);
        streamingStepRef.current.delete(id);
      }
    }
    if (!requestId) {
      pendingChunkRef.current.clear();
      streamingMsgIdRef.current.clear();
      streamingStepRef.current.clear();
    }
  }, []);

  /**
   * Drops the whole conversation and every pending streaming buffer.
   *
   * `cleanupStreaming()` runs first on purpose: the 80ms debounce timers hold
   * text already received from the old session, and flushing them after
   * `setMessages([])` would repopulate the empty transcript.
   */
  const resetConversation = useCallback(() => {
    cleanupStreaming();
    setMessages([]);
    setContextEvents([]);
    setBusy(false);
  }, [cleanupStreaming]);

  return {
    messages,
    setMessages,
    busy,
    setBusy,
    contextEvents,
    setContextEvents,
    pendingChunkRef,
    chunkFlushTimerRef,
    streamingMsgIdRef,
    streamingStepRef,
    DEBOUNCE_MS,
    flushPendingChunk,
    cleanupStreaming,
    resetConversation,
  };
}
