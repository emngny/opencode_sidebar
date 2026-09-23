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
import { ExtensionToWebviewMessage, WebviewToExtensionMessage, isRecord } from '../../shared/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode.sidebar';
  private _view?: vscode.WebviewView;
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
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    const serverUrl = this._opencode.url || undefined;
    webviewView.webview.html = new WebviewHtmlBuilder(this._extensionUri, () => serverUrl).build(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (data: unknown) => {
      if (!this.validateMessage(data)) return;
      await this._handler.dispatch(data);
    });
  }

  /** Sends an extension event to the webview when a view is attached. */
  postMessage(message: ExtensionToWebviewMessage): void {
    void this._view?.webview.postMessage(message);
  }

  /** Narrows untrusted webview data to a supported message envelope. */
  private validateMessage(data: unknown): data is WebviewToExtensionMessage {
    if (!isRecord(data) || typeof data['type'] !== 'string' || !this.validatePayload(data['type'], data['payload']))
      return false;
    return true;
  }

  /** Validates required payload field types for each webview command. */
  validatePayload(type: string, payload: unknown): boolean {
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
    if (type === 'runCommand') return hasStrings('command');
    if (type === 'revertMessage') return hasStrings('messageId');
    if (type === 'saveModel') return hasStrings('model');
    if (type === 'respondPermission') return hasStrings('permId', 'response');
    if (type === 'respondReadPermission') return hasStrings('filePath', 'response');
    if (type === 'setApiKey') return hasStrings('providerId', 'key');
    if (type === 'removeApiKey' || type === 'loadSession' || type === 'deleteSession')
      return hasStrings(type === 'removeApiKey' ? 'providerId' : 'sessionId');
    if (type === 'sendMessage') return hasStrings('prompt');
    if (type === 'switchAgent') return hasStrings('agent');
    return true;
  }

  /** Aborts active work, stops the local server, and releases the view. */
  dispose(): void {
    void this._sessions.abort().catch(() => undefined);
    this._opencode.stop();
    this._view = undefined;
  }
}
