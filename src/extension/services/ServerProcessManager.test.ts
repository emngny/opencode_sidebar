import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { ServerProcessManager, ServerStartupAbortedError } from './ServerProcessManager';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

interface TestableManager extends Omit<ServerProcessManager, 'process'> {
  passwordBuffer: Buffer | null;
  cachedAuthHeader: Record<string, string>;
  server: { port: number; url: string } | null;
  process: { kill: (s?: string) => void } | null;
  binaryCandidates: string[];
  tryStart(binary: string, password: string, timeoutMs: number, epoch?: number): Promise<void>;
  resolveBinaryCandidates(): Promise<string[]>;
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

describe('ServerProcessManager.resolveBinaryCandidates', () => {
  it('accepts an existing OPENCODE_BIN_PATH under an allowed root and deduplicates candidates', async () => {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const binaryPath = `${systemRoot}\\opencode-test.exe`;
    vi.stubEnv('OPENCODE_BIN_PATH', binaryPath);
    vi.mocked(access).mockResolvedValue(undefined);
    const mgr = new ServerProcessManager() as unknown as TestableManager;

    const candidates = await mgr.resolveBinaryCandidates();

    expect(candidates[0]).toBe(binaryPath);
    expect(candidates.at(-1)).toBe('opencode');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('always includes PATH fallback when candidate files are unavailable', async () => {
    vi.mocked(access).mockRejectedValue(new Error('missing'));
    const mgr = new ServerProcessManager() as unknown as TestableManager;

    const candidates = await mgr.resolveBinaryCandidates();

    expect(candidates).toContain('opencode');
  });
  it('resolves the installed CLI through PATH instead of bundling it', async () => {
    vi.stubEnv('PATH', process.platform === 'win32' ? String.raw`C:\tools\npm` : '/opt/tools/npm');
    vi.mocked(access).mockResolvedValue(undefined);
    const mgr = new ServerProcessManager() as unknown as TestableManager;

    const candidates = await mgr.resolveBinaryCandidates();

    const expected = process.platform === 'win32' ? String.raw`C:\tools\npm\opencode.exe` : '/opt/tools/npm/opencode';
    expect(candidates).toContain(expected);
    expect(candidates.at(-1)).toBe('opencode');
  });

  it('resolves the global npm opencode-ai layout from the npm prefix', async () => {
    const prefix = process.platform === 'win32' ? String.raw`C:\Users\test\AppData\Roaming\npm` : '/home/test/.npm';
    vi.stubEnv('npm_config_prefix', prefix);
    vi.mocked(access).mockResolvedValue(undefined);
    const mgr = new ServerProcessManager() as unknown as TestableManager;

    const candidates = await mgr.resolveBinaryCandidates();

    const expected =
      process.platform === 'win32'
        ? String.raw`C:\Users\test\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe`
        : '/home/test/.npm/node_modules/opencode-ai/bin/opencode';
    expect(candidates).toContain(expected);
  });
});

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

describe('ServerProcessManager lifecycle concurrency', () => {
  it('shares one in-flight startup between concurrent callers', async () => {
    const proc = fakeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);
    const mgr = new ServerProcessManager('/tmp') as unknown as TestableManager;
    mgr.binaryCandidates = ['opencode'];

    const first = mgr.start();
    const second = mgr.start();
    proc.stdout.emit('data', Buffer.from('http://127.0.0.1:54321\n'));
    await Promise.all([first, second]);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(mgr.server).toEqual({ port: 54321, url: 'http://127.0.0.1:54321' });
  });

  it('ignores exit from a stale process after a new server starts', async () => {
    const firstProc = fakeProc();
    const secondProc = fakeProc();
    vi.mocked(spawn)
      .mockReturnValueOnce(firstProc as any)
      .mockReturnValueOnce(secondProc as any);
    const mgr = new ServerProcessManager('/tmp') as unknown as TestableManager;
    mgr.binaryCandidates = ['opencode'];

    const firstStart = mgr.start();
    firstProc.stdout.emit('data', Buffer.from('http://127.0.0.1:54321\n'));
    await firstStart;
    mgr.stop();

    const secondStart = mgr.start();
    secondProc.stdout.emit('data', Buffer.from('http://127.0.0.1:54322\n'));
    await secondStart;
    firstProc.emit('exit', 0);

    expect(mgr.server).toEqual({ port: 54322, url: 'http://127.0.0.1:54322' });
    expect(mgr.authHeader.Authorization).toBeTruthy();
  });

  it('kills and rejects a process that becomes obsolete during startup', async () => {
    const proc = fakeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);
    const mgr = new ServerProcessManager('/tmp') as unknown as TestableManager;
    mgr.binaryCandidates = ['opencode'];

    const startup = mgr.start();
    await Promise.resolve();
    mgr.stop();
    proc.stdout.emit('data', Buffer.from('http://127.0.0.1:54321\n'));

    await expect(startup).rejects.toBeInstanceOf(ServerStartupAbortedError);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('allows a later startup after an earlier startup fails', async () => {
    const proc = fakeProc();
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('first failed');
    });
    vi.mocked(spawn).mockReturnValueOnce(proc as any);
    const mgr = new ServerProcessManager('/tmp') as unknown as TestableManager;
    mgr.binaryCandidates = ['opencode'];

    await expect(mgr.start()).rejects.toThrow('opencode serve failed');
    const retry = mgr.start();
    proc.stdout.emit('data', Buffer.from('http://127.0.0.1:54323\n'));
    await retry;

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(mgr.server?.port).toBe(54323);
  });
});
