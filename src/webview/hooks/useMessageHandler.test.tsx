// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
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
