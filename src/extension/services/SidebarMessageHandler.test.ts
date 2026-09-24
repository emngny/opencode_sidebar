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

function createHandler(sessions = { abort: vi.fn() }) {
  return new SidebarMessageHandler(
    {} as never,
    sessions as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: vi.fn(), update: vi.fn() } as never,
    vi.fn(),
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
});
