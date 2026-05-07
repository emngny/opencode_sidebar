import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { ProviderListResult } from '../types';
import { ApiClient } from './ApiClient';
import { SseStream, SSEMessage } from './SseStream';
import { EventDispatcher, EventCallbacks } from './EventDispatcher';
import { NormalizedDiff } from '../utils/diffUtils';

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
  private readonly binaryPath: string = 'opencode';
  private readonly cwd: string | undefined;
  private apiClient: ApiClient | null = null;
  private sseStream: SseStream;
  private eventDispatcher: EventDispatcher | null = null;
  private idleResolveRefs = new Map<string, () => void>();

  constructor(cwd?: string) {
    this.binaryPath = this.resolveBinary();
    this.cwd = cwd;
    this.sseStream = new SseStream();
  }

  private resolveBinary(): string {
    // Priority 1: explicit env var override (restricted to allowed directories)
    const envPath = process.env.OPENCODE_BIN_PATH;
    if (envPath) {
      try {
        if (existsSync(envPath)) {
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
          const resolvedPath = resolve(envPath).replace(/\\/g, '/').toLowerCase();
          const isAllowed = allowedRoots.some(root => resolvedPath.startsWith(root.replace(/\\/g, '/').toLowerCase()));
          if (isAllowed) return envPath;
          console.warn('[opencode] OPENCODE_BIN_PATH not in allowed directories:', envPath);
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
      if (appData) candidates.push(`${appData}\\npm\\node_modules\\opencode-ai\\node_modules\\opencode-windows-x64\\bin\\opencode.exe`);
      if (appData) candidates.push(`${appData}\\npm\\node_modules\\opencode-ai\\node_modules\\opencode-windows-x64-baseline\\bin\\opencode.exe`);
    } else if (platform === 'darwin') {
      // macOS npm global + common package managers
      if (npmPrefix) candidates.push(`${npmPrefix}/bin/opencode`);
      if (home) candidates.push(`${home}/.npm-global/bin/opencode`);
      if (home) candidates.push(`${home}/.local/bin/opencode`);
      candidates.push('/usr/local/bin/opencode');
      candidates.push('/opt/homebrew/bin/opencode');
      candidates.push('/opt/local/bin/opencode');
      candidates.push('/usr/bin/opencode');
    } else {
      // Linux and other Unix
      if (npmPrefix) candidates.push(`${npmPrefix}/bin/opencode`);
      if (home) candidates.push(`${home}/.local/bin/opencode`);
      if (home) candidates.push(`${home}/.local/share/opencode/bin/opencode`);
      candidates.push('/usr/local/bin/opencode');
      candidates.push('/snap/bin/opencode');
      candidates.push('/usr/bin/opencode');
      candidates.push('/bin/opencode');
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        if (existsSync(candidate)) {
          return candidate;
        }
      } catch (err) { /* ignore candidate */ }
    }

    // Priority 3: let Node.js resolve from PATH
    return 'opencode';
  }

  get authHeader(): Record<string, string> {
    if (!this.server) return {};
    const encoded = Buffer.from(`opencode:${this.server.password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  private ensureApiClient(): ApiClient {
    if (!this.server) throw new Error('Opencode server not running');
    if (!this.apiClient) {
      this.apiClient = new ApiClient({
        baseUrl: this.server.url,
        authHeader: this.authHeader,
      });
    } else {
      this.apiClient.updateAuth(this.server.url, this.authHeader);
    }
    return this.apiClient;
  }

  /**
   * Starts the opencode server process if not already running.
   * Spawns `opencode serve --port 0` with a generated password for Basic Auth.
   * @throws Error if server fails to start within 30s timeout
   */
  async start(): Promise<void> {
    if (this.server) return;

    const password = randomBytes(16).toString('hex');

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
        OPENCODE_BIN_PATH: process.env.OPENCODE_BIN_PATH,
      };
      for (const key of Object.keys(minimalEnv)) {
        if (minimalEnv[key] === undefined) delete minimalEnv[key];
      }

      const proc = spawn(this.binaryPath, ['serve', '--port', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.cwd,
        env: minimalEnv,
      });

      let started = false;
      let outputBuffer = '';

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
        if (text) console.error('[opencode:err]', text);
      });

      proc.on('error', (err: Error) => {
        if (!started) reject(err);
      });

proc.on('exit', (code: any) => {
        if (!started) reject(new Error(`opencode serve exited with code ${code}`));
        this.server = null;
        for (const resolve of this.idleResolveRefs.values()) {
          resolve();
        }
        this.idleResolveRefs.clear();
      });

      setTimeout(() => {
        if (!started) {
          proc.kill();
          reject(new Error('opencode serve timeout'));
        }
      }, 30000);
    });
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  get url(): string | null {
    return this.server?.url ?? null;
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
    } catch (err: any) {
      return [];
    }
  }

  async getSessionMessages(sessionId: string): Promise<any[]> {
    await this.start();
    return this.ensureApiClient().getSessionMessages(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().deleteSession(sessionId);
  }

  async getAgents(): Promise<any[]> {
    await this.start();
    return this.ensureApiClient().getAgents();
  }

  async getCurrentProject(): Promise<any> {
    await this.start();
    return this.ensureApiClient().getCurrentProject();
  }

  async getPath(): Promise<any> {
    await this.start();
    return this.ensureApiClient().getPath();
  }

  async getVcsInfo(): Promise<any> {
    await this.start();
    return this.ensureApiClient().getVcsInfo();
  }

  async listProviders(): Promise<ProviderListResult> {
    await this.start();
    return this.ensureApiClient().listProviders();
  }

  async getProviderAuth(): Promise<Record<string, Array<{ type: string; label: string; prompts?: any[] }>>> {
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
      onToolCall?: (name: string, args: any) => void;
      onError?: (error: string) => void;
      model?: string;
      agent?: string;
      extraParts?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      onToolEvent?: (event: { id: string; type: string; name: string; status: string; content: string; meta?: any }) => void;
      onMessageMeta?: (meta: { id: string; agent?: string; modelId?: string; time?: { created?: number; completed?: number } }) => void;
      onReasoning?: (text: string) => void;
      onDiffs?: (diffs: NormalizedDiff[]) => void;
    },
  ): Promise<string> {
    const { onContent, onToolCall, onError, model, agent, extraParts, onToolEvent, onMessageMeta, onReasoning, onDiffs } = options || {};
    await this.start();

    const parts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      ...(extraParts || []),
      { type: 'text', text: prompt },
    ];
    const body: Record<string, any> = { parts };

    if (model?.includes('/')) {
      const [providerID, modelID] = model.split('/');
      body.model = { providerID, modelID };
    } else if (model) {
      body.model = { providerID: 'opencode', modelID: model };
    }
    if (agent) body.agent = agent;

    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    const callbacks: EventCallbacks = {
      onContent,
      onToolCall,
      onError,
      onToolEvent,
      onMessageMeta,
      onReasoning,
      onDiffs,
    };

    this.eventDispatcher = new EventDispatcher(callbacks);
    this.eventDispatcher.resetSession(sessionId);

    let messageId = '';

    const idlePromise = new Promise<void>((resolve) => {
      let settled = false;
      this.idleResolveRefs.set(sessionId, () => {
        if (!settled) {
          settled = true;
          resolve();
          this.idleResolveRefs.delete(sessionId);
        }
      });
      const guard = this.idleResolveRefs.get(sessionId)!;

      const eventUrl = `${this.server!.url}/event`;
      this.sseStream.connect(eventUrl, this.authHeader, (event: SSEMessage) => {
        this.eventDispatcher!.dispatch(event, sessionId);
        if (!messageId && event.properties?.info?.id) messageId = event.properties.info.id;
        if (event.type === 'session.status' && event.properties?.status?.type === 'idle') {
          this.eventDispatcher!.clearSession(sessionId);
          guard();
        }
      }, this.abortController!.signal);

      const postUrl = `${this.server!.url}/session/${sessionId}/message`;
      fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify(body),
        signal: this.abortController!.signal,
      }).catch((err) => {
        console.error('[opencode:post] Error:', err?.message);
        onError?.(err.message || 'POST error');
        guard();
      });

      setTimeout(() => guard(), 600000);
    });

    await idlePromise;
    return messageId;
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
  async revertSession(sessionId: string, messageId: string): Promise<any> {
    await this.start();
    return this.ensureApiClient().revertSession(sessionId, messageId);
  }

  /**
   * Restores a previously reverted message.
   * @param sessionId - Session ID
   * @returns Unrevert result
   */
  async unrevertSession(sessionId: string): Promise<any> {
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
    this.abortController?.abort();
    this.abortController = null;
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
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.server = null;
    this.apiClient = null;
  }
}