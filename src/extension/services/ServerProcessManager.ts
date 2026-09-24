import { spawn, ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getErrorMessage } from '../../shared/types';

export interface OpencodeServerInfo {
  port: number;
  url: string;
}

export class ServerStartupAbortedError extends Error {
  constructor() {
    super('opencode server startup aborted');
    this.name = 'ServerStartupAbortedError';
  }
}

/** Owns the opencode server child process and its connection metadata. */
export class ServerProcessManager {
  private process: ChildProcess | null = null;
  private server: OpencodeServerInfo | null = null;
  private startPromise: Promise<void> | null = null;
  private epoch = 0;
  private binaryCandidates: string[] = [];
  private readonly idleResolveHandlers: Set<() => void> = new Set();
  private passwordBuffer: Buffer | null = null;
  private cachedAuthHeader: Record<string, string> = {};

  constructor(private readonly cwd?: string) {}

  get isRunning(): boolean {
    return this.server !== null;
  }

  get url(): string | null {
    return this.server?.url ?? null;
  }

  get authHeader(): Record<string, string> {
    if (!this.server) return {};
    return { ...this.cachedAuthHeader };
  }

  private wipeSecret(): void {
    if (this.passwordBuffer) {
      this.passwordBuffer.fill(0);
      this.passwordBuffer = null;
    }
    this.cachedAuthHeader = {};
  }

  onServerExit(handler: () => void): () => void {
    this.idleResolveHandlers.add(handler);
    return () => this.idleResolveHandlers.delete(handler);
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    const epoch = this.epoch;
    let startup: Promise<void>;
    startup = this.doStart(epoch).finally(() => {
      if (this.startPromise === startup) this.startPromise = null;
    });
    this.startPromise = startup;
    void startup.catch(() => undefined);
    return startup;
  }

  private async doStart(epoch: number): Promise<void> {
    if (this.binaryCandidates.length === 0) this.binaryCandidates = await this.resolveBinaryCandidates();
    this.assertCurrentEpoch(epoch);

    const passwordBuffer = randomBytes(16);
    this.passwordBuffer = passwordBuffer;
    const password = passwordBuffer.toString('hex');
    const deadline = Date.now() + 30000;
    const failures: string[] = [];
    for (const binary of this.binaryCandidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      this.assertCurrentEpoch(epoch);
      try {
        await this.tryStart(binary, password, remaining, epoch);
        return;
      } catch (err: unknown) {
        if (err instanceof ServerStartupAbortedError) throw err;
        failures.push(`${binary}: ${getErrorMessage(err)}`);
        console.warn('[opencode] serve failed with candidate', binary, '-', getErrorMessage(err));
      }
    }
    this.wipeSecretIfOwned(passwordBuffer);
    const detail = failures.length > 1 ? ` (${failures.join(' | ')})` : '';
    throw new Error(`opencode serve failed${detail || ': no binary candidates'}`);
  }

  stop(): void {
    this.epoch += 1;
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.server = null;
    this.wipeSecret();
    this.idleResolveHandlers.forEach((handler) => handler());
  }

  private assertCurrentEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new ServerStartupAbortedError();
  }

  private wipeSecretIfOwned(passwordBuffer: Buffer): void {
    if (this.passwordBuffer === passwordBuffer) this.wipeSecret();
  }

  private async resolveBinaryCandidates(): Promise<string[]> {
    const existing: string[] = [];
    const envPath = process.env.OPENCODE_BIN_PATH;
    if (envPath) {
      try {
        await access(envPath);
        const allowedRoots = [
          process.env.HOME || process.env.USERPROFILE || '',
          process.env.LOCALAPPDATA || '',
          process.env.APPDATA || '',
          process.env.SystemRoot || '',
          process.env.WINDIR || '',
          '/usr/local',
          '/usr/bin',
          '/bin',
          '/usr/lib',
        ].filter(Boolean);
        const resolvedPath = resolve(envPath).replaceAll('\\', '/').toLowerCase();
        if (allowedRoots.some((root) => resolvedPath.startsWith(root.replaceAll('\\', '/').toLowerCase())))
          existing.push(envPath);
        else console.warn('[opencode] OPENCODE_BIN_PATH not in allowed directories:', envPath);
      } catch (err) {
        console.warn('[opencode] Binary path check failed:', err);
      }
    }
    const candidates: string[] = [];
    const platform = process.platform;
    const home = process.env.HOME || process.env.USERPROFILE;
    const npmPrefix = process.env.npm_config_prefix;
    if (platform === 'win32') {
      const appData = process.env.APPDATA;
      if (appData)
        candidates.push(
          String.raw`${appData}\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe`,
        );
      if (appData)
        candidates.push(
          String.raw`${appData}\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64-baseline\bin\opencode.exe`,
        );
    } else if (platform === 'darwin') {
      if (npmPrefix) candidates.push(`${npmPrefix}/bin/opencode`);
      if (home) candidates.push(`${home}/.npm-global/bin/opencode`);
      if (home) candidates.push(`${home}/.local/bin/opencode`);
      candidates.push(
        '/usr/local/bin/opencode',
        '/opt/homebrew/bin/opencode',
        '/opt/local/bin/opencode',
        '/usr/bin/opencode',
      );
    } else {
      if (npmPrefix) candidates.push(`${npmPrefix}/bin/opencode`);
      if (home) candidates.push(`${home}/.local/bin/opencode`);
      if (home) candidates.push(`${home}/.local/share/opencode/bin/opencode`);
      candidates.push('/usr/local/bin/opencode', '/snap/bin/opencode', '/usr/bin/opencode', '/bin/opencode');
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        await access(candidate);
        existing.push(candidate);
      } catch {
        /* unavailable */
      }
    }
    existing.push('opencode');
    return [...new Set(existing)];
  }

  private tryStart(binary: string, password: string, timeoutMs: number, epoch = this.epoch): Promise<void> {
    return new Promise((resolveStart, reject) => {
      const systemPath =
        process.platform === 'win32'
          ? [
              process.env.SystemRoot || String.raw`C:\Windows`,
              process.env.SystemRoot || String.raw`C:\Windows`,
              'System32',
              'Windows',
              String.raw`System32\Wbem`,
            ].join(';')
          : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
      const minimalEnv: Record<string, string | undefined> = {
        OPENCODE_SERVER_PASSWORD: password,
        PATH: systemPath,
        USERPROFILE: process.env.USERPROFILE,
        APPDATA: process.env.APPDATA,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        SYSTEMROOT: process.env.SYSTEMROOT,
        OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
        OPENCODE_CLIENT: process.env.OPENCODE_CLIENT,
        OPENCODE_DISABLE_EMBEDDED_WEB_UI: process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI,
        OPENCODE_EXPERIMENTAL_FILEWATCHER: process.env.OPENCODE_EXPERIMENTAL_FILEWATCHER,
        OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: process.env.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY,
      };
      for (const key of Object.keys(minimalEnv)) if (minimalEnv[key] === undefined) delete minimalEnv[key];
      let proc: ChildProcess;
      try {
        proc = spawn(binary, ['serve', '--port', '0'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: this.cwd,
          env: minimalEnv,
        });
      } catch (err: unknown) {
        reject(err instanceof Error ? err : new Error(getErrorMessage(err)));
        return;
      }
      this.process = proc;
      let started = false;
      let settled = false;
      let outputBuffer = '';
      let stderrTail = '';
      const fail = (message: string, error = new Error(message)) => {
        if (settled) return;
        settled = true;
        const stderr = stderrTail.trim().replace(/\s+/g, ' ').slice(-500);
        reject(stderr ? new Error(`${message} — ${stderr}`) : error);
      };
      proc.stdout?.on('data', (data: Buffer) => {
        outputBuffer += data.toString();
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(outputBuffer);
        if (!match || settled) return;
        if (epoch !== this.epoch) {
          proc.kill('SIGTERM');
          fail('opencode server startup aborted', new ServerStartupAbortedError());
          return;
        }
        settled = true;
        started = true;
        const port = Number.parseInt(match[1], 10);
        this.server = { port, url: `http://127.0.0.1:${port}` };
        const encoded = Buffer.from(`opencode:${password}`).toString('base64');
        this.cachedAuthHeader = { Authorization: `Basic ${encoded}` };
        resolveStart();
      });
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.error('[opencode:err]', text);
          stderrTail = (stderrTail + '\n' + text).slice(-2000);
        }
      });
      proc.on('error', (err: Error) => {
        if (epoch !== this.epoch) fail('opencode server startup aborted', new ServerStartupAbortedError());
        else fail(err.message);
      });
      proc.on('exit', (code: number | null) => {
        if (epoch !== this.epoch) return;
        if (!started) {
          fail(`opencode serve exited with code ${code}`);
          return;
        }
        if (this.process !== proc) return;
        this.process = null;
        this.server = null;
        this.wipeSecret();
        for (const handler of this.idleResolveHandlers) handler();
      });
      setTimeout(() => {
        if (settled) return;
        proc.kill('SIGTERM');
        fail('opencode serve timeout');
      }, timeoutMs);
    });
  }
}
