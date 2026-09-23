import { describe, expect, it, vi } from 'vitest';
import { ChatCoordinator } from './ChatCoordinator';
import type { OpencodeCli } from './OpencodeCli';
import type { SessionService } from './SessionService';

describe('ChatCoordinator', () => {
  it('streams content and sends end event', async () => {
    const opencode = {
      sendPrompt: vi.fn(async (_id, _prompt, options) => {
        options?.onContent?.('hello');
        return 'message-1';
      }),
    } as unknown as OpencodeCli;
    const sessions = { currentSessionId: 'session-1' } as SessionService;
    const post = vi.fn();
    await new ChatCoordinator(opencode, sessions, post).processPrompt('hi', 'ask');
    expect(post).toHaveBeenCalledWith({ type: 'streamEnd', payload: { content: 'hello' } });
  });
});
