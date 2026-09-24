import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpencodeCli } from './OpencodeCli';

interface TestableOpencodeCli {
  start(): Promise<void>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    options?: {
      onContent?: (text: string) => void;
      onError?: (message: string) => void;
      requestId?: string;
      extraParts?: Array<{ type: string; data?: string; mimeType?: string }>;
    },
  ): Promise<string>;
  activePrompts: Map<string, { requestId: string; sessionId: string; controller: AbortController; finish: () => void }>;
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
    expect(onContent).toHaveBeenCalledWith('mer');

    deferred.resolve();
    await pending;

    // The JSON body then contributes only the remainder, not a duplicate.
    expect(onContent).toHaveBeenCalledWith('haba');
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

    expect(onContent).not.toHaveBeenCalledWith('prompt');
    expect(onContent).toHaveBeenCalledWith('ok');
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
    expect(onContent).toHaveBeenCalledExactlyOnceWith('hello');
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

  it('aborts request and SSE stream when prompt times out', async () => {
    vi.useFakeTimers();
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
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
    const pending = testable.sendPrompt('session-1', 'prompt', { onContent: content });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await vi.advanceTimersByTimeAsync(120000);

    await expect(pending).resolves.toBe('');
    expect(requestSignal?.aborted).toBe(true);
    expect(testable.activePrompts.size).toBe(0);

    streamHandler?.({
      id: 'late-after-timeout',
      type: 'message.part.delta',
      properties: { sessionID: 'session-1', field: 'text', delta: 'late' },
    });
    expect(content).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(contentA).toHaveBeenCalledWith('A'));
    expect(contentB).not.toHaveBeenCalled();
    await testable.abortSession('session-A');
    await expect(promptA).resolves.toBe('');
  });
});
