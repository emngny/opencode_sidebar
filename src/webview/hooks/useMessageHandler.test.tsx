// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { onMessage } from '../vscode-api';
import { useMessageHandler } from './useMessageHandler';

vi.mock('../vscode-api', () => ({
  onMessage: vi.fn(),
}));

function createState() {
  return {
    setMessages: vi.fn(),
    setBusy: vi.fn(),
    setContextEvents: vi.fn(),
    pendingChunkRef: { current: new Map<string, string>() },
    chunkFlushTimerRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
    streamingMsgIdRef: { current: new Map<string, string>() },
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
    processProviderList: vi.fn(),
    tryAutoSelectModel: vi.fn(),
  } as any;
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
