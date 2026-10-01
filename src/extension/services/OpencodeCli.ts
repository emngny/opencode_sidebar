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
  isRecord,
} from '../../shared/types';
import { ApiClient } from './ApiClient';
import { SseStream, SSEMessage } from './SseStream';
import { EventDispatcher, EventCallbacks, MessageMeta, ToolEvent } from './EventDispatcher';
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
 * Safety net for a turn that never completes. A real turn runs for as long as
 * it needs — long tool loops and slow free-tier models regularly take ten
 * minutes — so this is a hang detector, not a budget. When it does fire it
 * stops the server turn as well; aborting the HTTP fetch alone leaves the
 * session running its loop with nobody listening to the result.
 */
const TURN_WATCHDOG_MS = 30 * 60 * 1000;

/**
 * How long to wait for the POST body after the server reports idle. The idle
 * event and the finished JSON body arrive together, and the body is the
 * authoritative record of the turn, so it gets a moment to land.
 */
const POST_BODY_GRACE_MS = 2000;

/**
 * Opencode CLI wrapper that manages the server process, HTTP API client,
 * SSE streaming, and event dispatching for the VS Code extension.
 */
export class OpencodeCli {
  private readonly eventHandlers: Set<EventHandler> = new Set();
  private readonly activePrompts = new Map<string, ActivePrompt>();
  /**
   * Dispatcher per in-flight request, so an unanswered permission can be
   * replayed into a webview that was deallocated while the view was hidden.
   * Keyed like `activePrompts` and cleared in the same place.
   */
  private readonly activeDispatchers = new Map<string, EventDispatcher>();
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
   * Request id of the turn currently streaming in `sessionId`, or `null`.
   *
   * A webview is deallocated while its view is hidden, so on re-show the
   * transcript has to be rebuilt from the server. The server keeps streaming
   * meanwhile, and `activePrompts` already holds the correlation id the webview
   * uses to attach incoming deltas — re-reading it here lets the rehydrated
   * transcript attach to the live turn instead of opening a duplicate bubble.
   */
  getActiveRequestId(sessionId: string): string | null {
    for (const [requestId, prompt] of this.activePrompts) {
      if (prompt.sessionId === sessionId) return requestId;
    }
    return null;
  }

  /**
   * The permission request `sessionId` is still blocked on, if any.
   *
   * Only the live event carries it, so a webview that was hidden when the
   * request arrived can never recover the prompt from the session history.
   */
  getPendingPermission(sessionId: string): ToolEvent | null {
    for (const [requestId, prompt] of this.activePrompts) {
      if (prompt.sessionId !== sessionId) continue;
      return this.activeDispatchers.get(requestId)?.getPendingPermission()?.event ?? null;
    }
    return null;
  }

  /** Forgets the held permission request for `sessionId`. */
  clearPendingPermission(sessionId: string): void {
    for (const [requestId, prompt] of this.activePrompts) {
      if (prompt.sessionId !== sessionId) continue;
      this.activeDispatchers.get(requestId)?.clearPendingPermission();
    }
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
      /** `messageId` is the server's assistant message, so callers can split a turn into steps. */
      onContent?: (text: string, messageId?: string) => void;
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
      onReasoning?: (text: string, messageId?: string) => void;
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
    this.activeDispatchers.set(requestId, dispatcher);

    let messageId = '';
    const seenEventIds = new Set<string>();
    const idlePromise = new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let idleGrace: ReturnType<typeof setTimeout> | undefined;
      let turnStarted = false;
      let postDone = false;
      const onAbort = () => finish();
      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(idleGrace);
        controller.signal.removeEventListener('abort', onAbort);
        if (this.activePrompts.get(requestId) === activePrompt) {
          this.activePrompts.delete(requestId);
          this.activeDispatchers.delete(requestId);
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

      /**
       * `session.status` idle is the server saying the turn is over, and it
       * arrives once per turn (measured: repeated `busy`, a single `idle`).
       * The POST cannot carry that signal: current opencode answers it as JSON
       * only once the turn finishes, so no response header exists until then and
       * undici abandons the fetch after five minutes. Long turns were therefore
       * reported as `fetch failed` while the server carried on regardless.
       */
      const handleIdle = (): void => {
        if (postDone) {
          finish();
          return;
        }
        // The POST body carries the authoritative finished message and reaches
        // us at the same moment as the idle event, so let it land first.
        if (idleGrace) clearTimeout(idleGrace);
        idleGrace = setTimeout(() => finish(), POST_BODY_GRACE_MS);
      };

      const dispatchEvent = (event: SSEMessage) => {
        if (settled) return;
        if (event.id) {
          if (seenEventIds.has(event.id)) return;
          seenEventIds.add(event.id);
        }
        if (!isOwnEvent(event)) return;

        const props = event.properties as Record<string, unknown>;
        const status = props['status'];
        const isIdle = event.type === 'session.status' && isRecord(status) && status['type'] === 'idle';
        if (!isIdle) turnStarted = true;

        dispatcher.dispatch(event, sessionId);
        const info = props['info'];
        const infoId =
          info && typeof info === 'object' && typeof (info as Record<string, unknown>)['id'] === 'string'
            ? ((info as Record<string, unknown>)['id'] as string)
            : undefined;
        if (!messageId && infoId) messageId = infoId;
        if (isIdle) handleIdle();
      };

      // Subscribe to the server event stream to render deltas and tool events
      // live. It is also what keeps the turn alive once the POST is gone, so it
      // reconnects for as long as the prompt runs rather than giving up.
      void this.sseStream
        .connect(`${this.url!}/event`, { ...this.authHeader }, dispatchEvent, controller.signal, {
          maxRetries: Number.POSITIVE_INFINITY,
        })
        .catch(() => undefined);

      const postUrl = `${this.url!}/session/${sessionId}/message`;
      void fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then(async (response) => {
          postDone = true;
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('text/event-stream')) {
            // Older opencode versions streamed the assistant reply from the POST itself.
            await this.sseStream.parse(response, dispatchEvent, controller.signal);
          } else {
            // Current opencode versions answer with the finished message as JSON.
            // This is a backstop for text the event stream did not carry, not the
            // completion signal — the turn ends on `session.status` idle.
            let payload: unknown = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
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
          postDone = true;
          if (turnStarted) {
            // Our transport gave up, the server did not. undici abandons a fetch
            // whose response headers never arrive, and this POST sends none until
            // the turn is over, so a turn longer than that killed itself here and
            // reported a failure for work that was still running. The event stream
            // carries the turn to its end; idle closes it.
            console.warn(
              `[opencode] prompt POST ended early, continuing on the event stream: ${getErrorMessage(error)}`,
            );
            return;
          }
          onError?.(`Request failed: ${getErrorMessage(error)}`);
          finish();
        });

      timeout = setTimeout(() => {
        // Stop the server-side turn first. Without this the session keeps
        // stepping through its loop after the client hangs up, burning tokens
        // on work whose output nobody receives.
        void this.ensureApiClient()
          .abortSession(sessionId)
          .catch(() => undefined);
        controller.abort();
        onError?.('Turn exceeded the 30 minute watchdog and was stopped.');
        finish();
      }, TURN_WATCHDOG_MS);
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
