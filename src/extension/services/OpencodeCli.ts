import { randomUUID } from 'node:crypto';
import {
  ProviderListResult,
  ProjectInfo,
  PathInfo,
  VcsInfo,
  ProviderAuthMap,
  RawSessionMessage,
  SendPromptBody,
  SendPromptPart,
  AgentSummary,
  getErrorMessage,
} from '../../shared/types';
import { ApiClient } from './ApiClient';
import { SseStream, SSEMessage } from './SseStream';
import { EventDispatcher, EventCallbacks, MessageMeta } from './EventDispatcher';
import { NormalizedDiff } from '../utils/diffUtils';
import { ServerProcessManager } from './ServerProcessManager';

interface SessionInfo {
  id: string;
  title?: string;
}

interface ActivePrompt {
  requestId: string;
  sessionId: string;
  controller: AbortController;
  finish: () => void;
}

type EventHandler = (event: SSEMessage) => void;

/**
 * Opencode CLI wrapper that manages the server process, HTTP API client,
 * SSE streaming, and event dispatching for the VS Code extension.
 */
export class OpencodeCli {
  private readonly eventHandlers: Set<EventHandler> = new Set();
  private readonly activePrompts = new Map<string, ActivePrompt>();
  private readonly cwd: string | undefined;
  private readonly serverManager: ServerProcessManager;
  private apiClient: ApiClient | null = null;
  private readonly sseStream: SseStream;

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

  async getSessionMessagesStrict(sessionId: string): Promise<RawSessionMessage[]> {
    await this.start();
    return this.ensureApiClient().getSessionMessagesStrict(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.start();
    await this.ensureApiClient().deleteSession(sessionId);
  }

  async getAgents(): Promise<AgentSummary[]> {
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
      onToolEvent?: (event: {
        id: string;
        type: string;
        name: string;
        status: string;
        content: string;
        meta?: Record<string, unknown>;
      }) => void;
      onMessageMeta?: (meta: MessageMeta & { requestedModel?: string }) => void;
      onReasoning?: (text: string) => void;
      onDiffs?: (diffs: NormalizedDiff[]) => void;
      requestId?: string;
    },
  ): Promise<string> {
    const {
      onContent,
      onToolCall,
      onError,
      model,
      agent,
      extraParts,
      onToolEvent,
      onMessageMeta,
      onReasoning,
      onDiffs,
      requestId = randomUUID(),
    } = options || {};
    await this.start();

    const parts: SendPromptPart[] = [...(extraParts || []), { type: 'text', text: prompt }];
    const body: SendPromptBody = { parts };

    // Provider model IDs may contain slashes, so only the first one separates provider from model.
    if (model?.includes('/')) {
      const separator = model.indexOf('/');
      body.model = { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
    } else if (model) {
      body.model = { providerID: 'opencode', modelID: model };
    }
    if (agent) body.agent = agent;

    const controller = new AbortController();
    let finishRequest = () => {};

    // An agent config can pin its own model, which wins over the requested one.
    // Echo the request back so the webview can flag the substitution.
    const emitMessageMeta = onMessageMeta
      ? (meta: MessageMeta) => onMessageMeta({ ...meta, requestedModel: model })
      : undefined;
    const callbacks: EventCallbacks = {
      onContent,
      onToolCall,
      onError,
      onToolEvent,
      onMessageMeta: emitMessageMeta,
      onReasoning,
      onDiffs,
    };
    const dispatcher = new EventDispatcher(callbacks);
    dispatcher.resetSession(sessionId);
    const activePrompt: ActivePrompt = { requestId, sessionId, controller, finish: () => finishRequest() };
    this.activePrompts.set(requestId, activePrompt);

    let messageId = '';
    const seenEventIds = new Set<string>();
    const idlePromise = new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => finish();
      const cleanup = () => {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', onAbort);
        if (this.activePrompts.get(requestId) === activePrompt) {
          this.activePrompts.delete(requestId);
        }
        dispatcher.clearSession(sessionId);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      finishRequest = finish;
      controller.signal.addEventListener('abort', onAbort, { once: true });

      const isOwnEvent = (event: SSEMessage): boolean => {
        const props = event.properties as Record<string, unknown>;
        const raw = props['sessionID'] ?? props['sessionId'];
        const eventSessionId = typeof raw === 'string' ? raw : undefined;
        return !eventSessionId || eventSessionId === sessionId;
      };

      const dispatchEvent = (event: SSEMessage) => {
        if (settled) return;
        if (event.id) {
          if (seenEventIds.has(event.id)) return;
          seenEventIds.add(event.id);
        }
        if (!isOwnEvent(event)) return;

        dispatcher.dispatch(event, sessionId);
        const props = event.properties as Record<string, unknown>;
        const info = props['info'];
        const infoId =
          info && typeof info === 'object' && typeof (info as Record<string, unknown>)['id'] === 'string'
            ? ((info as Record<string, unknown>)['id'] as string)
            : undefined;
        if (!messageId && infoId) messageId = infoId;
      };

      // Subscribe to the server event stream to render deltas and tool events
      // live. The POST request itself is the completion signal, so this stream
      // never ends the prompt — it is aborted with it.
      void this.sseStream
        .connect(`${this.url!}/event`, { ...this.authHeader }, dispatchEvent, controller.signal)
        .catch(() => undefined);

      const postUrl = `${this.url!}/session/${sessionId}/message`;
      void fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('text/event-stream')) {
            // Older opencode versions streamed the assistant reply from the POST itself.
            await this.sseStream.parse(response, dispatchEvent, controller.signal);
          } else {
            // Current opencode versions answer with the finished message as JSON,
            // which is the only place the assistant text arrives in that mode.
            const payload: unknown = await response.json().catch(() => null);
            const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
            const info = record['info'];
            if (info && typeof info === 'object' && typeof (info as Record<string, unknown>)['id'] === 'string') {
              messageId = (info as Record<string, unknown>)['id'] as string;
            }
            dispatcher.applyFinalMessage(record['parts'], info);
          }
          finish();
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          onError?.(`Request failed: ${getErrorMessage(error)}`);
          finish();
        });

      timeout = setTimeout(() => {
        controller.abort();
        finish();
      }, 120000);
    });

    return idlePromise.then(() => messageId);
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
  async revertSession(sessionId: string, messageId: string): Promise<unknown> {
    await this.start();
    return this.ensureApiClient().revertSession(sessionId, messageId);
  }

  /**
   * Restores a previously reverted message.
   * @param sessionId - Session ID
   * @returns Unrevert result
   */
  async unrevertSession(sessionId: string): Promise<unknown> {
    await this.start();
    return this.ensureApiClient().unrevertSession(sessionId);
  }

  async respondPermission(
    sessionID: string,
    permissionId: string,
    response: string,
    remember?: boolean,
  ): Promise<boolean> {
    await this.start();
    return this.ensureApiClient().respondPermission(sessionID, permissionId, response, remember);
  }

  /**
   * Aborts a running prompt in the session and cancels matching local requests.
   * With no request ID, all active requests in the session are cancelled.
   * @param sessionId - Session ID to abort
   * @param requestId - Optional request ID to target
   */
  async abortSession(sessionId: string, requestId?: string): Promise<void> {
    const prompts = [...this.activePrompts.values()].filter(
      (prompt) => prompt.sessionId === sessionId && (!requestId || prompt.requestId === requestId),
    );
    for (const prompt of prompts) {
      prompt.controller.abort();
      prompt.finish();
    }
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
    const prompts = [...this.activePrompts.values()];
    for (const prompt of prompts) {
      prompt.controller.abort();
      prompt.finish();
    }
    this.activePrompts.clear();
    this.serverManager.stop();
    this.apiClient = null;
  }
}
