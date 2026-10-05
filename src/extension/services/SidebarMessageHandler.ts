import * as vscode from 'vscode';
import {
  getErrorMessage,
  filterChatModeAgents,
  type ContextPart,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
} from '../../shared/types';
import type { AuthService } from './AuthService';
import type { ChatCoordinator } from './ChatCoordinator';
import type { GitService } from './GitService';
import type { OpencodeCli } from './OpencodeCli';
import type { PermissionService } from './PermissionService';
import type { SessionService } from './SessionService';
import type { SkillService } from './SkillService';
import { questionEventFromRequest } from './EventDispatcher';
import { ServerStartupAbortedError } from './ServerProcessManager';
import { getGitInfo } from './GitInfo';
import { resolveWorkspacePath } from '../utils/workspacePath';

export class SidebarMessageHandler {
  constructor(
    private readonly _opencode: OpencodeCli,
    private readonly _sessions: SessionService,
    private readonly _permissions: PermissionService,
    private readonly _auth: AuthService,
    private readonly _skills: SkillService,
    private readonly _chat: ChatCoordinator,
    private readonly _workspaceState: vscode.Memento,
    private readonly _post: (message: ExtensionToWebviewMessage) => void,
    private readonly _git: GitService,
  ) {}

  async dispatch(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'searchFiles':
        return this.searchFiles(message.payload.query, message.payload.requestId);
      case 'getSavedModel':
        return this.getSavedModel();
      case 'saveModel':
        return this.saveModel(message.payload.model);
      case 'revertMessage':
        return this.revertMessage(message.payload.messageId);
      case 'unrevert':
        return this.unrevert();
      case 'respondPermission':
        return this.respondPermission(message.payload);
      case 'respondQuestion':
        return this.respondQuestion(message.payload);
      case 'respondReadPermission':
        this._permissions.grantReadPermission(
          message.payload.filePath,
          message.payload.response === 'allow' ? 'allow' : 'deny',
          message.payload.remember,
        );
        return;
      case 'loadSkills':
        this.loadSkills();
        return;
      case 'runCommand':
        return this.runCommand(message.payload);
      case 'webviewReady':
        return this.webviewReady();
      case 'sendMessage':
        return this.sendMessage(message.payload);
      case 'openDiff':
        return this.openDiff(message.payload.filePath);
      case 'openExternal':
        return this.openExternal(message.payload.url);
      case 'listProviders':
        return this.listProviders();
      case 'setApiKey':
        return this.setApiKey(message.payload);
      case 'removeApiKey':
        return this.removeApiKey(message.payload.providerId);
      case 'getSessions':
        return this.listSessions();
      case 'loadSession':
        return this.loadSession(message.payload.sessionId);
      case 'deleteSession':
        return this.deleteSession(message.payload.sessionId);
      case 'clearChat':
        return this.clearChat();
      case 'abort':
        return this.abortSession();
      default:
        return;
    }
  }

  private async abortSession(): Promise<void> {
    try {
      await this._sessions.abort();
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Abort failed: ${getErrorMessage(error)}` } });
    }
  }

  private async clearChat(): Promise<void> {
    try {
      await this._sessions.abort();
      // Unlike abort, clearChat starts a new conversation: drop the identity
      // so the next prompt opens a fresh session instead of reusing this one.
      this._sessions.currentSessionId = null;
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Abort failed: ${getErrorMessage(error)}` } });
    }
  }

  private async webviewReady(): Promise<void> {
    try {
      await this._opencode.start();
      void this._auth.restoreApiKeys();
      const [project, path, vcs] = await Promise.all([
        this._opencode.getCurrentProject(),
        this._opencode.getPath(),
        this._opencode.getVcsInfo(),
      ]);
      this._post({ type: 'projectInfo', payload: { project, path, vcs } });
    } catch {
      this._post({ type: 'gitInfo', payload: getGitInfo() });
    }
    await this.listProviders();
    this.loadSkills();
    this.loadCommands();
    void this._opencode
      .getAgents()
      .then((agents) => {
        // Only session-owning agents are offered as modes. Subagent-only entries
        // (and opencode's internal agents) belong to the task tool, not the chat
        // mode picker, and they can pin a model that overrides the picker.
        const modes = filterChatModeAgents(agents);
        if (modes.length)
          this._post({
            type: 'agentList',
            payload: {
              agents: modes.map((agent) => agent.id),
              // Agents that pin a model size the picker, so the webview can show
              // what the server will really run when one of them is selected.
              agentModels: Object.fromEntries(
                modes.filter((agent) => agent.model).map((agent) => [agent.id, agent.model as string]),
              ),
            },
          });
      })
      .catch(() => undefined);
    await this.rehydrateTranscript();
  }

  /**
   * Rebuilds the transcript for a freshly mounted webview.
   *
   * VS Code deallocates the webview document while the view is hidden and
   * recreates it on the next show, so the React app remounts with an empty
   * `messages` array even though the session is still live in the extension
   * host and on the server. Without this the chat looks like a fresh session
   * even though the next prompt continues the existing one.
   */
  private async rehydrateTranscript(): Promise<void> {
    const sessionId = this._sessions.currentSessionId;
    if (!sessionId) return;
    try {
      const activeRequestId = this._opencode.getActiveRequestId(sessionId);
      const messages = await this._sessions.loadSession(sessionId, activeRequestId);
      this._post({
        type: 'sessionLoaded',
        payload: { sessionId, messages, busy: activeRequestId !== null, activeRequestId },
      });
      // Replay after the transcript: the prompt is a tool event the fresh
      // webview has never seen, and without it the server stays blocked on a
      // decision the user cannot make.
      const pending = this._opencode.getPendingPermission(sessionId);
      if (pending) this._post({ type: 'toolEvent', payload: { ...pending, requestId: activeRequestId ?? undefined } });
      // A question is the same shape of deadlock: the tool blocks the server
      // until an answer arrives, and the request itself only ever arrives as a
      // live event. It is rebuilt from the server's own pending list rather
      // than held, because that also survives several questions in a row.
      void this._opencode
        .listQuestions()
        .then((requests) => {
          for (const request of requests) {
            if (request.sessionID !== sessionId) continue;
            const event = questionEventFromRequest(request);
            if (!event) continue;
            this._post({
              type: 'toolEvent',
              payload: { ...event, requestId: activeRequestId ?? undefined, sessionId },
            });
          }
        })
        .catch((error: unknown) => {
          console.warn('[opencode] Failed to restore pending questions:', getErrorMessage(error));
        });
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Failed to restore session: ${getErrorMessage(error)}` } });
    }
  }

  private async searchFiles(query: string, requestId?: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return this._post({ type: 'fileSearchResults', payload: { query, requestId, files: [] } });
    try {
      const results = await vscode.workspace.findFiles(query ? `**/*${query}*` : '**/*', '**/node_modules/**', 30);
      const files = results
        .map((uri) => {
          const path = uri.fsPath.slice(folder.uri.fsPath.length + 1).replaceAll('\\', '/');
          return { name: path.split('/').pop() || '', path };
        })
        .filter((file) => !query || file.path.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 20);
      this._post({ type: 'fileSearchResults', payload: { query, requestId, files } });
    } catch (error) {
      console.error('[opencode] File search error:', getErrorMessage(error));
      this._post({ type: 'fileSearchResults', payload: { query, requestId, files: [] } });
    }
  }

  private getSavedModel(): void {
    const model = this._workspaceState.get<string>('selectedModel');
    if (model) this._post({ type: 'savedModel', payload: model });
  }
  private async saveModel(model: string): Promise<void> {
    await this._workspaceState.update('selectedModel', model);
  }
  private async revertMessage(messageId: string): Promise<void> {
    try {
      const result = await this._sessions.revert(messageId);
      this._post({ type: 'revertResult', payload: { ...result, reverted: true } });
    } catch (error) {
      this._post({
        type: 'error',
        payload: {
          message: `Revert failed: ${getErrorMessage(error)}`,
          sessionId: this._sessions.currentSessionId ?? undefined,
        },
      });
    }
  }
  private async unrevert(): Promise<void> {
    try {
      const result = await this._sessions.unrevert();
      this._post({ type: 'revertResult', payload: { ...result, reverted: false } });
    } catch (error) {
      this._post({
        type: 'error',
        payload: {
          message: `Unrevert failed: ${getErrorMessage(error)}`,
          sessionId: this._sessions.currentSessionId ?? undefined,
        },
      });
    }
  }
  private async respondPermission(payload: {
    permId: string;
    permSessionId: string;
    response: string;
    remember?: boolean;
  }): Promise<void> {
    try {
      const success = await this._opencode.respondPermission(
        payload.permSessionId,
        payload.permId,
        payload.response,
        payload.remember,
      );
      if (success) {
        // The held copy exists only to survive a hidden webview; once the
        // decision is through, replaying it again would re-prompt the user.
        this._opencode.clearPendingPermission(payload.permSessionId);
        this._post({
          type: 'toolEvent',
          payload: {
            id: payload.permId,
            type: 'permission',
            name: 'permission',
            status: 'completed',
            content: `Permission ${payload.response}`,
            meta: payload,
          },
        });
      } else {
        const suffix = payload.permId ? ` (${payload.permId})` : '';
        this._post({ type: 'error', payload: { message: `Failed to respond to permission request${suffix}` } });
      }
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Permission response failed: ${getErrorMessage(error)}` } });
    }
  }

  private async respondQuestion(payload: { questionId: string; answers?: string[][] }): Promise<void> {
    try {
      const answered = payload.answers !== undefined;
      const success = answered
        ? await this._opencode.replyQuestion(payload.questionId, payload.answers ?? [])
        : await this._opencode.rejectQuestion(payload.questionId);
      if (!success) {
        this._post({ type: 'error', payload: { message: `Failed to answer question (${payload.questionId})` } });
        return;
      }
      // Settles the interactive card. The tool part completes on its own, so
      // no state is held for it — a rejection is reported by the server as a
      // failed `question` call, which arrives as its own card.
      this._post({
        type: 'toolEvent',
        payload: {
          id: payload.questionId,
          type: 'question',
          name: 'question',
          status: 'completed',
          content: answered ? 'Question answered' : 'Question dismissed',
          meta: { questionId: payload.questionId, answers: payload.answers },
        },
      });
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Question response failed: ${getErrorMessage(error)}` } });
    }
  }

  private loadSkills(): void {
    this._post({ type: 'skillList', payload: { skills: this._skills.list() } });
  }

  /**
   * Publishes the server's slash command list to the webview.
   *
   * The local `loadSkills` scan only sees `<workspace>/.agents/skills`, so
   * commands installed in the global skill roots — `brainstorming`,
   * `brainstorm-plan`, and the rest of the server's 528 — never reached the
   * picker. An empty list is a real answer from the server, not a failure, so
   * it is posted too and replaces whatever was shown before.
   */
  private async loadCommands(): Promise<void> {
    try {
      const commands = await this._opencode.getCommands();
      this._post({ type: 'commandList', payload: { commands } });
    } catch (error) {
      console.warn('[opencode] Load commands failed:', getErrorMessage(error));
    }
  }
  private async runCommand(payload: {
    command: string;
    args?: string;
    isSkill?: boolean;
    isCommand?: boolean;
    agent?: string;
    model?: string;
    mode?: string;
  }): Promise<void> {
    if (payload.command === 'init') {
      try {
        const result = this._skills.createAgentsFile();
        if (result.status === 'error') {
          this._post({ type: 'error', payload: { message: `Failed to create AGENTS.md: ${result.message}` } });
        } else {
          this._post({
            type: 'receiveMessage',
            payload: {
              role: 'system',
              content:
                result.status === 'exists'
                  ? '⚠️ AGENTS.md already exists. Skipping creation.'
                  : '✅ AGENTS.md created in workspace root. You can now customize it for your project.',
            },
          });
        }
      } finally {
        this._post({ type: 'status', payload: { status: 'idle' } });
      }
    } else if (payload.command === 'review') {
      try {
        await this._git.review(payload.args || '');
      } catch (error) {
        this._post({ type: 'error', payload: { message: `Review failed: ${getErrorMessage(error)}` } });
      }
    } else if (payload.isSkill) {
      const content = this._skills.load(payload.command);
      if (content)
        await this._chat.processPrompt(
          payload.args ? `${content}\n\n${payload.args}` : content,
          payload.mode ?? '',
          undefined,
          payload.model,
        );
      else this._post({ type: 'error', payload: { message: `Skill "${payload.command}" not found` } });
    } else if (payload.isCommand) {
      // The server expands its own commands: a prompt starting with `/name`
      // comes back as `<auto-slash-command>` with the arguments filled in.
      // Substituting a local template instead would miss the server's
      // expansion — and there is no local template for these anyway, since
      // they are installed outside the workspace.
      const line = payload.args ? `/${payload.command} ${payload.args}` : `/${payload.command}`;
      // A command that pins an agent runs under it; the rest inherit the mode
      // the user already picked, so `/brainstorming` does not change the chat.
      //
      // The model travels with the payload because a command turn bypasses
      // `sendMessage`, and without one the server falls back to its default
      // agent — which pins `opencode-go/normal-combo`, absent from the catalog,
      // so the turn failed with `ProviderModelNotFoundError` before it started.
      await this._chat.processPrompt(line, payload.agent ?? payload.mode ?? '', undefined, payload.model);
    }
  }
  private async sendMessage(payload: {
    prompt: string;
    model?: string;
    mode?: string;
    context?: ContextPart[];
  }): Promise<void> {
    if (!this._opencode.isRunning) {
      try {
        await this._opencode.start();
      } catch (error) {
        if (error instanceof ServerStartupAbortedError) return;
        throw error;
      }
    }
    if (!this._sessions.currentSessionId) await this._sessions.ensureSession(payload.prompt);
    await this._chat.processPrompt(payload.prompt, payload.mode ?? '', payload.context, payload.model);
  }
  private async openDiff(filePath: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || !filePath) return;
    const resolved = resolveWorkspacePath(folder.uri.fsPath, filePath);
    if (!resolved.ok) {
      this._post({ type: 'error', payload: { message: 'Access denied: path outside workspace' } });
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved.resolvedPath));
      await vscode.window.showTextDocument(document);
    } catch (error) {
      console.error('[opencode] Open diff error:', getErrorMessage(error));
    }
  }
  private async openExternal(url: string): Promise<void> {
    // The webview is not a trust boundary here — re-parse and re-check the
    // scheme. This is what keeps a forged message away from `file://` and from
    // handlers registered under any other scheme; it is not a network-level
    // filter, so `http://localhost` still passes.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this._post({ type: 'error', payload: { message: 'Blocked link: not a valid URL' } });
      return;
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      this._post({ type: 'error', payload: { message: 'Blocked link: unsupported protocol' } });
      return;
    }
    try {
      await vscode.env.openExternal(vscode.Uri.parse(parsed.toString()));
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Failed to open link: ${getErrorMessage(error)}` } });
    }
  }
  private async listProviders(): Promise<void> {
    try {
      this._post({ type: 'providerList', payload: await this._opencode.listProviders() });
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Failed to list providers: ${getErrorMessage(error)}` } });
    }
  }
  private async setApiKey(payload: { providerId: string; key: string }): Promise<void> {
    try {
      const success = await this._auth.setApiKey(payload.providerId, payload.key);
      if (success) {
        this._post({ type: 'providerUpdated', payload: { providerId: payload.providerId, success: true } });
        await this.listProviders();
      } else
        this._post({
          type: 'providerUpdated',
          payload: { providerId: payload.providerId, success: false, error: 'Failed to save API key' },
        });
    } catch (error) {
      this._post({
        type: 'providerUpdated',
        payload: { providerId: payload.providerId, success: false, error: getErrorMessage(error) },
      });
    }
  }
  private async removeApiKey(providerId: string): Promise<void> {
    try {
      await this._auth.removeApiKey(providerId);
      this._post({ type: 'providerUpdated', payload: { providerId, success: true, removed: true } });
      await this.listProviders();
    } catch (error) {
      this._post({ type: 'providerUpdated', payload: { providerId, success: false, error: getErrorMessage(error) } });
    }
  }
  private async listSessions(): Promise<void> {
    try {
      this._post({ type: 'sessionList', payload: await this._sessions.listSessions() });
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Failed to list sessions: ${getErrorMessage(error)}` } });
    }
  }
  private async loadSession(sessionId: string): Promise<void> {
    try {
      this._post({
        type: 'sessionLoaded',
        payload: { sessionId, messages: await this._sessions.loadSession(sessionId) },
      });
    } catch (error) {
      this._post({ type: 'error', payload: { message: `Failed to load session: ${getErrorMessage(error)}` } });
    }
  }
  private async deleteSession(sessionId: string): Promise<void> {
    try {
      await this._sessions.deleteSession(sessionId);
      this._post({ type: 'sessionDeleted', payload: { sessionId } });
    } catch (error) {
      this._post({
        type: 'error',
        payload: { message: `Failed to delete session: ${getErrorMessage(error)}`, sessionId },
      });
    }
  }
}
