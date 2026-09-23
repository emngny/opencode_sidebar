import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ServerProcessManager } from './ServerProcessManager';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

interface TestableManager extends ServerProcessManager {
  passwordBuffer: Buffer | null;
  cachedAuthHeader: Record<string, string>;
  server: { port: number; url: string } | null;
  process: { kill: (s?: string) => void } | null;
  tryStart(binary: string, password: string, timeoutMs: number): Promise<void>;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('ServerProcessManager.tryStart', () => {
  it('does not pass OPENCODE_BIN_PATH to the child process', async () => {
    vi.stubEnv('OPENCODE_BIN_PATH', 'C:\\Windows\\Temp\\evil.exe');
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('stop after capture');
    });
    const mgr = new ServerProcessManager() as unknown as TestableManager;

    await expect(mgr.tryStart('opencode', 'secret', 1_000)).rejects.toThrow('stop after capture');

    const childEnv = vi.mocked(spawn).mock.calls[0][2]?.env as Record<string, string | undefined>;
    expect(childEnv).not.toHaveProperty('OPENCODE_BIN_PATH');
    expect(childEnv).toHaveProperty('OPENCODE_SERVER_PASSWORD', 'secret');
  });

  it('sets cachedAuthHeader on successful start', async () => {
    const proc = fakeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);
    const mgr = new ServerProcessManager('/tmp') as unknown as TestableManager;

    const promise = mgr.tryStart('opencode', 'mysecret', 1_000);
    // simulate server printing URL
    proc.stdout.emit('data', Buffer.from('http://127.0.0.1:54321\n'));

    await expect(promise).resolves.toBeUndefined();
    expect(mgr.server).toEqual({ port: 54321, url: 'http://127.0.0.1:54321' });
    const expected = `Basic ${Buffer.from('opencode:mysecret').toString('base64')}`;
    expect(mgr.cachedAuthHeader).toEqual({ Authorization: expected });
    expect(mgr.authHeader).toEqual({ Authorization: expected });
  });
});

describe('ServerProcessManager zeroize', () => {
  it('wipes password buffer and cached header on stop()', () => {
    const mgr = new ServerProcessManager() as unknown as TestableManager;
    const buf = Buffer.from('aabbccddeeff00112233445566778899', 'hex');
    const original = Buffer.from(buf);
    (mgr as any).passwordBuffer = buf;
    mgr.cachedAuthHeader = { Authorization: 'Basic xxx' };
    (mgr as any).server = { port: 1234, url: 'http://127.0.0.1:1234' };
    (mgr as any).process = { kill: vi.fn() };

    mgr.stop();

    // original buffer should be zeroed
    expect(buf.every((b) => b === 0)).toBe(true);
    expect((mgr as any).passwordBuffer).toBeNull();
    expect(mgr.cachedAuthHeader).toEqual({});
    expect(mgr.authHeader).toEqual({});
    expect(mgr.url).toBeNull();
  });

  it('wipes secret on process exit after successful start', async () => {
    const proc = fakeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);
    const mgr = new ServerProcessManager() as unknown as TestableManager;
    // simulate having a passwordBuffer as start() would
    const buf = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    (mgr as any).passwordBuffer = buf;

    const promise = mgr.tryStart('opencode', 'exitsecret', 1_000);
    proc.stdout.emit('data', Buffer.from('http://127.0.0.1:5555\n'));
    await promise;

    // now simulate exit
    proc.emit('exit', 0);

    expect(buf.every((b) => b === 0)).toBe(true);
    expect((mgr as any).passwordBuffer).toBeNull();
    expect(mgr.cachedAuthHeader).toEqual({});
    expect(mgr.url).toBeNull();
  });

  it('authHeader is empty when not running', () => {
    const mgr = new ServerProcessManager();
    expect(mgr.authHeader).toEqual({});
    expect(mgr.isRunning).toBe(false);
  });
});
