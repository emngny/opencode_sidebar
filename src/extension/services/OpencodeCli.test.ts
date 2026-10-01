import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpencodeCli } from './OpencodeCli';
import { EventDispatcher, ToolEvent } from './EventDispatcher';

interface TestableOpencodeCli {
  start(): Promise<void>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    options?: {
      onContent?: (text: string) => void;
      onError?: (message: string) => void;
      onMessageMeta?: (meta: { id: string; agent?: string; modelId?: string; requestedModel?: string }) => void;
      model?: string;
      requestId?: string;
      extraParts?: Array<{ type: string; data?: string; mimeType?: string }>;
    },
  ): Promise<string>;
  activePrompts: Map<string, { requestId: string; sessionId: string; controller: AbortController; finish: () => void }>;
  activeDispatchers: Map<string, EventDispatcher>;
  getActiveRequestId(sessionId: string): string | null;
  getPendingPermission(sessionId: string): ToolEvent | null;
  clearPendingPermission(sessionId: string): void;
  apiClient: { abortSession: ReturnType<typeof vi.fn>; updateAuth: ReturnType<typeof vi.fn> } | null;
  abortSession(sessionId: string): Promise<void>;
  sseStream: { connect: ReturnType<typeof vi.fn>; parse: ReturnType<typeof vi.fn> };
  serverManager: { isRunning: boolean; url: string | null; authHeader: Record<string, string> };
}

/** POST /session/:id/message answers with JSON on current opencode versions. */
function jsonResponse(payload: unknown) {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => payload,
  };
}

/** Legacy opencode versions streamed the reply from the POST itself. */
function sseResponse() {
  return {
    ok: true,
    headers: { get: () => 'text/event-stream' },
    json: async () => ({}),
  };
}

/** Hang detector, not a turn budget — must match TURN_WATCHDOG_MS. */
const WATCHDOG_MS = 30 * 60 * 1000;

/** Lets a test control exactly when the POST resolves, like a real slow turn. */
function deferredJson(payload: unknown) {
  let resolve!: () => void;
  const promise = new Promise((r) => {
    resolve = () => r(jsonResponse(payload));
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('OpencodeCli in-flight turn lookups', () => {
  /**
   * Seeds the private prompt map the way `sendPrompt` would, without running a
   * real turn — the lookups under test only read these two maps.
   */
  function seedActiveTurn(
    entries: Array<{ requestId: string; sessionId: string; pending?: ToolEvent }>,
  ): TestableOpencodeCli {
    const testable = createRunningCli() as unknown as TestableOpencodeCli;
    for (const entry of entries) {
      testable.activePrompts.set(entry.requestId, {
        requestId: entry.requestId,
        sessionId: entry.sessionId,
        controller: new AbortController(),
        finish: () => undefined,
      });
      const dispatcher = new EventDispatcher({});
      if (entry.pending) {
        dispatcher.dispatch(
          {
            id: `evt-${entry.requestId}`,
            type: 'permission.asked',
            properties: { id: 'perm-1', sessionID: entry.sessionId, permission: 'bash' },
          },
          entry.sessionId,
        );
      }
      testable.activeDispatchers.set(entry.requestId, dispatcher);
    }
    return testable;
  }

  it('reports the streaming request id for a session', () => {
    const testable = seedActiveTurn([{ requestId: 'req-1', sessionId: 'session-1' }]);
    expect(testable.getActiveRequestId('session-1')).toBe('req-1');
  });

  it('returns null when the session has no turn in flight', () => {
    const testable = seedActiveTurn([{ requestId: 'req-1', sessionId: 'session-1' }]);
    expect(testable.getActiveRequestId('session-2')).toBeNull();
    expect(seedActiveTurn([]).getActiveRequestId('session-1')).toBeNull();
  });

  it('exposes the permission a session is blocked on', () => {
    const testable = seedActiveTurn([{ requestId: 'req-1', sessionId: 'session-1', pending: {} as ToolEvent }]);
    const pending = testable.getPendingPermission('session-1');
    expect(pending?.type).toBe('permission');
    expect(pending?.meta?.['permId']).toBe('perm-1');
  });

  it('returns no permission for a session that was never asked', () => {
    const testable = seedActiveTurn([{ requestId: 'req-1', sessionId: 'session-1' }]);
    expect(testable.getPendingPermission('session-1')).toBeNull();
  });

  it('drops the held permission once it is answered', () => {
    const testable = seedActiveTurn([{ requestId: 'req-1', sessionId: 'session-1', pending: {} as ToolEvent }]);
    expect(testable.getPendingPermission('session-1')).not.toBeNull();

    testable.clearPendingPermission('session-1');

    expect(testable.getPendingPermission('session-1')).toBeNull();
  });
});

function createRunningCli(): OpencodeCli {
  const cli = new OpencodeCli('/workspace');
  const testable = cli as unknown as TestableOpencodeCli;
  testable.serverManager = {
    isRunning: true,
    url: 'http://127.0.0.1:1234',
    authHeader: { Authorization: 'Basic c2VjcmV0' },
  };
  testable.start = vi.fn().mockResolvedValue(undefined);
  return cli;
}

describe('OpencodeCli API client', () => {
  it('returns one client while the server is running', () => {
    const cli = createRunningCli();

    const first = cli.getApiClient();
    const second = cli.getApiClient();

    expect(second).toBe(first);
  });

  it('rejects client access before the server starts', () => {
    const cli = new OpencodeCli('/workspace');

    expect(() => cli.getApiClient()).toThrow('Opencode server not running');
  });
});

describe('OpencodeCli.sendPrompt', () => {
  it('renders assistant text from the JSON POST body and streams deltas from /event', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let eventHandler: ((event: any) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        eventHandler = handler;
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn(),
    };
    const deferred = deferredJson({
      info: { id: 'msg-assistant', role: 'assistant' },
      parts: [{ id: 'prt-1', type: 'text', text: 'merhaba', messageID: 'msg-assistant' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => deferred.promise),
    );
    const onContent = vi.fn();

    const pending = testable.sendPrompt('session-1', 'prompt', { onContent });
    await vi.waitFor(() => expect(testable.sseStream.connect).toHaveBeenCalledOnce());
    expect(testable.sseStream.connect.mock.calls[0][0]).toBe('http://127.0.0.1:1234/event');

    // A live delta arrives while the turn is still running.
    eventHandler?.({
      id: 'evt-1',
      type: 'message.part.delta',
      properties: { sessionID: 'session-1', messageID: 'msg-assistant', partID: 'prt-1', delta: 'mer' },
    });
    expect(onContent).toHaveBeenCalledWith('mer', 'msg-assistant');

    deferred.resolve();
    await pending;

    // The JSON body then contributes only the remainder, not a duplicate.
    expect(onContent).toHaveBeenCalledWith('haba', 'msg-assistant');
    expect(onContent).toHaveBeenCalledTimes(2);
    expect(testable.activePrompts.size).toBe(0);
  });

  it('does not echo the user prompt part into assistant content', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let eventHandler: ((event: any) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        eventHandler = handler;
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn(),
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ info: { id: 'msg-a', role: 'assistant' }, parts: [{ id: 'p-a', type: 'text', text: 'ok' }] }),
        ),
    );
    const onContent = vi.fn();

    const pending = testable.sendPrompt('session-1', 'prompt', { onContent });
    await vi.waitFor(() => expect(testable.sseStream.connect).toHaveBeenCalledOnce());
    // The user's own message arrives as a text part before the assistant replies.
    eventHandler?.({
      id: 'evt-user',
      type: 'message.updated',
      properties: { sessionID: 'session-1', info: { id: 'msg-user', role: 'user' } },
    });
    eventHandler?.({
      id: 'evt-user-part',
      type: 'message.part.updated',
      properties: {
        sessionID: 'session-1',
        part: { id: 'p-user', type: 'text', text: 'prompt', messageID: 'msg-user' },
      },
    });
    await pending;

    expect(onContent.mock.calls.map((call) => call[0])).not.toContain('prompt');
    expect(onContent).toHaveBeenCalledWith('ok', 'msg-a');
  });

  it('echoes the requested model next to the model the server used', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let eventHandler: ((event: any) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        eventHandler = handler;
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn(),
    };
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const onMessageMeta = vi.fn();

    const pending = testable.sendPrompt('session-1', 'prompt', {
      model: 'opencode/mimo-v2.6-flash-free',
      onMessageMeta,
    });
    await vi.waitFor(() => expect(testable.sseStream.connect).toHaveBeenCalledOnce());
    eventHandler?.({
      id: 'evt-meta',
      type: 'message.updated',
      properties: {
        sessionID: 'session-1',
        info: {
          id: 'msg-a',
          role: 'assistant',
          agent: 'plan',
          model: { providerID: 'omniroute', modelID: 'pro-models' },
        },
      },
    });
    resolveFetch(jsonResponse({ info: { id: 'msg-a', role: 'assistant' }, parts: [] }));
    await pending;

    expect(onMessageMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'plan',
        modelId: 'omniroute/pro-models',
        requestedModel: 'opencode/mimo-v2.6-flash-free',
      }),
    );
  });

  it('still parses a legacy SSE POST response', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.sseStream = {
      connect: vi.fn(() => new Promise<void>(() => undefined)),
      parse: vi.fn(async (_response, handler) => {
        handler({
          id: 'evt-1',
          type: 'message.part.delta',
          properties: { sessionID: 'session-1', field: 'text', delta: 'hello' },
        });
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse()));
    const onContent = vi.fn();

    await testable.sendPrompt('session-1', 'prompt', { onContent });

    expect(testable.sseStream.parse).toHaveBeenCalledOnce();
    expect(onContent).toHaveBeenCalledExactlyOnceWith('hello', undefined);
    expect(testable.activePrompts.size).toBe(0);
  });

  it('serializes image parts into the request body', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ info: { id: 'm' }, parts: [] }));
    vi.stubGlobal('fetch', fetchMock);
    testable.sseStream = {
      connect: vi.fn(() => new Promise<void>(() => undefined)),
      parse: vi.fn(),
    };

    await testable.sendPrompt('session-1', 'describe', {
      extraParts: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.parts).toEqual([
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      { type: 'text', text: 'describe' },
    ]);
  });

  it('cleans pending idle resolver when POST request fails', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.sseStream = {
      connect: vi.fn(() => new Promise<void>(() => undefined)),
      parse: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')));
    const onError = vi.fn();

    await expect(testable.sendPrompt('session-1', 'prompt', { onError })).resolves.toBe('');
    expect(onError).toHaveBeenCalledWith('Request failed: network failed');
    expect(testable.activePrompts.size).toBe(0);
  });

  it('keeps a long turn alive, then aborts the server turn when the watchdog fires', async () => {
    vi.useFakeTimers();
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    const abortSession = vi.fn().mockResolvedValue(undefined);
    testable.apiClient = { abortSession, updateAuth: vi.fn() };
    let requestSignal: AbortSignal | undefined;
    let streamHandler: ((event: { id: string; type: string; properties: Record<string, unknown> }) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        streamHandler = handler;
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn((_response, handler) => {
        streamHandler = handler;
        return new Promise<void>(() => undefined);
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve(sseResponse());
      }),
    );

    const content = vi.fn();
    const onError = vi.fn();
    const pending = testable.sendPrompt('session-1', 'prompt', { onContent: content, onError });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    // Two minutes in, the turn is still the server's business. Cutting the
    // fetch here is what froze the transcript mid-work.
    await vi.advanceTimersByTimeAsync(120000);
    expect(requestSignal?.aborted).toBe(false);
    expect(testable.activePrompts.size).toBe(1);

    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 120000);

    await expect(pending).resolves.toBe('');
    expect(requestSignal?.aborted).toBe(true);
    expect(abortSession).toHaveBeenCalledWith('session-1');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('watchdog'));
    expect(testable.activePrompts.size).toBe(0);

    streamHandler?.({
      id: 'late-after-timeout',
      type: 'message.part.delta',
      properties: { sessionID: 'session-1', field: 'text', delta: 'late' },
    });
    expect(content).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  /**
   * The reported failure: a turn ran 8m24s, undici's 300s headers timeout
   * abandoned the POST, the UI showed `Request failed: fetch failed` and went
   * idle, and the server finished the turn 84 seconds later. The POST sends no
   * response header until the turn is over, so it is structurally incapable of
   * surviving a long turn — the event stream has to own the turn instead.
   */
  it('keeps a turn alive when the POST is abandoned after undici headers timeout', async () => {
    vi.useFakeTimers();
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let streamHandler: ((event: any) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        streamHandler = handler;
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn(),
    };

    // undici rejects with `TypeError: fetch failed` and the reason in `cause`.
    const headersTimeout = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    });
    let postStarted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postStarted = true;
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            // Reproduce the real failure: no response headers, ever.
            setTimeout(() => reject(headersTimeout), 300000);
          });
        }
        return Promise.resolve(sseResponse());
      }),
    );

    const onError = vi.fn();
    const content = vi.fn();
    const pending = testable.sendPrompt('session-1', 'do a long job', { onError, onContent: content });
    await vi.waitFor(() => expect(postStarted).toBe(true));

    // The server accepts the turn: a busy status, then real work.
    streamHandler?.({
      id: 'e1',
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    });
    await vi.advanceTimersByTimeAsync(299000);
    expect(onError).not.toHaveBeenCalled();

    // Five minutes in, undici gives up on the POST.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).not.toHaveBeenCalled();
    // Still ours: no error, and the prompt has not resolved.
    expect(testable.activePrompts.size).toBe(1);

    // Work keeps streaming past the failure — this is what used to be lost.
    streamHandler?.({
      id: 'e2',
      type: 'message.part.delta',
      properties: { sessionID: 'session-1', messageID: 'msg-1', partID: 'p-1', delta: 'still going' },
    });
    expect(content).toHaveBeenCalledWith('still going', 'msg-1');

    // 8m24s in, the server reports the turn is over.
    streamHandler?.({
      id: 'e3',
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'idle' } },
    });
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toBe('');
    expect(onError).not.toHaveBeenCalled();
    expect(testable.activePrompts.size).toBe(0);
    vi.useRealTimers();
  });

  it('still reports a POST that fails before the server accepts the turn', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.sseStream = {
      connect: vi.fn(() => new Promise<void>(() => undefined)),
      parse: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const onError = vi.fn();

    await expect(testable.sendPrompt('session-1', 'prompt', { onError })).resolves.toBe('');
    expect(onError).toHaveBeenCalledWith('Request failed: ECONNREFUSED');
    expect(testable.activePrompts.size).toBe(0);
  });

  it('closes the turn on session idle when the server never answers the POST', async () => {
    vi.useFakeTimers();
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let streamHandler: ((event: any) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        streamHandler = handler;
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn(),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method !== 'POST') return Promise.resolve(sseResponse());
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }),
    );

    const onError = vi.fn();
    const pending = testable.sendPrompt('session-1', 'prompt', { onError });
    await vi.waitFor(() => expect(testable.sseStream.connect).toHaveBeenCalledOnce());

    streamHandler?.({
      id: 's1',
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    });
    streamHandler?.({
      id: 's2',
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'idle' } },
    });
    // The body grace period expires and the turn closes on its own.
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toBe('');
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps concurrent session requests isolated during abort', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.apiClient = {
      abortSession: vi.fn().mockResolvedValue(undefined),
      updateAuth: vi.fn(),
    };
    // Both prompts subscribe to the same /event URL; keep them in call order.
    const handlers: Array<(event: any) => void> = [];
    testable.sseStream = {
      connect: vi.fn((_url, _headers, handler) => {
        handlers.push(handler);
        return new Promise<void>(() => undefined);
      }),
      parse: vi.fn(),
    };
    const fetchMock = vi.fn(() => new Promise<never>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const contentA = vi.fn();
    const contentB = vi.fn();

    // Each prompt subscribes to /event; keep them open so abort behaviour is observable.
    const promptA = testable.sendPrompt('session-A', 'A', { requestId: 'request-A', onContent: contentA });
    const promptB = testable.sendPrompt('session-B', 'B', { requestId: 'request-B', onContent: contentB });
    await vi.waitFor(() => expect(testable.activePrompts.size).toBe(2));

    expect(testable.activePrompts.get('request-A')?.controller.signal.aborted).toBe(false);
    expect(testable.activePrompts.get('request-B')?.controller.signal.aborted).toBe(false);

    await testable.abortSession('session-B');
    await expect(promptB).resolves.toBe('');
    expect(testable.activePrompts.has('request-A')).toBe(true);
    expect(testable.activePrompts.has('request-B')).toBe(false);
    expect(testable.apiClient?.abortSession).toHaveBeenCalledWith('session-B');

    const handlerA = handlers[0];
    handlerA?.({
      id: 'a-1',
      type: 'message.part.delta',
      properties: { sessionID: 'session-A', field: 'text', delta: 'A' },
    });
    await vi.waitFor(() => expect(contentA).toHaveBeenCalledWith('A', undefined));
    expect(contentB).not.toHaveBeenCalled();
    await testable.abortSession('session-A');
    await expect(promptA).resolves.toBe('');
  });
});
