import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { SidebarMessageHandler } from './SidebarMessageHandler';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    openTextDocument: vi.fn(),
  },
  window: { showTextDocument: vi.fn() },
  Uri: { file: vi.fn((fsPath) => ({ fsPath })) },
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

  it('rejects openDiff paths outside workspace', async () => {
    const handler = createHandler();
    await handler.dispatch({ type: 'openDiff', payload: { filePath: '../secret.txt' } });
    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
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
