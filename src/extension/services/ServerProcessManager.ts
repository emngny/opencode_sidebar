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

/**
 * Builds the child PATH: the platform's system directories first, then the
 * inherited value. The system prefix is what lets the server find core tools
 * even when the inherited PATH is minimal, and appending rather than replacing
 * is what keeps git, ripgrep, and language servers reachable.
 *
 * Extracted so both platform branches are directly testable — a caller that
 * re-derives this inline will drift, and a Windows-only expectation here fails
 * on Linux CI.
 */
export function buildChildPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const win = platform === 'win32';
  const sep = win ? ';' : ':';
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || String.raw`C:\Windows`;
  const systemPath = win
    ? [String.raw`${systemRoot}\System32`, systemRoot, String.raw`${systemRoot}\System32\Wbem`].join(sep)
    : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(sep);
  return [systemPath, env.PATH].filter(Boolean).join(sep);
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

    // Prefer an opencode CLI already installed on the machine — do not bundle it.
    const platform = process.platform;
    const win = platform === 'win32';
    const home = process.env.HOME || process.env.USERPROFILE;
    const npmPrefix = process.env.npm_config_prefix;
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    const exe = win ? 'opencode.exe' : 'opencode';
    const pathSep = win ? '\\' : '/';
    const candidates: string[] = [];

    const npmRoots = [npmPrefix, appData ? String.raw`${appData}\npm` : undefined].filter(
      (root): root is string => !!root,
    );
    const installDirs = [
      localAppData ? String.raw`${localAppData}\Programs\opencode` : undefined,
      home ? String.raw`${home}\.opencode\bin` : undefined,
      home ? String.raw`${home}\.local\bin` : undefined,
    ].filter((dir): dir is string => !!dir);

    for (const root of [...npmRoots, ...installDirs, ...npmRoots.map((root) => String.raw`${root}\node_modules`)]) {
      candidates.push(`${root}${pathSep}${exe}`, `${root}${pathSep}bin${pathSep}${exe}`);
    }
    // Global npm layout: <prefix>/node_modules/opencode-ai/bin/opencode(.exe)
    for (const root of npmRoots) {
      candidates.push(`${root}${pathSep}node_modules${pathSep}opencode-ai${pathSep}bin${pathSep}${exe}`);
    }

    // Resolve the CLI through PATH, including npm shim folders that only ship a wrapper.
    const pathEntries = (process.env.PATH || '').split(win ? ';' : ':');
    for (const dir of pathEntries) {
      if (!dir) continue;
      candidates.push(
        `${dir}${pathSep}${exe}`,
        `${dir}${pathSep}node_modules${pathSep}opencode-ai${pathSep}bin${pathSep}${exe}`,
      );
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
      // Keep the inherited PATH so the server can locate git, ripgrep, language tools, etc.
      const childPath = buildChildPath(process.env);
      // Inherit the host environment rather than allow-listing a handful of
      // variables. Tools the agent runs (bash, node, git, language servers)
      // need the full environment: without PATHEXT an extensionless command
      // such as `node` cannot be resolved to `node.exe` on Windows, and
      // without ComSpec/TEMP many shell-based tools fail outright. An
      // allow-list here silently breaks tool execution, which is far worse
      // than inheriting the environment the user already runs the extension in.
      const childEnv: Record<string, string | undefined> = { ...process.env, PATH: childPath };
      // Drop every OPENCODE_* override from the outer environment — it must not
      // be able to re-point the binary, the config, or the permission set of the
      // server we are about to start. The values below are re-added explicitly.
      for (const key of Object.keys(childEnv)) {
        if (key.toUpperCase().startsWith('OPENCODE_')) delete childEnv[key];
      }
      childEnv.OPENCODE_SERVER_PASSWORD = password;
      childEnv.OPENCODE_SERVER_USERNAME = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
      for (const key of [
        'OPENCODE_CLIENT',
        'OPENCODE_DISABLE_EMBEDDED_WEB_UI',
        'OPENCODE_EXPERIMENTAL_FILEWATCHER',
        'OPENCODE_EXPERIMENTAL_ICON_DISCOVERY',
      ]) {
        const value = process.env[key];
        if (value !== undefined) childEnv[key] = value;
      }
      let proc: ChildProcess;
      try {
        proc = spawn(binary, ['serve', '--port', '0'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: this.cwd,
          env: childEnv,
          windowsHide: true,
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
