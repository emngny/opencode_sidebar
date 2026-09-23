import { spawn, ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ProviderListResult,
  ProjectInfo,
  PathInfo,
  VcsInfo,
  ProviderAuthMap,
  RawSessionMessage,
  RevertResult,
  UnrevertResult,
  SendPromptBody,
  SendPromptPart,
  getErrorMessage,
} from '../../shared/types';
import { ApiClient } from './ApiClient';
import { SseStream, SSEMessage } from './SseStream';
import { EventDispatcher, EventCallbacks } from './EventDispatcher';
import { NormalizedDiff } from '../utils/diffUtils';
import { ServerProcessManager } from './ServerProcessManager';

interface OpencodeServerInfo {
  port: number;
  password: string;
  url: string;
}

interface SessionInfo {
  id: string;
  title?: string;
}

type EventHandler = (event: SSEMessage) => void;

/**
 * Opencode CLI wrapper that manages the server process, HTTP API client,
 * SSE streaming, and event dispatching for the VS Code extension.
 */
export class OpencodeCli {
  private process: ChildProcess | null = null;
  private server: OpencodeServerInfo | null = null;
  private readonly eventHandlers: Set<EventHandler> = new Set();
  private abortController: AbortController | null = null;
  private binaryCandidates: string[] = [];
  private readonly cwd: string | undefined;
  private readonly serverManager: ServerProcessManager;
  private apiClient: ApiClient | null = null;
  private readonly sseStream: SseStream;
  private eventDispatcher: EventDispatcher | null = null;
  private readonly idleResolveRefs = new Map<string, () => void>();

  constructor(cwd?: string) {
    this.cwd = cwd;
    this.serverManager = new ServerProcessManager(cwd);
    this.sseStream = new SseStream();
  }

  /**
   * Ordered list of candidate binaries instead of a single one.
   * The env-var override comes first, but a stale OPENCODE_BIN_PATH
   * (e.g. left behind by an old npm install) must not hard-fail startup:
   * if it fails at serve time we fall through to the next candidate.
   */
  private async resolveBinaryCandidates(): Promise<string[]> {
    const existing: string[] = [];

    // Priority 1: explicit env var override (restricted to user npm directories)
    const envPath = process.env.OPENCODE_BIN_PATH;
    if (envPath) {
      try {
        await access(envPath);
        {
          const home = process.env.HOME || process.env.USERPROFILE;
          const npmPrefix = process.env.npm_config_prefix;
          const appData = process.env.APPDATA;
          const npmExecutableDir = process.platform === 'win32' ? 'npm' : 'bin';
          const allowedRoots = [
            appData ? resolve(appData, 'npm') : '',
            npmPrefix ? resolve(npmPrefix, npmExecutableDir) : '',
            home ? resolve(home, '.npm-global', 'bin') : '',
            '/usr/local/bin',
          ].filter(Boolean);
          const resolvedPath = resolve(envPath);
          const isAllowed = allowedRoots.some(root => {
            const pathFromRoot = relative(resolve(root), resolvedPath);
            return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
          });
          if (isAllowed) existing.push(envPath);
          else console.warn('[opencode] OPENCODE_BIN_PATH not in allowed directories:', envPath);
        }
      } catch (err) { console.warn('[opencode] Binary path check failed:', err); }
    }

    // Priority 2: platform-specific candidates
    const candidates: string[] = [];
    const platform = process.platform;
    const home = process.env.HOME || process.env.USERPROFILE;
    const npmPrefix = process.env.npm_config_prefix;

    if (platform === 'win32') {
      const appData = process.env.APPDATA;
      // npm global installations only
      if (appData) candidates.push(String.raw`${appData}\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe`);
      if (appData) candidates.push(String.raw`${appData}\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64-baseline\bin\opencode.exe`);
    } else if (platform === 'darwin') {
      // macOS npm global + common package managers
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
      // Linux and other Unix
      if (npmPrefix) candidates.push(`${npmPrefix}/bin/opencode`);
      if (home) candidates.push(`${home}/.local/bin/opencode`);
      if (home) candidates.push(`${home}/.local/share/opencode/bin/opencode`);
      candidates.push(
        '/usr/local/bin/opencode',
        '/snap/bin/opencode',
        '/usr/bin/opencode',
        '/bin/opencode',
      );
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        await access(candidate);
        existing.push(candidate);
      } catch {
        // Candidate does not exist or is not accessible.
      }
    }

    // Priority 3: let Node.js resolve from PATH
    existing.push('opencode');

    // De-duplicate while preserving priority order
    return [...new Set(existing)];
  }

  get authHeader(): Record<string, string> {
    return this.serverManager.authHeader;
  }

  get isRunning(): boolean {
    return this.serverManager.isRunning;
  }

  get url(): string | null {
    return this.serverManager.url;
  }

  /**
   * Returns the shared API client for the running server.
   * Auth and other services must use this instance so URL and auth headers
   * stay synchronized with the server lifecycle.
   */
  getApiClient(): ApiClient {
    if (!this.serverManager.isRunning) throw new Error('Opencode server not running');
    if (this.apiClient) {
      this.apiClient.updateAuth(this.serverManager.url!, this.serverManager.authHeader);
    } else {
      this.apiClient = new ApiClient({
        baseUrl: this.serverManager.url!,
        authHeader: this.serverManager.authHeader,
      });
    }
    return this.apiClient;
  }

  private ensureApiClient(): ApiClient {
    return this.getApiClient();
  }

  private async legacyStart(): Promise<void> {
    if (this.server) return;

    if (this.binaryCandidates.length === 0) {
      this.binaryCandidates = await this.resolveBinaryCandidates();
    }

    const password = randomBytes(16).toString('hex');
    const deadline = Date.now() + 30000;
    const failures: string[] = [];

    for (const binary of this.binaryCandidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        await this.tryStart(binary, password, remaining);
        return;
      } catch (err: unknown) {
        failures.push(`${binary}: ${getErrorMessage(err)}`);
        console.warn('[opencode] serve failed with candidate', binary, '-', getErrorMessage(err));
      }
    }

    const detail = failures.length > 1 ? ` (${failures.join(' | ')})` : '';
    throw new Error(`opencode serve failed${detail || ': no binary candidates'}`);
  }

  /**
   * Single start attempt against one binary candidate.
   * Resolves once the server prints its listening URL; rejects on spawn error,
   * early exit, or timeout — with the captured stderr appended so the real
   * cause (e.g. an invalid opencode.json) reaches the UI instead of a bare
   * "exited with code 1".
   */
  private tryStart(binary: string, password: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const minimalEnv: Record<string, string | undefined> = {
        OPENCODE_SERVER_PASSWORD: password,
        PATH: process.env.PATH,
        USERPROFILE: process.env.USERPROFILE,
        APPDATA: process.env.APPDATA,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        SYSTEMROOT: process.env.SYSTEMROOT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
        OPENCODE_CLIENT: process.env.OPENCODE_CLIENT,
        OPENCODE_DISABLE_EMBEDDED_WEB_UI: process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI,
        OPENCODE_EXPERIMENTAL_FILEWATCHER: process.env.OPENCODE_EXPERIMENTAL_FILEWATCHER,
        OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: process.env.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY,
      };
      for (const key of Object.keys(minimalEnv)) {
        if (minimalEnv[key] === undefined) delete minimalEnv[key];
      }

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

      let started = false;
      let outputBuffer = '';
      let stderrTail = '';

      const fail = (msg: string) => {
        if (started) return;
        const stderr = stderrTail.trim().replace(/\s+/g, ' ').slice(-500);
        reject(new Error(stderr ? `${msg} — ${stderr}` : msg));
      };

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputBuffer += text;

        const match = new RegExp(/http:\/\/127\.0\.0\.1:(\d+)/).exec(outputBuffer);
        if (match && !started) {
          started = true;
          const port = Number.parseInt(match[1], 10);
          this.server = { port, password, url: `http://127.0.0.1:${port}` };
          this.process = proc;
          resolve();
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.error('[opencode:err]', text);
          stderrTail = (stderrTail + '\n' + text).slice(-2000);
        }
      });

      proc.on('error', (err: Error) => {
        fail(err.message);
      });

      proc.on('exit', (code: number | null) => {
        if (!started) {
          fail(`opencode serve exited with code ${code}`);
          return;
        }
        this.server = null;
        for (const resolve of this.idleResolveRefs.values()) {
          resolve();
        }
        this.idleResolveRefs.clear();
      });

      setTimeout(() => {
        if (!started) {
          proc.kill();
          fail('opencode serve timeout');
        }
      }, timeoutMs);
    });
  }

  async start(): Promise<void> {
    return this.serverManager.start();
  }

  /**
   * Creates a new chat session.
   * @param title - Optional session title
   * @returns Session ID and title
   */
  async createSession(title?: string): Promise<SessionInfo> {
    await this.start();
    const data = await this.ensureApiClient().createSession(title);
    return { id: data.id, title: data.title };
  }

  async listSessions(): Promise<SessionInfo[]> {
    await this.start();
    return this.ensureApiClient().listSessions();
  }

  async getSessionDiff(sessionId: string): Promise<NormalizedDiff[]> {
    await this.start();
    try {
      return await this.ensureApiClient().getSessionDiff(sessionId);
    } catch {
      return [];
    }
  }

  async getSessionMessages(sessionId: string): Promise<RawSessionMessage[]> {
    await this.start();
    return this.ensureApiClient().getSessionMessages(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().deleteSession(sessionId);
  }

  async getAgents(): Promise<string[]> {
    await this.start();
    return this.ensureApiClient().getAgents();
  }

  async getCurrentProject(): Promise<ProjectInfo | null> {
    await this.start();
    return this.ensureApiClient().getCurrentProject();
  }

  async getPath(): Promise<PathInfo | null> {
    await this.start();
    return this.ensureApiClient().getPath();
  }

  async getVcsInfo(): Promise<VcsInfo | null> {
    await this.start();
    return this.ensureApiClient().getVcsInfo();
  }

  async listProviders(): Promise<ProviderListResult> {
    await this.start();
    return this.ensureApiClient().listProviders();
  }

  async getProviderAuth(): Promise<ProviderAuthMap> {
    await this.start();
    return this.ensureApiClient().getProviderAuth();
  }

  async setAuth(providerId: string, key: string): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().setAuth(providerId, key);
  }

  async removeAuth(providerId: string): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().removeAuth(providerId);
  }

  /**
   * Sends a prompt to a session and streams the response.
   * Accumulates SSE deltas into callbacks, dispatches tool events to onToolEvent,
   * and resolves diffs via onDiffs. Returns once the session becomes idle or times out.
   * @param sessionId - Active session ID from createSession
   * @param prompt - User message text
   * @param options - Optional callbacks and parameters
   * @returns Promise resolving to the message ID when streaming completes
   */
  async sendPrompt(
    sessionId: string,
    prompt: string,
    options?: {
      onContent?: (text: string) => void;
      onToolCall?: (name: string, args: unknown) => void;
      onError?: (error: string) => void;
      model?: string;
      agent?: string;
      extraParts?: SendPromptPart[];
      onToolEvent?: (event: { id: string; type: string; name: string; status: string; content: string; meta?: Record<string, unknown> }) => void;
      onMessageMeta?: (meta: { id: string; agent?: string; modelId?: string; time?: { created?: number; completed?: number } }) => void;
      onReasoning?: (text: string) => void;
      onDiffs?: (diffs: NormalizedDiff[]) => void;
    },
  ): Promise<string> {
    const { onContent, onToolCall, onError, model, agent, extraParts, onToolEvent, onMessageMeta, onReasoning, onDiffs } = options || {};
    await this.start();

    const parts: SendPromptPart[] = [
      ...(extraParts || []),
      { type: 'text', text: prompt },
    ];
    const body: SendPromptBody = { parts };

    if (model?.includes('/')) {
      const [providerID, modelID] = model.split('/');
      body.model = { providerID, modelID };
    } else if (model) {
      body.model = { providerID: 'opencode', modelID: model };
    }
    if (agent) body.agent = agent;

    if (this.abortController) this.abortController.abort();
    const controller = new AbortController();
    this.abortController = controller;

    const callbacks: EventCallbacks = { onContent, onToolCall, onError, onToolEvent, onMessageMeta, onReasoning, onDiffs };
    const dispatcher = new EventDispatcher(callbacks);
    this.eventDispatcher = dispatcher;
    dispatcher.resetSession(sessionId);

    let messageId = '';
    const seenEventIds = new Set<string>();
    const idlePromise = new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => finish();
      const cleanup = () => {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', onAbort);
        this.idleResolveRefs.delete(sessionId);
        dispatcher.clearSession(sessionId);
        if (this.eventDispatcher === dispatcher) this.eventDispatcher = null;
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      this.idleResolveRefs.set(sessionId, finish);
      controller.signal.addEventListener('abort', onAbort, { once: true });

      const dispatchEvent = (event: SSEMessage) => {
        if (settled) return;
        if (event.id) {
          if (seenEventIds.has(event.id)) return;
          seenEventIds.add(event.id);
        }
        const props = event.properties;
        const eventSessionId = typeof props['sessionID'] === 'string'
          ? props['sessionID']
          : typeof props['sessionId'] === 'string' ? props['sessionId'] : undefined;
        if (eventSessionId && eventSessionId !== sessionId) return;

        dispatcher.dispatch(event, sessionId);
        const info = props['info'];
        const infoId = info && typeof info === 'object' && typeof (info as Record<string, unknown>)['id'] === 'string'
          ? (info as Record<string, unknown>)['id'] as string
          : undefined;
        if (!messageId && infoId) messageId = infoId;

        const status = props['status'];
        const statusType = status && typeof status === 'object' ? (status as Record<string, unknown>)['type'] : status;
        if (event.type === 'session.status' && statusType === 'idle') finish();
      };

      void this.sseStream.connect(`${this.server!.url}/event`, this.authHeader, dispatchEvent, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) onError?.(`Event stream failed: ${getErrorMessage(error)}`);
        finish();
      });

      const postUrl = `${this.server!.url}/session/${sessionId}/message`;
      void fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        await this.sseStream.parse(response, dispatchEvent, controller.signal);
        finish();
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        onError?.(`Request failed: ${getErrorMessage(error)}`);
        finish();
      });

      timeout = setTimeout(finish, 120000);
    });

    return idlePromise.then(() => {
      if (this.abortController === controller) this.abortController = null;
      return messageId;
    });
  }

  /**
   * Grants a pending permission (allow once or always) for a session.
   * @param sessionID - Session ID
   * @param permissionId - Permission ID from the permission event
   */
  async grantPermission(sessionID: string, permissionId: string): Promise<void> {
    await this.start();
    return this.ensureApiClient().grantPermission(sessionID, permissionId);
  }

  async summarizeSession(sessionId: string, providerID: string, modelID: string): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().summarizeSession(sessionId, providerID, modelID);
  }

  /**
   * Reverts a message by messageId, undoing file changes via git snapshots.
   * @param sessionId - Session ID
   * @param messageId - Message ID to revert
   * @returns Revert result with messages and reverted status
   */
  async revertSession(sessionId: string, messageId: string): Promise<RevertResult | null> {
    await this.start();
    return this.ensureApiClient().revertSession(sessionId, messageId);
  }

  /**
   * Restores a previously reverted message.
   * @param sessionId - Session ID
   * @returns Unrevert result
   */
  async unrevertSession(sessionId: string): Promise<UnrevertResult | null> {
    await this.start();
    return this.ensureApiClient().unrevertSession(sessionId);
  }

  async respondPermission(sessionID: string, permissionId: string, response: string, remember?: boolean): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().respondPermission(sessionID, permissionId, response, remember);
  }

  /**
   * Aborts a running prompt in the session and cancels any pending requests.
   * @param sessionId - Session ID to abort
   */
  async abortSession(sessionId: string): Promise<void> {
    const controller = this.abortController;
    controller?.abort();
    this.idleResolveRefs.get(sessionId)?.();
    this.idleResolveRefs.delete(sessionId);
    if (this.abortController === controller) this.abortController = null;
    await this.ensureApiClient().abortSession(sessionId);
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Stops the opencode server process and clears all state.
   * Call when the extension deactivates or the sidebar closes.
   */
  stop(): void {
    this.abortController?.abort();
    for (const finish of this.idleResolveRefs.values()) finish();
    this.idleResolveRefs.clear();
    this.eventDispatcher = null;
    this.serverManager.stop();
    this.apiClient = null;
  }
}