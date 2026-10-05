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
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'streamEnd',
        payload: expect.objectContaining({ content: 'hello', sessionId: 'session-1', requestId: expect.any(String) }),
      }),
    );

    const requestIds = post.mock.calls
      .filter(([message]) => ['receiveMessage', 'receiveChunk', 'streamEnd'].includes(message.type))
      .map(([message]) => message.payload.requestId);
    expect(new Set(requestIds).size).toBe(1);
    expect(requestIds[0]).toEqual(expect.any(String));
  });

  it('omits fullContent from deltas so the webview can debounce them', async () => {
    const opencode = {
      sendPrompt: vi.fn(async (_id, _prompt, options) => {
        options?.onContent?.('hel', 'msg-1');
        options?.onContent?.('lo', 'msg-1');
        return 'message-1';
      }),
    } as unknown as OpencodeCli;
    const sessions = { currentSessionId: 'session-1' } as SessionService;
    const post = vi.fn();
    await new ChatCoordinator(opencode, sessions, post).processPrompt('hi', 'ask');

    const chunkCalls = post.mock.calls.filter(([message]) => message.type === 'receiveChunk');
    expect(chunkCalls).toHaveLength(2);
    // A running total per delta forces a render + full markdown re-parse per
    // token. The webview buffers deltas behind the 80ms debounce instead, so
    // the wire carries only the chunk.
    expect(chunkCalls[0][0].payload).not.toHaveProperty('fullContent');
    expect(chunkCalls[0][0].payload).toMatchObject({ content: 'hel', messageId: 'msg-1' });
    expect(chunkCalls[1][0].payload).toMatchObject({ content: 'lo', messageId: 'msg-1' });

    // The turn still ends with the accumulated text of its last step.
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'streamEnd',
        payload: expect.objectContaining({ content: 'hello' }),
      }),
    );
  });

  it('forwards processed image parts to the prompt request', async () => {
    const opencode = {
      sendPrompt: vi.fn().mockResolvedValue('message-1'),
    } as unknown as OpencodeCli;
    const sessions = { currentSessionId: 'session-1' } as SessionService;
    const context = {
      process: vi.fn().mockResolvedValue({
        userContent: '',
        extraParts: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      }),
    };
    const post = vi.fn();

    await new ChatCoordinator(opencode, sessions, post, context as never).processPrompt('', 'ask', [
      { type: 'image', name: 'shot.png', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);

    expect(opencode.sendPrompt).toHaveBeenCalledWith(
      'session-1',
      '',
      expect.objectContaining({
        extraParts: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      }),
    );
  });
});
