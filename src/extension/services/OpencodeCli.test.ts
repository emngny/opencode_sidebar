import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { OpencodeCli } from './OpencodeCli';
import type { SSEMessage } from './SseStream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

interface TestableOpencodeCli {
  server: { url: string; password: string; port: number } | null;
  start(): Promise<void>;
  sendPrompt(sessionId: string, prompt: string, options?: { onContent?: (text: string) => void }): Promise<string>;
  resolveBinaryCandidates(): Promise<string[]>;
  tryStart(binary: string, password: string, timeoutMs: number): Promise<void>;
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
  testable.server = { url: 'http://127.0.0.1:1234', password: 'secret', port: 1234 };
  testable.serverManager = {
    isRunning: true,
    url: testable.server.url,
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

describe('OpencodeCli.resolveBinaryCandidates', () => {
  it('rejects OPENCODE_BIN_PATH under the Windows system directory', async () => {
    const cli = new OpencodeCli();
    const testable = cli as unknown as TestableOpencodeCli;
    const systemRoot = resolve('src');

    vi.stubEnv('OPENCODE_BIN_PATH', resolve('src/extension/services/OpencodeCli.ts'));
    vi.stubEnv('SystemRoot', systemRoot);
    vi.stubEnv('WINDIR', systemRoot);

    const candidates = await testable.resolveBinaryCandidates();

    expect(candidates).not.toContain(process.env.OPENCODE_BIN_PATH);
  });
});

describe('OpencodeCli.tryStart', () => {
  it('does not pass OPENCODE_BIN_PATH to the child process', async () => {
    vi.stubEnv('OPENCODE_BIN_PATH', 'C:\\Windows\\Temp\\evil.exe');
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('stop after capture');
    });
    const cli = new OpencodeCli();
    const testable = cli as unknown as TestableOpencodeCli;

    await expect(testable.tryStart('opencode', 'secret', 1_000)).rejects.toThrow('stop after capture');

    const childEnv = vi.mocked(spawn).mock.calls[0][2]?.env;
    expect(childEnv).not.toHaveProperty('OPENCODE_BIN_PATH');
  });
});

describe('OpencodeCli.sendPrompt', () => {
  it('dispatches duplicate events from both SSE sources only once', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    let eventHandler: ((event: SSEMessage) => void) | undefined;
    testable.sseStream = {
      connect: vi.fn(async (_url, _headers, handler) => { eventHandler = handler; }),
      parse: vi.fn(async (_response, handler) => {
        handler({ id: 'evt-1', type: 'message.part.delta', properties: { sessionID: 'session-1', field: 'text', delta: 'hello' } });
        eventHandler?.({ id: 'evt-1', type: 'message.part.delta', properties: { sessionID: 'session-1', field: 'text', delta: 'hello' } });
        eventHandler?.({ id: 'evt-2', type: 'session.status', properties: { sessionID: 'session-1', status: { type: 'idle' } } });
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const onContent = vi.fn();

    await testable.sendPrompt('session-1', 'prompt', { onContent });

    expect(onContent).toHaveBeenCalledExactlyOnceWith('hello');
    expect(testable.idleResolveRefs.size).toBe(0);
  });

  it('cleans pending idle resolver when POST request fails', async () => {
    const cli = createRunningCli();
    const testable = cli as unknown as TestableOpencodeCli;
    testable.sseStream = {
      connect: vi.fn(() => new Promise(() => undefined)),
      parse: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')));

    await expect(testable.sendPrompt('session-1', 'prompt')).resolves.toBe('');
    expect(testable.idleResolveRefs.size).toBe(0);
  });
});
