import { describe, expect, it, vi } from 'vitest';
import { SidebarMessageHandler } from './SidebarMessageHandler';

vi.mock('vscode', () => ({ workspace: { workspaceFolders: undefined } }));

describe('SidebarMessageHandler', () => {
  it('delegates abort by clearing the active session', async () => {
    const sessions = { abort: vi.fn() };
    const handler = new SidebarMessageHandler(
      {} as never, sessions as never, {} as never, {} as never, {} as never,
      {} as never, { get: vi.fn(), update: vi.fn() } as never, vi.fn(), {} as never,
    );
    await handler.dispatch({ type: 'abort' });
    expect(sessions.abort).toHaveBeenCalledOnce();
  });
});
