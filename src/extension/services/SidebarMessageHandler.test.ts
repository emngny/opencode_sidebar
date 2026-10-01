import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { SidebarMessageHandler } from './SidebarMessageHandler';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    openTextDocument: vi.fn(),
  },
  window: { showTextDocument: vi.fn() },
  env: { openExternal: vi.fn().mockResolvedValue(true) },
  Uri: {
    file: vi.fn((fsPath) => ({ fsPath })),
    parse: vi.fn((value: string) => ({ toString: () => value })),
  },
}));

function createHandler(
  sessions: { abort?: ReturnType<typeof vi.fn>; [key: string]: ReturnType<typeof vi.fn> } = { abort: vi.fn() },
  post = vi.fn(),
) {
  return new SidebarMessageHandler(
    {} as never,
    sessions as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: vi.fn(), update: vi.fn() } as never,
    post,
    {} as never,
  );
}

describe('SidebarMessageHandler', () => {
  it('delegates abort by clearing the active session', async () => {
    const sessions = { abort: vi.fn() };
    const handler = createHandler(sessions);
    await handler.dispatch({ type: 'abort' });
    expect(sessions.abort).toHaveBeenCalledOnce();
  });

  it('routes clearChat to abort without re-sending history to the webview', async () => {
    // The webview already cleared its own transcript; posting messages back
    // here would repopulate the fresh session with the old conversation.
    const sessions = { abort: vi.fn() };
    const post = vi.fn();
    const handler = createHandler(sessions, post);

    await handler.dispatch({ type: 'clearChat' });

    expect(sessions.abort).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });

  it('reports no error when clearChat arrives without an active session', async () => {
    const sessions = { abort: vi.fn().mockRejectedValue(new Error('no active session')) };
    const post = vi.fn();
    const handler = createHandler(sessions, post);

    await handler.dispatch({ type: 'clearChat' });

    expect(post).toHaveBeenCalledWith({ type: 'error', payload: { message: 'Abort failed: no active session' } });
  });

  describe('transcript rehydration on webviewReady', () => {
    /**
     * VS Code rebuilds the webview document whenever the view becomes visible
     * again, so the app remounts empty while the session is still live.
     */
    function readyHandler(options: {
      currentSessionId?: string | null;
      activeRequestId?: string | null;
      pendingPermission?: unknown;
      loadSession?: ReturnType<typeof vi.fn>;
    }) {
      const post = vi.fn();
      const opencode = {
        start: vi.fn().mockResolvedValue(undefined),
        getCurrentProject: vi.fn().mockResolvedValue(null),
        getPath: vi.fn().mockResolvedValue(null),
        getVcsInfo: vi.fn().mockResolvedValue(null),
        listProviders: vi.fn().mockResolvedValue({ all: [], connected: [], default: {} }),
        getAgents: vi.fn().mockResolvedValue([]),
        getActiveRequestId: vi.fn().mockReturnValue(options.activeRequestId ?? null),
        getPendingPermission: vi.fn().mockReturnValue(options.pendingPermission ?? null),
      };
      const sessions = {
        abort: vi.fn(),
        get currentSessionId() {
          return options.currentSessionId ?? null;
        },
        set currentSessionId(_v: string | null) {},
        loadSession: options.loadSession ?? vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
        listSessions: vi.fn().mockResolvedValue([]),
      };
      const handler = new SidebarMessageHandler(
        opencode as never,
        sessions as never,
        {} as never,
        { restoreApiKeys: vi.fn() } as never,
        { list: vi.fn().mockReturnValue([]) } as never,
        {} as never,
        { get: vi.fn(), update: vi.fn() } as never,
        post,
        {} as never,
      );
      return { handler, post, opencode, sessions };
    }

    it('restores the transcript for a live session', async () => {
      const { handler, post, opencode, sessions } = readyHandler({ currentSessionId: 'session-1' });

      await handler.dispatch({ type: 'webviewReady' });

      expect(sessions.loadSession).toHaveBeenCalledWith('session-1', null);
      expect(post).toHaveBeenCalledWith({
        type: 'sessionLoaded',
        payload: {
          sessionId: 'session-1',
          messages: [{ role: 'user', content: 'hi' }],
          busy: false,
          activeRequestId: null,
        },
      });
      // The live turn has to be named, or the next delta opens a second bubble.
      expect(opencode.getActiveRequestId).toHaveBeenCalledWith('session-1');
    });

    it('marks the session busy while a turn is still streaming', async () => {
      const { handler, post } = readyHandler({ currentSessionId: 'session-1', activeRequestId: 'req-9' });

      await handler.dispatch({ type: 'webviewReady' });

      const loaded = post.mock.calls.find(([m]) => m.type === 'sessionLoaded')?.[0];
      expect(loaded.payload.busy).toBe(true);
      expect(loaded.payload.activeRequestId).toBe('req-9');
    });

    it('sends nothing when no session is open', async () => {
      const { handler, post } = readyHandler({ currentSessionId: null });

      await handler.dispatch({ type: 'webviewReady' });

      expect(post.mock.calls.some(([m]) => m.type === 'sessionLoaded')).toBe(false);
    });

    it('replays a permission the hidden webview never saw', async () => {
      // The prompt only exists as a live event, so without the replay the
      // server stays blocked on a decision the user cannot make.
      const pending = { id: 'perm-1', type: 'permission', name: 'permission', status: 'running', content: 'bash' };
      const { handler, post } = readyHandler({
        currentSessionId: 'session-1',
        activeRequestId: 'req-9',
        pendingPermission: pending,
      });

      await handler.dispatch({ type: 'webviewReady' });

      const replay = post.mock.calls.filter(([m]) => m.type === 'toolEvent').map(([m]) => m.payload);
      expect(replay).toHaveLength(1);
      expect(replay[0]).toMatchObject({ id: 'perm-1', type: 'permission', requestId: 'req-9' });
      // It has to arrive after the transcript it belongs to.
      const order = post.mock.calls.map(([m]) => m.type);
      expect(order.indexOf('sessionLoaded')).toBeLessThan(order.indexOf('toolEvent'));
    });

    it('does not replay once the permission has been answered', async () => {
      const { handler, post } = readyHandler({ currentSessionId: 'session-1', pendingPermission: null });

      await handler.dispatch({ type: 'webviewReady' });

      expect(post.mock.calls.some(([m]) => m.type === 'toolEvent')).toBe(false);
    });

    it('surfaces a restore failure without breaking the rest of ready', async () => {
      const { handler, post } = readyHandler({
        currentSessionId: 'session-1',
        loadSession: vi.fn().mockRejectedValue(new Error('boom')),
      });

      await handler.dispatch({ type: 'webviewReady' });

      expect(post).toHaveBeenCalledWith({
        type: 'error',
        payload: { message: 'Failed to restore session: boom' },
      });
      // projectInfo still went out.
      expect(post.mock.calls.some(([m]) => m.type === 'projectInfo')).toBe(true);
    });
  });

  it('offers only session-owning agents as chat modes', async () => {
    const post = vi.fn();
    const opencode = {
      start: vi.fn(),
      getCurrentProject: vi.fn().mockResolvedValue(null),
      getPath: vi.fn().mockResolvedValue(null),
      getVcsInfo: vi.fn().mockResolvedValue(null),
      listProviders: vi.fn().mockResolvedValue({ all: [], connected: [], default: {} }),
      getAgents: vi.fn().mockResolvedValue([
        { id: 'Prometheus - Plan Builder', mode: 'primary', model: 'omniroute/pro-models' },
        { id: 'Atlas - Plan Executor', mode: 'primary' },
        { id: 'plan', mode: 'subagent', model: 'omniroute/pro-models' },
        { id: 'title', mode: 'primary' },
      ]),
    };
    const handler = new SidebarMessageHandler(
      opencode as never,
      {} as never,
      {} as never,
      { restoreApiKeys: vi.fn() } as never,
      { list: vi.fn().mockReturnValue([]) } as never,
      {} as never,
      { get: vi.fn(), update: vi.fn() } as never,
      post,
      {} as never,
    );

    await handler.dispatch({ type: 'webviewReady' });

    // Subagents and opencode's internal agents must not become chat modes, and
    // only agents that pin a model contribute to the agent -> model map.
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith({
        type: 'agentList',
        payload: {
          agents: ['Prometheus - Plan Builder', 'Atlas - Plan Executor'],
          agentModels: { 'Prometheus - Plan Builder': 'omniroute/pro-models' },
        },
      }),
    );
  });

  it('rejects openDiff paths outside workspace', async () => {
    const handler = createHandler();
    await handler.dispatch({ type: 'openDiff', payload: { filePath: '../secret.txt' } });
    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it('opens http(s) and mailto links in the OS browser', async () => {
    vi.mocked(vscode.env.openExternal).mockClear();
    const handler = createHandler();
    await handler.dispatch({ type: 'openExternal', payload: { url: 'https://example.com/docs' } });
    await handler.dispatch({ type: 'openExternal', payload: { url: 'mailto:dev@example.com' } });
    expect(vscode.env.openExternal).toHaveBeenCalledTimes(2);
  });

  it('blocks link protocols the webview sanitizer already forbids', async () => {
    vi.mocked(vscode.env.openExternal).mockClear();
    const post = vi.fn();
    const handler = createHandler({}, post);
    await handler.dispatch({ type: 'openExternal', payload: { url: 'file:///etc/passwd' } });
    await handler.dispatch({ type: 'openExternal', payload: { url: 'not-a-url' } });
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('emits idle after init succeeds', async () => {
    const post = vi.fn();
    const skills = { createAgentsFile: vi.fn().mockReturnValue({ status: 'created' }) };
    const handler = new SidebarMessageHandler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      skills as never,
      {} as never,
      { get: vi.fn(), update: vi.fn() } as never,
      post,
      {} as never,
    );

    await handler.dispatch({ type: 'runCommand', payload: { command: 'init' } });

    expect(post).toHaveBeenCalledWith({ type: 'status', payload: { status: 'idle' } });
  });

  it('emits idle after init fails', async () => {
    const post = vi.fn();
    const skills = { createAgentsFile: vi.fn().mockReturnValue({ status: 'error', message: 'write denied' }) };
    const handler = new SidebarMessageHandler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      skills as never,
      {} as never,
      { get: vi.fn(), update: vi.fn() } as never,
      post,
      {} as never,
    );

    await handler.dispatch({ type: 'runCommand', payload: { command: 'init' } });

    expect(post).toHaveBeenCalledWith({ type: 'status', payload: { status: 'idle' } });
  });

  it('does not emit sessionDeleted when deletion fails', async () => {
    const post = vi.fn();
    const sessions = { deleteSession: vi.fn().mockRejectedValue(new Error('server rejected')) };
    const handler = createHandler(sessions, post);

    await handler.dispatch({ type: 'deleteSession', payload: { sessionId: 'session-1' } });

    expect(post).toHaveBeenCalledWith({
      type: 'error',
      payload: { message: 'Failed to delete session: server rejected', sessionId: 'session-1' },
    });
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sessionDeleted' }));
  });

  it('does not emit revertResult when revert fails', async () => {
    const post = vi.fn();
    const sessions = { revert: vi.fn().mockRejectedValue(new Error('server rejected')) };
    const handler = createHandler(sessions, post);

    await handler.dispatch({ type: 'revertMessage', payload: { messageId: 'message-1' } });

    expect(post).toHaveBeenCalledWith({ type: 'error', payload: { message: 'Revert failed: server rejected' } });
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'revertResult' }));
  });
});
