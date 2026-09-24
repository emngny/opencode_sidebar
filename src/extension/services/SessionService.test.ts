import { describe, expect, it, vi } from 'vitest';
import { SessionService } from './SessionService';

describe('SessionService.abort', () => {
  it('keeps current session until abort request resolves', async () => {
    let resolveAbort: (() => void) | undefined;
    const opencode = {
      abortSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveAbort = resolve;
          }),
      ),
    } as never;
    const sessions = new SessionService(opencode);
    sessions.currentSessionId = 'session-1';

    const aborting = sessions.abort();
    expect(sessions.currentSessionId).toBe('session-1');
    resolveAbort?.();
    await aborting;
    expect(sessions.currentSessionId).toBeNull();
  });
});

describe('SessionService mutations', () => {
  it('clears the active session only after successful deletion', async () => {
    let resolveDelete: (() => void) | undefined;
    const opencode = {
      deleteSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          }),
      ),
    } as never;
    const sessions = new SessionService(opencode);
    sessions.currentSessionId = 'session-1';

    const deleting = sessions.deleteSession('session-1');
    expect(sessions.currentSessionId).toBe('session-1');
    resolveDelete?.();
    await deleting;
    expect(sessions.currentSessionId).toBeNull();
  });

  it('preserves the active session when deletion fails', async () => {
    const opencode = { deleteSession: vi.fn().mockRejectedValue(new Error('delete rejected')) } as never;
    const sessions = new SessionService(opencode);
    sessions.currentSessionId = 'session-1';

    await expect(sessions.deleteSession('session-1')).rejects.toThrow('delete rejected');
    expect(sessions.currentSessionId).toBe('session-1');
  });

  it('preserves the active session when revert fails', async () => {
    const opencode = { revertSession: vi.fn().mockRejectedValue(new Error('revert rejected')) } as never;
    const sessions = new SessionService(opencode);
    sessions.currentSessionId = 'session-1';

    await expect(sessions.revert('message-1')).rejects.toThrow('revert rejected');
    expect(sessions.currentSessionId).toBe('session-1');
  });

  it('preserves the active session when unrevert fails', async () => {
    const opencode = { unrevertSession: vi.fn().mockRejectedValue(new Error('unrevert rejected')) } as never;
    const sessions = new SessionService(opencode);
    sessions.currentSessionId = 'session-1';

    await expect(sessions.unrevert()).rejects.toThrow('unrevert rejected');
    expect(sessions.currentSessionId).toBe('session-1');
  });
});
