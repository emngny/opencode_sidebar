import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { OpencodeCli } from '../services/OpencodeCli';
import { getNonce } from '../utils';
import { ExtensionToWebviewMessage, WEBVIEW_TO_EXTENSION_TYPES } from '../types';
import { getGitInfo } from '../services/GitInfo';
import { SessionService } from '../services/SessionService';
import { PermissionService } from '../services/PermissionService';
import { AuthService } from '../services/AuthService';

/**
 * VS Code Sidebar provider for the opencode webview.
 * Implements WebviewViewProvider to render the chat UI and handle message dispatch.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode.sidebar';
  private _view?: vscode.WebviewView;
  private readonly _opencode: OpencodeCli;
  private readonly _sessions: SessionService;
  private readonly _permissions: PermissionService;
  private readonly _auth: AuthService;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._opencode = new OpencodeCli(workspaceFolder);
    this._sessions = new SessionService(this._opencode);
    this._permissions = new PermissionService();
    this._auth = new AuthService(this._opencode, _context);
  }

  /**
   * Called when the webview view is first resolved.
   * Sets up webview options, HTML content, and initializes the opencode server.
   * @param webviewView - The webview view to resolve
   * @param _context - Resolve context (unused)
   * @param _token - Cancellation token (unused)
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      const msgType = data?.type;
      if (!data || typeof data !== 'object' || typeof msgType !== 'string' || !(WEBVIEW_TO_EXTENSION_TYPES as readonly string[]).includes(msgType)) {
        console.warn('[opencode] Ignored message with unknown type:', msgType);
        return;
      }

      const payload = data.payload;
      if (!this.validatePayload(msgType, payload)) {
        console.warn('[opencode] Invalid payload for:', msgType);
        return;
      }

      switch (data.type) {
        case 'searchFiles':
          await this._handleSearchFiles(data.payload);
          break;
        case 'getSavedModel':
          await this._handleGetSavedModel();
          break;
        case 'saveModel':
          await this._handleSaveModel(data.payload);
          break;
        case 'revertMessage':
          await this._handleRevertMessage(data.payload);
          break;
        case 'unrevert':
          await this._handleUnrevert();
          break;
        case 'respondPermission':
          await this._handleRespondPermission(data.payload);
          break;
        case 'respondReadPermission':
          await this._handleRespondReadPermission(data.payload);
          break;
        case 'loadSkills':
          this._handleLoadSkills();
          break;
        case 'runCommand':
          await this._handleRunCommand(data.payload);
          break;
        case 'webviewReady':
          await this._handleWebviewReady();
          break;
        case 'sendMessage':
          await this._handleSendMessage(data.payload);
          break;
        case 'openDiff':
          await this._handleOpenDiff(data.payload);
          break;
        case 'clearChat':
        case 'abort':
          this._sessions.abort();
          break;
        case 'listProviders':
          await this._handleListProviders();
          break;
        case 'setApiKey':
          await this._handleSetApiKey(data.payload);
          break;
        case 'removeApiKey':
          await this._handleRemoveApiKey(data.payload);
          break;
        case 'getSessions':
          await this._handleGetSessions();
          break;
        case 'loadSession':
          await this._handleLoadSession(data.payload);
          break;
        case 'deleteSession':
          await this._handleDeleteSession(data.payload);
          break;
        case 'switchAgent':
          // Agent switch handled client-side in webview (mode change)
          // Could extend to track agent usage or persist preference
          break;
      }
    });
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private async _handleWebviewReady(): Promise<void> {
    try {
      await this._opencode.start();
      this._auth.restoreApiKeys();
      const [project, pathInfo, vcsInfo] = await Promise.all([
        this._opencode.getCurrentProject(),
        this._opencode.getPath(),
        this._opencode.getVcsInfo(),
      ]);
      this.postMessage({
        type: 'projectInfo',
        payload: { project, path: pathInfo, vcs: vcsInfo },
      });
      await this._handleListProviders();
      this._handleLoadSkills();
      // Load agents from server
      this._opencode.getAgents().then(agents => {
        if (Array.isArray(agents) && agents.length > 0) {
          const normalized = agents
            .map((a: any) => {
              if (typeof a === 'string') return a.toLowerCase();
              const id = a.id || a.name || a.slug || a.key || '';
              return String(id).toLowerCase();
            })
            .filter(Boolean);
          this._view?.webview.postMessage({ type: 'agentList', payload: { agents: normalized } });
        }
      }).catch(() => {
        // Silently fail — webview has hardcoded fallback
      });
    } catch (err: any) {
      console.warn('[opencode] Project info fetch failed, using git info:', err);
      const gitInfo = getGitInfo();
      this.postMessage({ type: 'gitInfo', payload: gitInfo });
      await this._handleListProviders();
      this._handleLoadSkills();
    }
  }

  private async _handleSearchFiles(payload: any): Promise<void> {
    const { query } = payload || {};
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        this.postMessage({ type: 'fileSearchResults', payload: { query, files: [] } });
        return;
      }
      const pattern = query ? `**/*${query}*` : '**/*';
      const results = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 30);
      const root = workspaceFolders[0].uri.fsPath;
      const files = results
        .map((uri) => {
          const relative = uri.fsPath.slice(root.length + 1).replaceAll('\\', '/');
          return { name: relative.split('/').pop() || '', path: relative };
        })
        .filter((f) => !query || f.path.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 20);
      this.postMessage({ type: 'fileSearchResults', payload: { query, files } });
    } catch (err: any) {
      console.error('[opencode] File search error:', err.message);
      this.postMessage({ type: 'fileSearchResults', payload: { query, files: [] } });
    }
  }

  private async _handleGetSavedModel(): Promise<void> {
    const savedModel = this._context.workspaceState.get<string>('selectedModel');
    if (savedModel) {
      this.postMessage({ type: 'savedModel', payload: savedModel });
    }
  }

  private async _handleSaveModel(payload: any): Promise<void> {
    const { model } = payload;
    await this._context.workspaceState.update('selectedModel', model);
  }

  private async _handleRevertMessage(payload: any): Promise<void> {
    const { messageId } = payload || {};
    try {
      const { result, messages } = await this._sessions.revert(messageId);
      this.postMessage({ type: 'revertResult', payload: { result, messages, reverted: true } });
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Revert failed: ${err.message}` } });
    }
  }

  private async _handleUnrevert(): Promise<void> {
    try {
      const { result, messages } = await this._sessions.unrevert();
      this.postMessage({ type: 'revertResult', payload: { result, messages, reverted: false } });
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Unrevert failed: ${err.message}` } });
    }
  }

  private async _handleRespondPermission(payload: any): Promise<void> {
    const { permId, permSessionId, response, remember } = payload;
    try {
      const success = await this._opencode.respondPermission(permSessionId, permId, response, remember);
      if (success) {
        this.postMessage({ type: 'toolEvent', payload: { id: permId, type: 'permission', name: 'permission', status: 'completed', content: `Permission ${response}`, meta: { permId, permSessionId, response } } });
      } else {
        this.postMessage({ type: 'error', payload: { message: `Failed to respond to permission request${permId ? ' (' + permId + ')' : ''}` } });
      }
    } catch (err: any) {
      console.error('[opencode] Failed to respond permission:', err.message);
      this.postMessage({ type: 'error', payload: { message: `Permission response failed: ${err.message}` } });
    }
  }

  private async _handleRespondReadPermission(payload: any): Promise<void> {
    const { filePath, response, remember } = payload;
    this._permissions.grantReadPermission(filePath, response, remember);
  }

  private _handleLoadSkills(): void {
    const skills = this._loadSkills();
    this.postMessage({ type: 'skillList', payload: { skills } });
  }

  private async _handleRunCommand(payload: any): Promise<void> {
    const { command, args, isSkill } = payload;
    if (command === 'init') {
      this._handleInitCommand();
      this.postMessage({ type: 'receiveMessage', payload: { role: 'system', content: '✅ AGENTS.md created in workspace root. You can now customize it for your project.' } });
    } else if (command === 'review') {
      this._handleReviewCommand(args || '');
    } else if (isSkill) {
      const skillContent = this._loadSkillContent(command);
      if (skillContent) {
        const prompt = args ? `${skillContent}\n\n${args}` : skillContent;
        this._processPrompt(prompt, 'build');
      } else {
        this.postMessage({ type: 'error', payload: { message: `Skill "${command}" not found` } });
      }
    }
  }

  private async _handleSendMessage(payload: any): Promise<void> {
    const { prompt, model, mode, context } = payload;
    const agent = mode;

    const { userContent, extraParts } = await this._processContext(prompt, context);

    this.postMessage({ type: 'receiveMessage', payload: { role: 'user', content: userContent } });

    try {
      await this._ensureOpencodeRunning();
      const sessionId = await this._sessions.ensureSession(prompt);
      await this._handleStreaming(sessionId, prompt, model, agent, extraParts);
    } catch (err: any) {
      const msg = err?.message || err?.toString?.() || 'Unknown error';
      this.postMessage({ type: 'error', payload: { message: msg } });
      this.postMessage({ type: 'streamEnd', payload: { content: '' } });
    }
  }

  private async _processContext(prompt: string, context: any): Promise<{
    userContent: string;
    extraParts: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  }> {
    let userContent = prompt;
    const extraParts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

    if (!context || !Array.isArray(context)) {
      return { userContent, extraParts };
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return { userContent, extraParts };
    }

    for (const item of context) {
      if (item.type !== 'file') continue;

      const filePath = item.path;
      const { allowed, deniedPattern } = this._permissions.isReadAllowed(filePath);
      if (!allowed && deniedPattern) {
        const reqId = `${filePath}_${Date.now()}`;
        this.postMessage({
          type: 'readFilePrompt',
          payload: { filePath, reason: `Matches deny pattern: ${deniedPattern}`, requestId: reqId },
        });
        const userAllowed = await this._permissions.waitForReadPermission(filePath);
        if (!userAllowed) {
          userContent += `\n\n[Skipped: ${filePath} — read denied by pattern]`;
          this.postMessage({
            type: 'toolEvent',
            payload: { id: `file_read_${filePath}`, type: 'file_read', name: 'read', status: 'failed', content: `Read denied: ${filePath}`, meta: { path: filePath, error: 'Permission denied' } },
          });
          continue;
        }
      }

      const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
      try {
        const content = await vscode.workspace.fs.readFile(fileUri);
        const text = new TextDecoder().decode(content);
        extraParts.push({ type: 'text', text: `File: ${filePath}\n\n${text}\n` });
        this.postMessage({
          type: 'toolEvent',
          payload: { id: `file_read_${filePath}`, type: 'file_read', name: 'read', status: 'completed', content: `Read: ${filePath}`, meta: { path: filePath } },
        });
      } catch (e: unknown) {
        console.error(`Failed to read file ${filePath}:`, e);
        userContent += `\n\n[File not found: ${filePath}]`;
      }
    }

    return { userContent, extraParts };
  }

  private async _ensureOpencodeRunning(): Promise<void> {
    if (!this._opencode.isRunning) {
      await this._opencode.start();
    }
  }

  private async _handleStreaming(
    sessionId: string,
    prompt: string,
    model: string,
    agent: string,
    extraParts?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  ): Promise<void> {
    this.postMessage({ type: 'receiveMessage', payload: { role: 'assistant', content: '' } });

    let accumulatedContent = '';
    let eventDiffs: Array<{ path: string; added: number; deleted: number; content: string }> = [];

    await this._opencode.sendPrompt(sessionId, prompt, {
      onContent: (text) => {
        accumulatedContent += text;
        this.postMessage({ type: 'receiveChunk', payload: { content: text, fullContent: accumulatedContent } });
      },
      onToolCall: (name, _args) => {
        this.postMessage({ type: 'receiveMessage', payload: { role: 'tool', content: `🔧 ${name} running...` } });
      },
      onError: (error) => {
        this.postMessage({ type: 'error', payload: { message: error } });
      },
      model,
      agent,
      extraParts: extraParts && extraParts.length > 0 ? extraParts : undefined,
      onToolEvent: (event) => { this.postMessage({ type: 'toolEvent', payload: event }); },
      onMessageMeta: (meta) => { this.postMessage({ type: 'messageMeta', payload: meta }); },
      onReasoning: (reasoning) => { this.postMessage({ type: 'reasoningContent', payload: reasoning }); },
      onDiffs: (diffs) => { eventDiffs = diffs; },
    });

    this.postMessage({ type: 'streamEnd', payload: { content: accumulatedContent } });
    await this._handleDiffs(sessionId, eventDiffs);
  }

  private async _handleDiffs(sessionId: string, eventDiffs: Array<{ path: string; added: number; deleted: number; content: string }>): Promise<void> {
    const diffs = eventDiffs.length > 0 ? eventDiffs : await this._opencode.getSessionDiff(sessionId);
    if (!Array.isArray(diffs) || diffs.length === 0) return;

    for (const diff of diffs) {
      if (diff.path && (diff.added > 0 || diff.deleted > 0)) {
        this.postMessage({
          type: 'toolEvent',
          payload: {
            id: `file_edit_${diff.path}_${Date.now()}`,
            type: 'file_edit',
            name: 'file_edit',
            status: 'completed',
            content: diff.path,
            meta: { path: diff.path, added: diff.added, deleted: diff.deleted, content: diff.content },
          },
        });
      }
    }
  }

  private async _handleOpenDiff(payload: any): Promise<void> {
    const { filePath } = payload;
    if (filePath && vscode.workspace.workspaceFolders) {
      try {
        const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filePath);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      } catch (e: any) {
        console.error('[opencode] Open diff error:', e.message);
      }
    }
  }

  private async _handleListProviders(): Promise<void> {
    try {
      const result = await this._opencode.listProviders();
      this.postMessage({ type: 'providerList', payload: result });
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Failed to list providers: ${err.message}` } });
    }
  }

  private async _handleSetApiKey(payload: any): Promise<void> {
    const { providerId, key } = payload;
    try {
      const success = await this._auth.setApiKey(providerId, key);
      if (success) {
        const result = await this._opencode.listProviders();
        this.postMessage({ type: 'providerUpdated', payload: { providerId, success: true } });
        this.postMessage({ type: 'providerList', payload: result });
      } else {
        this.postMessage({ type: 'providerUpdated', payload: { providerId, success: false, error: 'Failed to save API key' } });
      }
    } catch (err: any) {
      this.postMessage({ type: 'providerUpdated', payload: { providerId, success: false, error: err.message } });
    }
  }

  private async _handleRemoveApiKey(payload: any): Promise<void> {
    const { providerId } = payload;
    try {
      await this._auth.removeApiKey(providerId);
      const result = await this._opencode.listProviders();
      this.postMessage({ type: 'providerUpdated', payload: { providerId, success: true, removed: true } });
      this.postMessage({ type: 'providerList', payload: result });
    } catch (err: any) {
      this.postMessage({ type: 'providerUpdated', payload: { providerId, success: false, error: err.message } });
    }
  }

  private async _handleGetSessions(): Promise<void> {
    try {
      const sessions = await this._sessions.listSessions();
      this.postMessage({ type: 'sessionList', payload: sessions });
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Failed to list sessions: ${err.message}` } });
    }
  }

  private async _handleLoadSession(payload: any): Promise<void> {
    const { sessionId } = payload;
    try {
      const messages = await this._sessions.loadSession(sessionId);
      this.postMessage({ type: 'sessionLoaded', payload: { sessionId, messages } });
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Failed to load session: ${err.message}` } });
    }
  }

  private async _handleDeleteSession(payload: any): Promise<void> {
    const { sessionId } = payload;
    try {
      await this._sessions.deleteSession(sessionId);
      this.postMessage({ type: 'sessionDeleted', payload: { sessionId } });
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Failed to delete session: ${err.message}` } });
    }
  }

  private validatePayload(type: string, payload: any): boolean {
      if (!payload && type !== 'clearChat' && type !== 'unrevert' && type !== 'getSavedModel' && type !== 'loadSkills' && type !== 'webviewReady' && type !== 'listProviders' && type !== 'abort' && type !== 'getSessions') {
      return false;
    }
    switch (type) {
      case 'searchFiles':
        return typeof payload?.query === 'string';
      case 'revertMessage':
        return typeof payload?.messageId === 'string';
      case 'saveModel':
        return typeof payload?.model === 'string';
      case 'respondPermission':
        return typeof payload?.permId === 'string' && typeof payload?.response === 'string';
      case 'respondReadPermission':
        return typeof payload?.filePath === 'string' && typeof payload?.response === 'string';
      case 'runCommand':
        return typeof payload?.command === 'string';
      case 'setApiKey':
        return typeof payload?.providerId === 'string' && typeof payload?.key === 'string';
      case 'removeApiKey':
        return typeof payload?.providerId === 'string';
      case 'openDiff':
        return typeof payload?.filePath === 'string';
      case 'loadSession':
      case 'deleteSession':
        return typeof payload?.sessionId === 'string';
      default:
        return true;
    }
  }

  dispose() {
    this._opencode.stop();
    this._view = undefined;
  }

  private _loadSkills(): Array<{ name: string; description?: string }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];
    const skillsDir = path.join(workspaceFolders[0].uri.fsPath, '.agents', 'skills');
    if (!existsSync(skillsDir)) return [];
    try {
      const dirs = readdirSync(skillsDir, { withFileTypes: true });
      const result: Array<{ name: string; description?: string }> = [];
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillMdPath)) {
          const content = readFileSync(skillMdPath, 'utf-8');
          const lines = content.split('\n');
          const descLine = lines.find((l) => l.startsWith('# ') || l.startsWith('## ')) || lines[0];
          const description = descLine.replace(/^#+ /, '').trim();
          result.push({ name: entry.name, description });
        }
      }
      return result;
    } catch (err) {
      console.warn('[opencode] Load skills failed:', err);
      return [];
    }
  }

  private _loadSkillContent(name: string): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;
    const skillMdPath = path.join(workspaceFolders[0].uri.fsPath, '.agents', 'skills', name, 'SKILL.md');
    if (!existsSync(skillMdPath)) return null;
    try {
      return readFileSync(skillMdPath, 'utf-8');
    } catch (err) {
      console.warn('[opencode] Load skill content failed:', err);
      return null;
    }
  }

  private async _handleInitCommand(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;
    const root = workspaceFolders[0].uri.fsPath;
    const agentsMdPath = path.join(root, 'AGENTS.md');
    if (existsSync(agentsMdPath)) {
      this.postMessage({ type: 'receiveMessage', payload: { role: 'system', content: '⚠️ AGENTS.md already exists. Skipping creation.' } });
      return;
    }
    const content = `# Project Guide for Opencode AI

## Project Overview
- **What does this project do?**
-

## Conventions
- **Language/Framework:**
- **Testing:**
- **Code style:**

## Commands
- **Build:**
- **Test:**
- **Lint:**

## Key Files
- **Entry point:**
- **Configuration:`

    try {
      writeFileSync(agentsMdPath, content, 'utf-8');
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Failed to create AGENTS.md: ${err.message}` } });
    }
  }

  private async _handleReviewCommand(args: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;
    const root = workspaceFolders[0].uri.fsPath;

    const allowedFlags = new Set(['--no-index', '-U', '--unified', '--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--check', '--color', '--color-words']);
    const safeArgs: string[] = [];
    if (args) {
      const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
      const parsed: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(args)) !== null) {
        parsed.push(m[1] || m[2] || m[0]);
      }
      for (const arg of parsed) {
        if (arg.startsWith('--') && !allowedFlags.has(arg)) continue;
        if (/^-.[^-]/.test(arg) && !/^-U\d+$/.test(arg)) continue;
        if (arg.includes(';') || arg.includes('|') || arg.includes('&&') || arg.includes('||')) continue;
        safeArgs.push(arg);
      }
    }

    try {
      const diff = execFileSync('git', ['diff', '--cached', ...safeArgs], { cwd: root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      const prompt = `Review the following uncommitted changes:\n\n${diff.slice(0, 10000)}${diff.length > 10000 ? '\n...(truncated)' : ''}\n\nProvide a concise code review focusing on potential bugs, security issues, and improvements.`;
      this._processPrompt(prompt, 'review');
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Review failed: ${err.message}` } });
    }
  }

  private async _processPrompt(prompt: string, mode: string, context?: any): Promise<void> {
    const sessionId = this._sessions.currentSessionId || (await this._opencode.createSession(`Review - ${prompt.slice(0, 50)}...`)).id;
    if (!this._sessions.currentSessionId) this._sessions.currentSessionId = sessionId;

    this.postMessage({
      type: 'receiveMessage',
      payload: { role: 'user', content: prompt },
    });
    this.postMessage({ type: 'receiveMessage', payload: { role: 'assistant', content: '' } });

    const agent = mode;
    let accumulatedContent = '';

    await this._opencode.sendPrompt(sessionId, prompt, {
      onContent: (chunk) => {
        accumulatedContent += chunk;
        this.postMessage({ type: 'receiveChunk', payload: { content: chunk, fullContent: accumulatedContent } });
      },
      onToolCall: () => {},
      onError: (error) => {
        this.postMessage({ type: 'error', payload: { message: error } });
      },
      agent,
      extraParts: [],
      onToolEvent: (event) => { this.postMessage({ type: 'toolEvent', payload: event }); },
      onMessageMeta: (meta) => { this.postMessage({ type: 'messageMeta', payload: meta }); },
      onReasoning: (reasoning) => { this.postMessage({ type: 'reasoningContent', payload: reasoning }); },
      onDiffs: () => {},
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'),
    );
    const styleNonce = getNonce();
    const scriptNonce = getNonce();
    const serverPort = this._opencode.url ? new URL(this._opencode.url).port : '*';

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'self'; img-src ${webview.cspSource} data:; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${styleNonce}'; connect-src ${webview.cspSource}${serverPort ? ` http://127.0.0.1:${serverPort} http://localhost:${serverPort}` : ''}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Opencode</title>
        <style nonce="${styleNonce}">
          body { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; background-color: #1e1e2e; color: #cdd6f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
          #root { width: 100%; height: 100%; display: flex; flex-direction: column; }
          @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
          @keyframes blink { 50% { opacity: 0; } }
          @keyframes thinking {
            0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
            40% { opacity: 1; transform: scale(1); }
          }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
          }
          :focus-visible { outline: 2px solid #89b4fa; outline-offset: 2px; }
          button:focus-visible, a:focus-visible, [role="button"]:focus-visible { outline: 2px solid #89b4fa; outline-offset: 2px; }
          .opencode-markdown h1,.opencode-markdown h2,.opencode-markdown h3,
          .opencode-markdown h4,.opencode-markdown h5,.opencode-markdown h6 {
            margin: 12px 0 6px; font-weight: 600; color: #cdd6f4;
          }
          .opencode-markdown h1 { font-size: 18px; }
          .opencode-markdown h2 { font-size: 16px; }
          .opencode-markdown h3 { font-size: 14px; }
          .opencode-markdown h4 { font-size: 13px; }
          .opencode-markdown p { margin: 4px 0; }
          .opencode-markdown ul, .opencode-markdown ol { margin: 4px 0; padding-left: 20px; }
          .opencode-markdown li { margin: 2px 0; }
          .opencode-markdown blockquote {
            margin: 6px 0; padding: 4px 12px;
            border-left: 3px solid #7c3aed; color: #a6adc8;
            background: rgba(124,58,237,0.05); border-radius: 0 4px 4px 0;
          }
          .opencode-markdown code {
            font-family: 'Cascadia Code','Fira Code','Consolas',monospace; font-size: 12px;
            background: #313244; padding: 1px 5px; border-radius: 4px; color: #f5c2e7;
          }
          .opencode-markdown pre {
            margin: 8px 0; padding: 12px 14px; padding-top: 32px; background: #11111b;
            border-radius: 10px; border: 1px solid #313244;
            overflow-x: auto; position: relative;
          }
          .opencode-markdown pre code {
            background: none; padding: 0; color: #cdd6f4; font-size: 12px; line-height: 1.5;
          }
          .opencode-markdown a { color: #89b4fa; text-decoration: none; }
          .opencode-markdown a:hover { text-decoration: underline; }
          .opencode-markdown table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px; }
          .opencode-markdown th,.opencode-markdown td {
            border: 1px solid #45475a; padding: 6px 10px; text-align: left;
          }
          .opencode-markdown th { background: #313244; font-weight: 600; }
          .opencode-markdown tr:nth-child(even) { background: rgba(49,50,68,0.3); }
          .opencode-markdown img { max-width: 100%; border-radius: 8px; margin: 8px 0; }
          .opencode-markdown hr { border: none; border-top: 1px solid #45475a; margin: 12px 0; }
          .opencode-markdown .copy-btn {
            position: absolute; top: 6px; right: 6px; padding: 3px 8px; font-size: 11px;
            border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #a6adc8;
            cursor: pointer; opacity: 0; transition: opacity 0.15s; z-index: 1;
          }
          .opencode-markdown pre:hover .copy-btn { opacity: 1; }
          .opencode-markdown .copy-btn:hover { background: #45475a; color: #cdd6f4; }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${scriptNonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
