import * as vscode from 'vscode';
import {
  getErrorMessage,
  normalizeAgentId,
  AgentRaw,
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

  private async webviewReady(): Promise<void> {
    try {
      await this._opencode.start();
      this._auth.restoreApiKeys();
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
    void this._opencode
      .getAgents()
      .then((agents) => {
        if (Array.isArray(agents) && agents.length)
          this._post({
            type: 'agentList',
            payload: {
              agents: agents.map((agent) => normalizeAgentId(agent as AgentRaw).toLowerCase()).filter(Boolean),
            },
          });
      })
      .catch(() => undefined);
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

  private async getSavedModel(): Promise<void> {
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

  private loadSkills(): void {
    this._post({ type: 'skillList', payload: { skills: this._skills.list() } });
  }
  private async runCommand(payload: { command: string; args?: string; isSkill?: boolean }): Promise<void> {
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
      if (content) await this._chat.processPrompt(payload.args ? `${content}\n\n${payload.args}` : content, 'build');
      else this._post({ type: 'error', payload: { message: `Skill "${payload.command}" not found` } });
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
