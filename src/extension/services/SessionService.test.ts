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
