// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { onMessage } from '../vscode-api';
import { useMessageHandler } from './useMessageHandler';

vi.mock('../vscode-api', () => ({
  onMessage: vi.fn(),
}));

function createState() {
  const state = {
    setMessages: vi.fn(),
    setBusy: vi.fn(),
    setContextEvents: vi.fn(),
    pendingChunkRef: { current: new Map<string, string>() },
    chunkFlushTimerRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
    streamingMsgIdRef: { current: new Map<string, string>() },
    streamingStepRef: { current: new Map<string, string>() },
    DEBOUNCE_MS: 20,
    flushPendingChunk: vi.fn(),
    cleanupStreaming: vi.fn(),
    setModel: vi.fn(),
    setMode: vi.fn(),
    setGitInfo: vi.fn(),
    setAvailableModels: vi.fn(),
    setAgentModels: vi.fn(),
    setHiddenModels: vi.fn(),
    setProvidersLoaded: vi.fn(),
    setSkills: vi.fn(),
    setFileSearchResults: vi.fn(),
    setFileSearchQuery: vi.fn(),
    fileSearchRequestIdRef: { current: 'file-search-2' },
    setRevertActive: vi.fn(),
    setConfirmDialog: vi.fn(),
    setReadPermissionPrompt: vi.fn(),
    setAgents: vi.fn(),
    onAgentsLoaded: vi.fn(),
    processProviderList: vi.fn(),
    tryAutoSelectModel: vi.fn(),
  } as any;

  // Mirrors the real flushPendingChunk in useChatState so tests can assert
  // buffered text only after an explicit flush, exactly like the debounce.
  state.flushPendingChunk = vi.fn((requestId?: string) => {
    const keys = requestId ? [requestId] : [...state.pendingChunkRef.current.keys()];
    for (const key of keys) {
      const text = state.pendingChunkRef.current.get(key);
      if (!text) continue;
      state.pendingChunkRef.current.delete(key);
      const timer = state.chunkFlushTimerRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        state.chunkFlushTimerRef.current.delete(key);
      }
      state.setMessages((prev: any[]) => {
        const streamingId = state.streamingMsgIdRef.current.get(key);
        const index = streamingId
          ? prev.findIndex((m: any) => m.id === streamingId)
          : prev.findIndex((m: any) => m.role === 'assistant' && m.requestId === key);
        if (index < 0) return prev;
        const updated = [...prev];
        updated[index] = { ...updated[index], content: updated[index].content + text, isStreaming: true };
        return updated;
      });
    }
  });

  return state;
}

describe('useMessageHandler file search ordering', () => {
  it('ignores stale file-search responses and applies the current response', () => {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    renderHook(() => useMessageHandler(state));

    handler({
      type: 'fileSearchResults',
      payload: { requestId: 'file-search-1', query: 'old', files: [{ name: 'old.ts', path: 'old.ts' }] },
    });
    expect(state.setFileSearchResults).not.toHaveBeenCalled();

    handler({
      type: 'fileSearchResults',
      payload: { requestId: 'file-search-2', query: 'new', files: [{ name: 'new.ts', path: 'new.ts' }] },
    });
    expect(state.setFileSearchResults).toHaveBeenCalledWith([{ name: 'new.ts', path: 'new.ts' }]);
    expect(state.setFileSearchQuery).toHaveBeenCalledWith('new');
  });
});

describe('useMessageHandler transcript rehydration', () => {
  /**
   * VS Code rebuilds the webview document when the view is shown again, so the
   * app remounts with an empty transcript while the server keeps streaming.
   */
  function setup() {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    // A real `setMessages` is what proves the delta lands in the existing
    // assistant bubble rather than opening a second one.
    let messages: any[] = [];
    state.setMessages = vi.fn((next: any) => {
      messages = typeof next === 'function' ? next(messages) : next;
    });
    renderHook(() => useMessageHandler(state));
    return {
      state,
      send: (message: unknown) => handler(message),
      get messages() {
        return messages;
      },
    };
  }

  it('replaces the transcript and marks the session busy', () => {
    const harness = setup();

    harness.send({
      type: 'sessionLoaded',
      payload: {
        sessionId: 'session-1',
        messages: [{ role: 'user', content: 'hi' }],
        busy: true,
        activeRequestId: 'req-9',
      },
    });

    expect(harness.state.setMessages).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }]);
    // Without this a turn still running on the server renders as finished.
    expect(harness.state.setBusy).toHaveBeenCalledWith(true);
  });

  it('reports an idle session when no turn is in flight', () => {
    const harness = setup();

    harness.send({ type: 'sessionLoaded', payload: { sessionId: 'session-1', messages: [] } });

    expect(harness.state.setBusy).toHaveBeenCalledWith(false);
  });

  it('streams deltas into the rehydrated assistant message instead of a new one', () => {
    const harness = setup();
    harness.send({
      type: 'sessionLoaded',
      payload: {
        sessionId: 'session-1',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'par', requestId: 'req-9', isStreaming: true },
        ],
        busy: true,
        activeRequestId: 'req-9',
      },
    });

    harness.send({
      type: 'receiveChunk',
      payload: { content: 'tial', requestId: 'req-9', sessionId: 'session-1' },
    });
    harness.state.flushPendingChunk('req-9');

    // The turn is already on screen; a second bubble would duplicate it.
    expect(harness.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(harness.messages[1].content).toBe('partial');
  });

  it('empties the transcript when the payload carries no messages', () => {
    const harness = setup();

    harness.send({ type: 'sessionLoaded', payload: { sessionId: 'session-1', messages: 'not-an-array' } });

    expect(harness.state.setMessages).toHaveBeenCalledWith([]);
  });
});

describe('useMessageHandler agent step ordering', () => {
  /**
   * A turn is several server messages: the agent speaks, runs a tool, then
   * speaks again. Each step needs its own bubble, in the order the steps
   * arrived, or the post-tool narration renders inside the bubble that was
   * opened before the tool ran.
   */
  function setup() {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    let messages: any[] = [];
    state.setMessages = vi.fn((next: any) => {
      messages = typeof next === 'function' ? next(messages) : next;
    });
    renderHook(() => useMessageHandler(state));
    return {
      state,
      send: (message: unknown) => handler(message),
      get messages() {
        return messages;
      },
    };
  }

  it('puts the text after a tool in its own bubble, below the tool card', () => {
    const harness = setup();

    harness.send({ type: 'receiveMessage', payload: { role: 'user', content: 'go', requestId: 'req-1' } });
    harness.send({
      type: 'receiveChunk',
      payload: { content: 'Looking now.', messageId: 'msg-1', requestId: 'req-1' },
    });
    harness.send({
      type: 'toolEvent',
      payload: {
        id: 'tool-1',
        type: 'tool_call',
        name: 'bash',
        status: 'running',
        content: 'bash calling...',
        requestId: 'req-1',
      },
    });
    harness.send({
      type: 'receiveChunk',
      payload: { content: 'Found the bug.', messageId: 'msg-2', requestId: 'req-1' },
    });
    harness.state.flushPendingChunk('req-1');

    expect(harness.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'event', 'assistant']);
    expect(harness.messages[1].content).toBe('Looking now.');
    // The whole point: not merged into the pre-tool bubble, and not above it.
    expect(harness.messages[3].content).toBe('Found the bug.');
    expect(harness.messages[3].serverMessageId).toBe('msg-2');
  });

  it('keeps appending into the same bubble while one step streams', () => {
    const harness = setup();

    harness.send({
      type: 'receiveChunk',
      payload: { content: 'par', messageId: 'msg-1', requestId: 'req-1' },
    });
    harness.send({
      type: 'receiveChunk',
      payload: { content: 'tial', messageId: 'msg-1', requestId: 'req-1' },
    });
    harness.state.flushPendingChunk('req-1');

    expect(harness.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(harness.messages[0].content).toBe('partial');
  });

  it('buffers deltas behind the debounce instead of rendering every token', () => {
    const harness = setup();

    harness.send({ type: 'receiveChunk', payload: { content: 'a', messageId: 'msg-1', requestId: 'req-1' } });
    harness.send({ type: 'receiveChunk', payload: { content: 'b', messageId: 'msg-1', requestId: 'req-1' } });
    harness.send({ type: 'receiveChunk', payload: { content: 'c', messageId: 'msg-1', requestId: 'req-1' } });

    // One state update opens the bubble; the deltas wait in the buffer. A
    // render per token re-parses the whole markdown on every keypress.
    expect(harness.state.setMessages).toHaveBeenCalledTimes(1);
    expect(harness.messages[0].content).toBe('');

    harness.state.flushPendingChunk('req-1');
    expect(harness.messages[0].content).toBe('abc');
  });

  it('closes every bubble of the turn when it ends', () => {
    const harness = setup();

    harness.send({
      type: 'receiveChunk',
      payload: { content: 'a', messageId: 'msg-1', requestId: 'req-1' },
    });
    harness.send({
      type: 'receiveChunk',
      payload: { content: 'b', messageId: 'msg-2', requestId: 'req-1' },
    });
    expect(harness.messages.every((m) => m.isStreaming)).toBe(true);

    harness.send({ type: 'streamEnd', payload: { content: 'b', requestId: 'req-1' } });

    // streamEnd must flush the buffered tail before it closes the bubbles,
    // or the turn loses its last 80ms of text.
    expect(harness.messages[1].content).toBe('b');
    expect(harness.messages.every((m) => m.isStreaming === false)).toBe(true);
    expect(harness.state.setBusy).toHaveBeenCalledWith(false);
  });

  it('attaches reasoning to the step it belongs to', () => {
    const harness = setup();

    harness.send({
      type: 'reasoningContent',
      payload: { content: 'thinking about it', messageId: 'msg-1', requestId: 'req-1' },
    });
    harness.send({
      type: 'reasoningContent',
      payload: { content: ' and again', messageId: 'msg-2', requestId: 'req-1' },
    });

    expect(harness.messages.map((m) => m.reasoning)).toEqual(['thinking about it', ' and again']);
  });
});

describe('useMessageHandler model auto-selection', () => {
  const providerList = {
    all: [{ id: 'p', name: 'P', models: { m1: { id: 'm1', name: 'Model One' } } }],
    connected: ['p'],
    default: {},
  };

  function setup() {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    renderHook(() => useMessageHandler(state));
    return { handler, state };
  }

  function lastMessages(state: ReturnType<typeof createState>) {
    const updater = state.setMessages.mock.calls.at(-1)?.[0] as (
      prev: unknown[],
    ) => Array<{ role: string; content: string }>;
    return updater([]);
  }

  it('reports a model replaced by the refreshed catalog', () => {
    const { handler, state } = setup();
    state.tryAutoSelectModel.mockReturnValue({ from: 'p/old', to: 'p/m1' });

    act(() => handler({ type: 'providerList', payload: providerList }));

    const messages = lastMessages(state);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe('Model "p/old" is no longer available. Switched to "Model One".');
  });

  it('stays silent when the current model is still offered', () => {
    const { handler, state } = setup();
    state.tryAutoSelectModel.mockReturnValue(null);

    act(() => handler({ type: 'providerList', payload: providerList }));

    expect(state.setMessages).not.toHaveBeenCalled();
  });

  it('stays silent on the very first selection', () => {
    const { handler, state } = setup();
    state.tryAutoSelectModel.mockReturnValue({ from: '', to: 'p/m1' });

    act(() => handler({ type: 'providerList', payload: providerList }));

    expect(state.setMessages).not.toHaveBeenCalled();
  });
});

describe('useMessageHandler agent catalog', () => {
  it('stores the agent list together with the models they pin', () => {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    renderHook(() => useMessageHandler(state));

    act(() =>
      handler({
        type: 'agentList',
        payload: {
          agents: ['Prometheus - Plan Builder'],
          agentModels: { 'Prometheus - Plan Builder': 'omniroute/pro-models' },
        },
      }),
    );

    expect(state.setAgents).toHaveBeenCalledWith(['Prometheus - Plan Builder']);
    expect(state.setAgentModels).toHaveBeenCalledWith({ 'Prometheus - Plan Builder': 'omniroute/pro-models' });
    // The reconciler must not act on the placeholder list before this arrives.
    expect(state.onAgentsLoaded).toHaveBeenCalled();
  });

  /**
   * "No session-owning agents" is an answer, not a missing one. Leaving the
   * previous list in place would let the reconciler keep validating against it.
   */
  it('treats an empty agent list as authoritative', () => {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    renderHook(() => useMessageHandler(state));

    act(() => handler({ type: 'agentList', payload: { agents: [] } }));

    expect(state.onAgentsLoaded).toHaveBeenCalled();
    expect(state.setAgents).toHaveBeenCalledWith([]);
  });
});

describe('useMessageHandler model override reporting', () => {
  it('records the requested model next to the model the server used', () => {
    let handler!: (message: any) => void;
    vi.mocked(onMessage).mockImplementation((next) => {
      handler = next;
      return vi.fn();
    });
    const state = createState();
    renderHook(() => useMessageHandler(state));

    act(() =>
      handler({
        type: 'messageMeta',
        payload: { agent: 'plan', modelId: 'omniroute/pro-models', requestedModel: 'opencode/mimo' },
      }),
    );

    const updater = state.setMessages.mock.calls.at(-1)?.[0] as (prev: unknown[]) => Array<Record<string, unknown>>;
    const next = updater([{ role: 'assistant', content: '', timestamp: 0, id: 'a1' }]);

    expect(next[0]).toMatchObject({
      agent: 'plan',
      modelId: 'omniroute/pro-models',
      requestedModelId: 'opencode/mimo',
    });
  });
});
