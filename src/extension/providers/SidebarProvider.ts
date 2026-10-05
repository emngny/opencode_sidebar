import * as vscode from 'vscode';
import { OpencodeCli } from '../services/OpencodeCli';
import { SessionService } from '../services/SessionService';
import { PermissionService } from '../services/PermissionService';
import { AuthService } from '../services/AuthService';
import { SkillService } from '../services/SkillService';
import { ContextService } from '../services/ContextService';
import { ChatCoordinator } from '../services/ChatCoordinator';
import { GitService } from '../services/GitService';
import { WebviewHtmlBuilder } from '../services/WebviewHtmlBuilder';
import { SidebarMessageHandler } from '../services/SidebarMessageHandler';
import {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  getErrorMessage,
  isRecord,
  WEBVIEW_TO_EXTENSION_TYPES,
} from '../../shared/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode.sidebar';
  private _view?: vscode.WebviewView;
  private _visible = false;
  private _blockedNotice?: {
    /** Request the notice covers, so repeats of it do not stack notifications. */
    key: string | undefined;
    dispose: vscode.Disposable;
  };
  private readonly _opencode: OpencodeCli;
  private readonly _sessions: SessionService;
  private readonly _handler: SidebarMessageHandler;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ) {
    this._opencode = new OpencodeCli(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    this._sessions = new SessionService(this._opencode);
    const permissions = new PermissionService();
    const auth = new AuthService(this._opencode, context);
    const skills = new SkillService();
    const post = (message: ExtensionToWebviewMessage) => this.postMessage(message);
    const contextService = new ContextService(permissions, post);
    const chat = new ChatCoordinator(this._opencode, this._sessions, post, contextService);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const git = new GitService(root, (prompt, mode) => chat.processPrompt(prompt, mode));
    this._handler = new SidebarMessageHandler(
      this._opencode,
      this._sessions,
      permissions,
      auth,
      skills,
      chat,
      context.workspaceState,
      post,
      git,
    );
  }

  /** Configures webview options, HTML, and validated message dispatch. */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    this._visible = webviewView.visible;
    webviewView.onDidChangeVisibility(() => {
      this._visible = webviewView.visible;
    });
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    const serverUrl = this._opencode.url || undefined;
    webviewView.webview.html = new WebviewHtmlBuilder(this._extensionUri, () => serverUrl).build(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (data: unknown) => {
      if (!this.validateMessage(data)) return;
      try {
        await this._handler.dispatch(data);
      } catch (error) {
        this.postMessage({ type: 'error', payload: { message: getErrorMessage(error) } });
      }
    });
  }

  /** Sends an extension event to the webview when a view is attached. */
  postMessage(message: ExtensionToWebviewMessage): void {
    void this._view?.webview.postMessage(message);
    if (!this._visible && message.type === 'toolEvent') {
      if (message.payload.type === 'permission') {
        this.notifyBlocked(
          `permission:${message.payload.meta?.['permId'] as string | undefined}`,
          'OpenCode needs your permission to continue',
        );
      } else if (message.payload.type === 'question') {
        this.notifyBlocked(
          `question:${message.payload.meta?.['questionId'] as string | undefined}`,
          'OpenCode has questions waiting for your answer',
        );
      }
    }
  }

  /**
   * Surfaces a request the server is blocked on while the view is hidden.
   *
   * VS Code deallocates the webview document when the view is hidden, so a
   * permission or question posted then is dropped and the server waits forever
   * on an answer nobody can make. One notice is kept per request so a tool that
   * re-asks does not stack notifications, and a request that is answered or
   * superseded is disposed.
   */
  private notifyBlocked(key: string | undefined, text: string): void {
    if (this._blockedNotice && this._blockedNotice.key === key) return;
    this._blockedNotice?.dispose.dispose();
    const clear = (): void => {
      if (this._blockedNotice?.key === key) this._blockedNotice = undefined;
    };
    this._blockedNotice = { key, dispose: { dispose: clear } as vscode.Disposable };
    void vscode.window.showInformationMessage(text, 'Show').then((selection) => {
      if (selection === 'Show') {
        void vscode.commands.executeCommand('workbench.view.extension.opencode.focus');
      }
      clear();
    });
  }

  /** Narrows untrusted webview data to a supported message envelope. */
  private validateMessage(data: unknown): data is WebviewToExtensionMessage {
    if (!isRecord(data) || typeof data['type'] !== 'string' || !this.validatePayload(data['type'], data['payload']))
      return false;
    return true;
  }

  /** Validates required payload field types for each webview command. */
  validatePayload(type: string, payload: unknown): boolean {
    if (!(WEBVIEW_TO_EXTENSION_TYPES as readonly string[]).includes(type)) return false;
    const optional = new Set([
      'clearChat',
      'unrevert',
      'getSavedModel',
      'loadSkills',
      'webviewReady',
      'listProviders',
      'abort',
      'getSessions',
    ]);
    if (payload === undefined && optional.has(type)) return true;
    if (!isRecord(payload)) return false;
    const value = payload;
    const hasStrings = (...keys: string[]) => keys.every((key) => typeof value[key] === 'string');
    if (type === 'searchFiles') return hasStrings('query');
    if (type === 'openDiff') return hasStrings('filePath');
    if (type === 'openExternal') return hasStrings('url');
    if (type === 'runCommand') return hasStrings('command');
    if (type === 'revertMessage') return hasStrings('messageId');
    if (type === 'saveModel') return hasStrings('model');
    if (type === 'respondPermission')
      return hasStrings('permId', 'permSessionId') && (value['response'] === 'allow' || value['response'] === 'deny');
    if (type === 'respondQuestion') {
      if (!hasStrings('questionId')) return false;
      const answers = value['answers'];
      if (answers === undefined) return true;
      return (
        Array.isArray(answers) &&
        answers.every((entry) => Array.isArray(entry) && entry.every((label) => typeof label === 'string'))
      );
    }
    if (type === 'respondReadPermission') return hasStrings('filePath', 'response');
    if (type === 'setApiKey') return hasStrings('providerId', 'key');
    if (type === 'removeApiKey' || type === 'loadSession' || type === 'deleteSession')
      return hasStrings(type === 'removeApiKey' ? 'providerId' : 'sessionId');
    if (type === 'sendMessage') {
      if (typeof value['prompt'] !== 'string') return false;
      if (value['context'] === undefined) return true;
      if (!Array.isArray(value['context'])) return false;
      return (
        value['context'].every((item) => {
          if (!isRecord(item)) return false;
          if (item['type'] === 'file') return typeof item['name'] === 'string' && typeof item['path'] === 'string';
          if (item['type'] !== 'image') return false;
          if (
            typeof item['name'] !== 'string' ||
            typeof item['data'] !== 'string' ||
            typeof item['mimeType'] !== 'string'
          ) {
            return false;
          }
          if (!item['mimeType'].startsWith('image/') || item['mimeType'].length === 'image/'.length) return false;
          if (!item['data'] || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item['data'])) {
            return false;
          }
          return item['data'].length <= Math.ceil((10 * 1024 * 1024 * 4) / 3);
        }) && value['context'].filter((item) => isRecord(item) && item['type'] === 'image').length <= 5
      );
    }
    if (type === 'switchAgent') return hasStrings('agent');
    return true;
  }

  /** Aborts active work, stops the local server, and releases the view. */
  dispose(): void {
    this._blockedNotice?.dispose.dispose();
    this._blockedNotice = undefined;
    void this._sessions.abort().catch(() => undefined);
    this._opencode.stop();
    this._view = undefined;
  }
}
