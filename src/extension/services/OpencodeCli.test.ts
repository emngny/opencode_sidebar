import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpencodeCli } from './OpencodeCli';

interface TestableOpencodeCli {
  start(): Promise<void>;
  sendPrompt(
    sessionId: string,
    prompt: string,
    options?: { onContent?: (text: string) => void; requestId?: string },
  ): Promise<string>;
  activePrompts: Map<string, { requestId: string; sessionId: string; controller: AbortController; finish: () => void }>;
  apiClient: { abortSession: ReturnType<typeof vi.fn>; updateAuth: ReturnType<typeof vi.fn> } | null;
  sseStream: { connect: ReturnType<typeof vi.fn>; parse: ReturnType<typeof vi.fn> };
  serverManager: { isRunning: boolean; url: string | null; authHeader: Record<string, string> };
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
  it('uses only POST response SSE stream', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.sseStream = {
      connect: vi.fn(),
      parse: vi.fn(async (_response, handler) => {
        handler({
          id: 'evt-1',
          type: 'message.part.delta',
          properties: { sessionID: 'session-1', field: 'text', delta: 'hello' },
        });
        handler({
          id: 'evt-2',
          type: 'session.status',
          properties: { sessionID: 'session-1', status: { type: 'idle' } },
        });
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const onContent = vi.fn();

    await testable.sendPrompt('session-1', 'prompt', { onContent });

    expect(testable.sseStream.connect).not.toHaveBeenCalled();
    expect(testable.sseStream.parse).toHaveBeenCalledOnce();
    expect(onContent).toHaveBeenCalledExactlyOnceWith('hello');
    expect(testable.activePrompts.size).toBe(0);
  });

  it('serializes image parts into the request body', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    testable.sseStream = {
      connect: vi.fn(),
      parse: vi.fn(async (_response, handler) => {
        handler({
          id: 'evt-1',
          type: 'session.status',
          properties: { sessionID: 'session-1', status: { type: 'idle' } },
        });
      }),
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
      connect: vi.fn(),
      parse: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')));

    await expect(testable.sendPrompt('session-1', 'prompt')).resolves.toBe('');
    expect(testable.sseStream.connect).not.toHaveBeenCalled();
    expect(testable.activePrompts.size).toBe(0);
  });

  it('aborts request and SSE stream when prompt times out', async () => {
    vi.useFakeTimers();
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let requestSignal: AbortSignal | undefined;
    let streamHandler: ((event: { id: string; type: string; properties: Record<string, unknown> }) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn(),
      parse: vi.fn((_response, handler) => {
        streamHandler = handler;
        return new Promise<void>(() => undefined);
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve({ ok: true });
      }),
    );

    const content = vi.fn();
    const pending = testable.sendPrompt('session-1', 'prompt', { onContent: content });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await vi.advanceTimersByTimeAsync(120000);

    await expect(pending).resolves.toBe('');
    expect(requestSignal?.aborted).toBe(true);
    expect(testable.sseStream.parse).toHaveBeenCalledWith(expect.anything(), expect.any(Function), requestSignal);
    expect(testable.activePrompts.size).toBe(0);

    streamHandler?.({
      id: 'late-after-timeout',
      type: 'message.part.delta',
      properties: { sessionID: 'session-1', field: 'text', delta: 'late' },
    });
    expect(content).not.toHaveBeenCalled();
    expect(testable.sseStream.parse).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('keeps concurrent session requests isolated during abort', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.apiClient = {
      abortSession: vi.fn().mockResolvedValue(undefined),
      updateAuth: vi.fn(),
    };
    testable.sseStream = {
      connect: vi.fn(),
      parse: vi.fn(async (_response, handler) => {
        const sessionId = String(handler);
        return new Promise<void>(() => undefined);
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const contentA = vi.fn();
    const contentB = vi.fn();

    const promptA = testable.sendPrompt('session-A', 'A', { requestId: 'request-A', onContent: contentA });
    const promptB = testable.sendPrompt('session-B', 'B', { requestId: 'request-B', onContent: contentB });
    await vi.waitFor(() => expect(testable.sseStream.parse).toHaveBeenCalledTimes(2));

    expect(testable.activePrompts.get('request-A')?.controller.signal.aborted).toBe(false);
    expect(testable.activePrompts.get('request-B')?.controller.signal.aborted).toBe(false);

    await testable.abortSession('session-B');
    await expect(promptB).resolves.toBe('');
    expect(testable.activePrompts.has('request-A')).toBe(true);
    expect(testable.activePrompts.has('request-B')).toBe(false);
    expect(testable.apiClient?.abortSession).toHaveBeenCalledWith('session-B');

    const handlerA = testable.sseStream.parse.mock.calls[0][1] as (event: {
      id: string;
      type: string;
      properties: Record<string, unknown>;
    }) => void;
    handlerA({
      id: 'a-1',
      type: 'message.part.delta',
      properties: { sessionID: 'session-A', field: 'text', delta: 'A' },
    });
    handlerA({ id: 'a-2', type: 'session.status', properties: { sessionID: 'session-A', status: { type: 'idle' } } });
    await expect(promptA).resolves.toBe('');
    expect(contentA).toHaveBeenCalledWith('A');
    expect(contentB).not.toHaveBeenCalled();
  });
});
