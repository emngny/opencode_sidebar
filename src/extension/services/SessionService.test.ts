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

  it('aborts the active session on the server and releases the handle', async () => {
    const abortSession = vi.fn().mockResolvedValue(undefined);
    const sessions = new SessionService({ abortSession } as never);
    sessions.currentSessionId = 'session-1';

    await sessions.abort();

    expect(abortSession).toHaveBeenCalledWith('session-1');
    expect(sessions.currentSessionId).toBeNull();
  });

  it('is a no-op when no session is active', async () => {
    // `clearChat` is dispatched unconditionally by the webview's New Chat
    // button, including before the first prompt of a fresh sidebar.
    const abortSession = vi.fn();
    const sessions = new SessionService({ abortSession } as never);
    expect(sessions.currentSessionId).toBeNull();

    await expect(sessions.abort()).resolves.toBeUndefined();

    expect(abortSession).not.toHaveBeenCalled();
    expect(sessions.currentSessionId).toBeNull();
  });
});

describe('SessionService.loadSession', () => {
  const rawTurn = () => [
    { info: { id: 'msg-1', role: 'user', time: { created: 1 } }, parts: [{ text: 'hi' }] },
    { info: { id: 'msg-2', role: 'assistant', time: { created: 2 } }, parts: [{ text: 'hello' }] },
  ];

  it('stamps the trailing assistant message when a turn is still streaming', async () => {
    // The webview routes deltas by requestId, so the in-flight turn has to
    // arrive with one or the next delta opens a duplicate bubble.
    const opencode = { getSessionMessages: vi.fn().mockResolvedValue(rawTurn()) } as never;
    const sessions = new SessionService(opencode);

    const messages = await sessions.loadSession('session-1', 'req-9');

    expect(messages).toHaveLength(2);
    expect(messages[0].requestId).toBeUndefined();
    expect(messages[1].requestId).toBe('req-9');
    expect(messages[1].isStreaming).toBe(true);
  });

  it('leaves the transcript unstamped when no turn is in flight', async () => {
    const opencode = { getSessionMessages: vi.fn().mockResolvedValue(rawTurn()) } as never;
    const sessions = new SessionService(opencode);

    const messages = await sessions.loadSession('session-1');

    expect(messages.every((m) => m.requestId === undefined)).toBe(true);
    expect(messages.some((m) => m.isStreaming)).toBe(false);
  });

  it('does not stamp when the transcript ends on a user message', async () => {
    // A trailing user turn means the assistant has not spoken yet; stamping it
    // would put the id on a message the webview never streams into.
    const opencode = {
      getSessionMessages: vi.fn().mockResolvedValue([rawTurn()[0]]),
    } as never;
    const sessions = new SessionService(opencode);

    const messages = await sessions.loadSession('session-1', 'req-9');

    expect(messages[0].requestId).toBeUndefined();
  });
});

describe('SessionService.loadSession restored cards', () => {
  const service = (raw: unknown[], diff: unknown[] = []) => {
    const opencode = {
      getSessionMessages: vi.fn().mockResolvedValue(raw),
      getSessionDiff: vi.fn().mockResolvedValue(diff),
    } as never;
    return new SessionService(opencode);
  };

  const toolPart = (id: string, tool: string, status = 'completed') => ({
    id,
    type: 'tool',
    tool,
    state: { status, result: 'ok' },
  });

  it('restores the tool cards the text-only mapper drops', async () => {
    // A restored session used to come back as bare conversation text: every
    // read, command, and edit card was missing.
    const messages = await service([
      {
        info: { id: 'm1', role: 'assistant', time: { created: 2 } },
        parts: [{ type: 'text', text: 'done' }, toolPart('p1', 'bash')],
      },
    ]).loadSession('s1');

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('done');
    expect(messages[1]).toMatchObject({
      role: 'event',
      eventType: 'tool_result',
      eventStatus: 'completed',
      eventMeta: { result: 'ok', name: 'bash' },
    });
  });

  it('does not invent a text card for a message that only ran tools', async () => {
    const messages = await service([
      { info: { id: 'm1', role: 'assistant', time: { created: 2 } }, parts: [toolPart('p1', 'bash')] },
    ]).loadSession('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('event');
  });

  it('restores one card per file the session changed, at the end', async () => {
    const messages = await service(
      [{ info: { id: 'm1', role: 'user', time: { created: 1 } }, parts: [{ text: 'hi' }] }],
      [
        { path: 'a.ts', added: 6, deleted: 1, content: '+x' },
        { path: 'b.ts', added: 2, deleted: 0, content: '+y' },
      ],
    ).loadSession('s1');

    const edits = messages.filter((m) => m.eventType === 'file_edit');
    expect(edits).toHaveLength(2);
    expect(messages.at(-1)?.eventType).toBe('file_edit');
    expect(edits[0].eventMeta).toMatchObject({ path: 'a.ts', added: 6, deleted: 1 });
  });

  it('ignores files the diff reports as unchanged', async () => {
    const messages = await service([], [{ path: 'a.ts', added: 0, deleted: 0, content: '' }]).loadSession('s1');

    expect(messages.filter((m) => m.eventType === 'file_edit')).toHaveLength(0);
  });

  it('still shows the conversation when the diff request fails', async () => {
    const opencode = {
      getSessionMessages: vi.fn().mockResolvedValue([{ info: { id: 'm1', role: 'user' }, parts: [{ text: 'hi' }] }]),
      getSessionDiff: vi.fn().mockRejectedValue(new Error('no diff')),
    } as never;

    const messages = await new SessionService(opencode).loadSession('s1');

    expect(messages.map((m) => m.content)).toContain('hi');
  });

  describe('per-turn trimming', () => {
    const manyTools = (count: number, failed = 0) => [
      { info: { id: 'm0', role: 'user', time: { created: 1 } }, parts: [{ text: 'go' }] },
      ...Array.from({ length: count }, (_, i) => ({
        info: { id: `m${i + 1}`, role: 'assistant', time: { created: 10 + i } },
        parts: [toolPart(`p${i}`, 'bash', i < failed ? 'failed' : 'completed')],
      })),
    ];

    it('keeps the last few routine cards and summarises the rest', async () => {
      const messages = await service(manyTools(10)).loadSession('s1');

      const summary = messages.find((m) => m.id === 'ops_summary_1');
      expect(summary?.content).toBe('7 earlier operations');
      expect(messages.filter((m) => m.eventType === 'tool_result').length).toBe(4);
    });

    it('never hides a failure', async () => {
      // A dropped error is worse than a long list, so failures survive the trim.
      const messages = await service(manyTools(10, 8)).loadSession('s1');

      expect(messages.filter((m) => m.eventStatus === 'failed').length).toBe(8);
    });

    it('does not summarise a short turn', async () => {
      const messages = await service(manyTools(2)).loadSession('s1');

      expect(messages.some((m) => m.id.startsWith('ops_summary_'))).toBe(false);
    });

    it('never trims the cards that say what changed on disk', async () => {
      const raw = manyTools(10);
      const messages = await service(raw, [
        { path: 'a.ts', added: 1, deleted: 0, content: '+x' },
        { path: 'b.ts', added: 1, deleted: 0, content: '+y' },
        { path: 'c.ts', added: 1, deleted: 0, content: '+z' },
        { path: 'd.ts', added: 1, deleted: 0, content: '+w' },
      ]).loadSession('s1');

      expect(messages.filter((m) => m.eventType === 'file_edit').length).toBe(4);
    });

    it('counts each turn on its own', async () => {
      const messages = await service([
        ...manyTools(6).slice(0, 1),
        ...manyTools(6).slice(1),
        { info: { id: 'u2', role: 'user', time: { created: 100 } }, parts: [{ text: 'again' }] },
        ...manyTools(6).slice(1),
      ]).loadSession('s1');

      const summaries = messages.filter((m) => m.id.startsWith('ops_summary_'));
      expect(summaries).toHaveLength(2);
      expect(summaries.map((m) => m.content)).toEqual(['3 earlier operations', '3 earlier operations']);
    });
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
