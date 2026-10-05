// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatState } from './useChatState';

describe('useChatState.resetConversation', () => {
  it('clears transcript, context events and busy flag', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessages([{ role: 'user', content: 'hi' }] as never);
      result.current.setContextEvents([{ id: 'ctx-1', name: 'read', status: 'done', content: 'a.ts' }] as never);
      result.current.setBusy(true);
    });

    act(() => result.current.resetConversation());

    expect(result.current.messages).toEqual([]);
    expect(result.current.contextEvents).toEqual([]);
    expect(result.current.busy).toBe(false);
  });

  it('drops buffered streaming state so old deltas cannot repopulate the transcript', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessages([{ role: 'assistant', content: 'partial', requestId: 'req-1' }] as never);
      result.current.pendingChunkRef.current.set('req-1', 'buffered text');
      result.current.streamingMsgIdRef.current.set('req-1', 'msg-1');
      result.current.streamingStepRef.current.set('req-1', 'msg-1');
      result.current.chunkFlushTimerRef.current.set(
        'req-1',
        setTimeout(() => undefined, 10_000),
      );
    });

    act(() => result.current.resetConversation());

    // The 80ms debounce buffer is the leak path: flushing it after
    // setMessages([]) would write the old session's text into the new chat.
    expect(result.current.pendingChunkRef.current.size).toBe(0);
    expect(result.current.streamingMsgIdRef.current.size).toBe(0);
    expect(result.current.streamingStepRef.current.size).toBe(0);
    expect(result.current.chunkFlushTimerRef.current.size).toBe(0);
  });

  it('is idempotent when called on an already empty conversation', () => {
    const { result } = renderHook(() => useChatState());

    act(() => result.current.resetConversation());
    act(() => result.current.resetConversation());

    expect(result.current.messages).toEqual([]);
    expect(result.current.busy).toBe(false);
  });

  it('leaves a fresh conversation untouched', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessages([{ role: 'user', content: 'first' }] as never);
      result.current.setBusy(true);
    });
    act(() => result.current.resetConversation());
    act(() => {
      result.current.setMessages([{ role: 'user', content: 'second' }] as never);
    });

    expect(result.current.messages).toEqual([{ role: 'user', content: 'second' }]);
  });
});

describe('useChatState.cleanupStreaming', () => {
  it('clears every request when called without a requestId', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.pendingChunkRef.current.set('req-1', 'a');
      result.current.pendingChunkRef.current.set('req-2', 'b');
      result.current.streamingMsgIdRef.current.set('req-1', 'msg-1');
      result.current.streamingStepRef.current.set('req-1', 'msg-1');
      result.current.chunkFlushTimerRef.current.set(
        'req-1',
        setTimeout(() => undefined, 10_000),
      );
    });

    act(() => result.current.cleanupStreaming());

    expect(result.current.pendingChunkRef.current.size).toBe(0);
    expect(result.current.streamingMsgIdRef.current.size).toBe(0);
    expect(result.current.streamingStepRef.current.size).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('useChatState.flushPendingChunk', () => {
  it('appends the buffered tail to the bubble the streaming ref maps to', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessages([
        { role: 'assistant', content: 'Look', id: 'srv-1', requestId: 'req-1', isStreaming: true },
        { role: 'user', content: 'other turn', requestId: 'req-2' },
      ] as never);
      result.current.streamingMsgIdRef.current.set('req-1', 'srv-1');
      result.current.streamingStepRef.current.set('req-1', 'msg-1');
      result.current.pendingChunkRef.current.set('req-1', 'ing now.');
    });

    act(() => result.current.flushPendingChunk('req-1'));

    expect(result.current.messages[0].content).toBe('Looking now.');
    expect(result.current.messages[0].isStreaming).toBe(true);
    expect(result.current.messages[1].content).toBe('other turn');
    expect(result.current.pendingChunkRef.current.size).toBe(0);
    expect(result.current.chunkFlushTimerRef.current.size).toBe(0);
  });

  it('leaves the transcript alone when the buffer for the key is empty', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessages([
        { role: 'assistant', content: 'finished', id: 'srv-2', requestId: 'req-3', isStreaming: false },
      ] as never);
      result.current.streamingMsgIdRef.current.set('req-3', 'srv-2');
      result.current.pendingChunkRef.current.set('req-3', '');
    });

    act(() => result.current.flushPendingChunk('req-3'));

    expect(result.current.messages[0].content).toBe('finished');
    expect(result.current.messages[0].isStreaming).toBe(false);
  });
});
