import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpencodeCli } from './OpencodeCli';

interface TestableOpencodeCli {
  start(): Promise<void>;
  sendPrompt(sessionId: string, prompt: string, options?: { onContent?: (text: string) => void }): Promise<string>;
  idleResolveRefs: Map<string, () => void>;
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
    expect(testable.idleResolveRefs.size).toBe(0);
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
    expect(testable.idleResolveRefs.size).toBe(0);
  });
});
