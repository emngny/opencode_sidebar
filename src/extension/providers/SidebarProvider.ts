import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { OpencodeCli } from '../services/OpencodeCli';
import { getNonce } from '../utils';
import { ExtensionToWebviewMessage } from '../types';
import { getGitInfo } from '../services/GitInfo';
import { isReadDenied, READ_DENY_PATTERNS } from '../services/readPatterns';

const MODE_TO_AGENT: Record<string, string> = {
  'Build': 'build',
  'Plan': 'plan',
  'Ask': 'ask',
  'Debug': 'debug',
  'Docs': 'docs',
  'Code': 'code',
  'Review': 'review',
};

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode.sidebar';
  private _view?: vscode.WebviewView;
  private readonly _opencode: OpencodeCli;
  private _currentSessionId: string | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._opencode = new OpencodeCli(workspaceFolder);
  }

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

    // Send project info when webview is ready
    setTimeout(async () => {
      try {
        await this._opencode.start();
        const [project, pathInfo, vcsInfo] = await Promise.all([
          this._opencode.getCurrentProject(),
          this._opencode.getPath(),
          this._opencode.getVcsInfo(),
        ]);
        this.postMessage({
          type: 'projectInfo',
          payload: { project, path: pathInfo, vcs: vcsInfo },
        });
      } catch {
        // Fallback to local git info
        const gitInfo = getGitInfo();
        this.postMessage({ type: 'gitInfo', payload: gitInfo });
      }
    }, 500);

    // Start opencode server in background
    this._opencode.start().then(() => {
      this._restoreApiKeys();
    }).catch((err) => {
      console.error('Opencode server start failed:', err);
      this.postMessage({
        type: 'receiveMessage',
        payload: {
          role: 'system',
          content: `⚠️ Opencode CLI not available: ${err.message}. You can still use the mock mode.`,
        },
      });
    });

    const readAllowCache = new Map<string, string>(); // pattern → filePath
    const pendingReadPermResolvers = new Map<string, (response: { allowed: boolean; remember?: boolean }) => void>();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      const validTypes = ['sendMessage','clearChat','abort','listProviders','setApiKey','removeApiKey','getSessions','loadSession','deleteSession','switchAgent','searchFiles','getSavedModel','saveModel','revertMessage','unrevert','respondPermission','respondReadPermission','openDiff','runCommand','loadSkills'];
      if (!data || typeof data !== 'object' || !validTypes.includes(data.type)) {
        console.warn('[opencode] Ignored message with unknown type:', data?.type);
        return;
      }
      switch (data.type) {
        case 'searchFiles': {
          const { query } = data.payload || {};
          try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
              this.postMessage({ type: 'fileSearchResults', payload: { query, files: [] } });
              break;
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
          break;
        }
        case 'getSavedModel': {
          const savedModel = this._context.workspaceState.get<string>('selectedModel');
          if (savedModel) {
            this.postMessage({ type: 'savedModel', payload: savedModel });
          }
          break;
        }
        case 'saveModel': {
          const { model } = data.payload;
          await this._context.workspaceState.update('selectedModel', model);
          break;
        }
        case 'revertMessage': {
          const { messageId } = data.payload || {};
          if (!this._currentSessionId || !messageId) break;
          try {
            const result = await this._opencode.revertSession(this._currentSessionId, messageId);
            const messages = await this._opencode.getSessionMessages(this._currentSessionId);
            this.postMessage({ type: 'revertResult', payload: { result, messages, reverted: true } });
          } catch (err: any) {
            this.postMessage({ type: 'error', payload: { message: `Revert failed: ${err.message}` } });
          }
          break;
        }
        case 'unrevert': {
          if (!this._currentSessionId) break;
          try {
            const result = await this._opencode.unrevertSession(this._currentSessionId);
            const messages = await this._opencode.getSessionMessages(this._currentSessionId);
            this.postMessage({ type: 'revertResult', payload: { result, messages, reverted: false } });
          } catch (err: any) {
            this.postMessage({ type: 'error', payload: { message: `Unrevert failed: ${err.message}` } });
          }
          break;
        }
        case 'respondPermission': {
          const { permId, permSessionId, response, remember } = data.payload;
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
          break;
        }
        case 'respondReadPermission': {
          const { filePath, response, remember } = data.payload;
          const resolver = pendingReadPermResolvers.get(filePath);
          if (resolver) {
            if (response === 'allow' && remember) {
              const pattern = isReadDenied(filePath);
              if (pattern) readAllowCache.set(pattern, filePath);
            }
            resolver({ allowed: response === 'allow', remember });
            pendingReadPermResolvers.delete(filePath);
          }
          break;
        }
        case 'loadSkills': {
          const skills = this._loadSkills();
          this.postMessage({ type: 'skillList', payload: { skills } });
          break;
        }
        case 'runCommand': {
          const { command, args } = data.payload;
          if (command === 'init') {
            this._handleInitCommand();
            this.postMessage({ type: 'receiveMessage', payload: { role: 'system', content: `✅ AGENTS.md created in workspace root. You can now customize it for your project.` } });
          } else if (command === 'review') {
            this._handleReviewCommand(args || '');
          }
          break;
        }
        case 'sendMessage': {
          const { prompt, model, mode, context } = data.payload;
          const agent = MODE_TO_AGENT[mode] || 'build';
          console.log('[opencode] Received sendMessage:', prompt?.slice(0, 50), 'mode:', mode);

          // Show user message in chat
          let userContent = prompt;
          const extraParts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

          if (context && Array.isArray(context)) {
            for (const item of context) {
              if (item.type === 'file') {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                  const filePath = item.path;
                  // Check read permission
                  let allowed = true;
                  const deniedPattern = isReadDenied(filePath);
                  if (deniedPattern) {
                    if (readAllowCache.has(deniedPattern)) {
                      allowed = true;
                    } else {
                      allowed = await new Promise<boolean>((resolve) => {
                        const reqId = `${filePath}_${Date.now()}`;
                        pendingReadPermResolvers.set(filePath, (resp) => resolve(resp.allowed));
                        this.postMessage({
                          type: 'readFilePrompt',
                          payload: { filePath, reason: `Matches deny pattern: ${deniedPattern}`, requestId: reqId },
                        });
                      });
                    }
                  }
                  if (allowed) {
                    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
                    try {
                      const content = await vscode.workspace.fs.readFile(fileUri);
                      const text = new TextDecoder().decode(content);
                      extraParts.push({
                        type: 'text',
                        text: `File: ${filePath}\n\n${text}\n`,
                      });
                      this.postMessage({
                        type: 'toolEvent',
                        payload: { id: `file_read_${filePath}`, type: 'file_read', name: 'read', status: 'completed', content: `Read: ${filePath}`, meta: { path: filePath } },
                      });
                    } catch (e: any) {
                      console.log('[opencode] Failed to read file:', filePath, e.message);
                      userContent += `\n\n[File not found: ${filePath}]`;
                    }
                  } else {
                    userContent += `\n\n[Skipped: ${filePath} — read denied by pattern]`;
                    this.postMessage({
                      type: 'toolEvent',
                      payload: { id: `file_read_${filePath}`, type: 'file_read', name: 'read', status: 'failed', content: `Read denied: ${filePath}`, meta: { path: filePath, error: 'Permission denied' } },
                    });
                  }
                }
              }
            }
          }

          this.postMessage({
            type: 'receiveMessage',
            payload: { role: 'user', content: userContent },
          });

          try {
            if (!this._opencode.isRunning) {
              await this._opencode.start();
            }

            // Reuse existing session if available, otherwise create a new one
            if (this._currentSessionId) {
              console.log('[opencode] Reusing session:', this._currentSessionId);
            } else {
              const session = await this._opencode.createSession(
                `VS Code - ${prompt.slice(0, 50)}...`,
              );
              this._currentSessionId = session.id;
              console.log('[opencode] Session created:', session.id);
            }
            const sessionId = this._currentSessionId;

            // Show empty assistant message so chunks can be appended
            this.postMessage({
              type: 'receiveMessage',
              payload: { role: 'assistant', content: '' },
            });

            // Send the prompt and handle streaming
            let accumulatedContent = '';
            let eventDiffs: Array<{ path: string; added: number; deleted: number; content: string }> = [];

            await this._opencode.sendPrompt(
              sessionId,
              prompt,
              (text) => {
                accumulatedContent += text;
                this.postMessage({
                  type: 'receiveChunk',
                  payload: { content: text, fullContent: accumulatedContent },
                });
              },
              (name, args) => {
                this.postMessage({
                  type: 'receiveMessage',
                  payload: { role: 'tool', content: `🔧 ${name} running...` },
                });
              },
              (error) => {
                this.postMessage({ type: 'error', payload: { message: error } });
              },
              model,
              agent,
              extraParts.length > 0 ? extraParts : undefined,
              (event) => {
                this.postMessage({ type: 'toolEvent', payload: event });
              },
              (meta) => {
                this.postMessage({ type: 'messageMeta', payload: meta });
              },
              (reasoning) => {
                this.postMessage({ type: 'reasoningContent', payload: reasoning });
              },
              (diffs) => {
                eventDiffs = diffs;
              },
            );

            // Notify webview that streaming is complete
            this.postMessage({ type: 'streamEnd', payload: { content: accumulatedContent } });

            // Wait for diffs from SSE stream (they arrive after idle via session.diff / message.updated)
            if (eventDiffs.length === 0) {
              await new Promise<void>((resolve) => {
                const check = setInterval(() => {
                  if (eventDiffs.length > 0) {
                    clearInterval(check); clearTimeout(timer); resolve();
                  }
                }, 300);
                const timer = setTimeout(() => { clearInterval(check); resolve(); }, 10000);
              });
            }

            // Process diffs — send file_edit events to webview so user can click to open files
            const diffs = eventDiffs.length > 0 ? eventDiffs : await this._pollDiffs(sessionId);
            console.log('[opencode] Diffs to review:', JSON.stringify(diffs).slice(0, 500));
            if (Array.isArray(diffs) && diffs.length > 0) {
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
                      meta: {
                        path: diff.path,
                        added: diff.added,
                        deleted: diff.deleted,
                        content: diff.content,
                      },
                    },
                  });
                }
              }
            } else {
              console.log('[opencode] No diffs found');
            }
          } catch (err: any) {
            const msg = err?.message || err?.toString?.() || 'Unknown error';
            console.error('[opencode] sendMessage error:', err);
            this.postMessage({
              type: 'error',
              payload: { message: msg },
            });
            this.postMessage({ type: 'streamEnd', payload: { content: '' } });
          }
          break;
        }

        case 'openDiff': {
          const { filePath } = data.payload;
          if (filePath && vscode.workspace.workspaceFolders) {
            try {
              const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filePath);
              const doc = await vscode.workspace.openTextDocument(fileUri);
              await vscode.window.showTextDocument(doc);
            } catch (e: any) {
              console.error('[opencode] Open diff error:', e.message);
            }
          }
          break;
        }
        case 'clearChat':
        case 'abort': {
          if (this._currentSessionId) {
            this._opencode.abortSession(this._currentSessionId).catch(() => {});
            this._currentSessionId = null;
          }
          break;
        }
        case 'listProviders': {
          try {
            const result = await this._opencode.listProviders();
            this.postMessage({ type: 'providerList', payload: result });
          } catch (err: any) {
            this.postMessage({
              type: 'error',
              payload: { message: `Failed to list providers: ${err.message}` },
            });
          }
          break;
        }
        case 'setApiKey': {
          const { providerId, key } = data.payload;
          try {
            const success = await this._opencode.setAuth(providerId, key);
            if (success) {
              // Store in VS Code SecretStorage for secure persistence
              await this._context.secrets.store(`opencode-key-${providerId}`, key);
              const result = await this._opencode.listProviders();
              this.postMessage({ type: 'providerUpdated', payload: { providerId, success: true } });
              this.postMessage({ type: 'providerList', payload: result });
            } else {
              this.postMessage({
                type: 'providerUpdated',
                payload: { providerId, success: false, error: 'Failed to save API key' },
              });
            }
          } catch (err: any) {
            this.postMessage({
              type: 'providerUpdated',
              payload: { providerId, success: false, error: err.message },
            });
          }
          break;
        }
        case 'removeApiKey': {
          const { providerId } = data.payload;
          try {
            await this._opencode.removeAuth(providerId);
            await this._context.secrets.delete(`opencode-key-${providerId}`);
            const result = await this._opencode.listProviders();
            this.postMessage({ type: 'providerUpdated', payload: { providerId, success: true, removed: true } });
            this.postMessage({ type: 'providerList', payload: result });
          } catch (err: any) {
            this.postMessage({
              type: 'providerUpdated',
              payload: { providerId, success: false, error: err.message },
            });
          }
          break;
        }
        case 'getSessions': {
          try {
            const sessions = await this._opencode.listSessions();
            this.postMessage({ type: 'sessionList', payload: sessions });
          } catch (err: any) {
            this.postMessage({
              type: 'error',
              payload: { message: `Failed to list sessions: ${err.message}` },
            });
          }
          break;
        }
        case 'loadSession': {
          const { sessionId } = data.payload;
          try {
            this._currentSessionId = sessionId;
            const messages = await this._opencode.getSessionMessages(sessionId);
            this.postMessage({ type: 'sessionLoaded', payload: { sessionId, messages } });
          } catch (err: any) {
            this.postMessage({
              type: 'error',
              payload: { message: `Failed to load session: ${err.message}` },
            });
          }
          break;
        }
        case 'deleteSession': {
          const { sessionId } = data.payload;
          try {
            await this._opencode.deleteSession(sessionId);
            this.postMessage({ type: 'sessionDeleted', payload: { sessionId } });
          } catch (err: any) {
            this.postMessage({
              type: 'error',
              payload: { message: `Failed to delete session: ${err.message}` },
            });
          }
          break;
        }
        case 'switchAgent': {
          // Agent is sent as part of sendMessage payload, no separate handler needed
          break;
        }
      }
    });
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private async _restoreApiKeys(): Promise<void> {
    try {
      const authData = await this._opencode.getProviderAuth();
      for (const [providerId] of Object.entries(authData)) {
        const stored = await this._context.secrets.get(`opencode-key-${providerId}`);
        if (stored) {
          await this._opencode.setAuth(providerId, stored);
          console.log(`[opencode] Restored API key for ${providerId} from SecretStorage`);
        }
      }
    } catch {
      // No keys to restore or auth not supported — not an error
    }
  }

  private async _pollDiffs(sessionId: string): Promise<any[]> {
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        const diffs = await this._opencode.getSessionDiff(sessionId);
        if (Array.isArray(diffs) && diffs.length > 0) return diffs;
        console.log(`[opencode] Diff poll attempt ${attempt + 1}: no diffs yet`);
      }
    } catch (e: any) {
      console.log('[opencode] Diff poll error:', e.message);
    }
    return [];
  }

  dispose() {
    this._opencode.stop();
  }

  private _loadSkills(): Array<{ name: string; description?: string }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];
    const skillsDir = path.join(workspaceFolders[0].uri.fsPath, '.agents', 'skills');
    if (!existsSync(skillsDir)) return [];
    try {
      const entries = vscode.workspace.fs.readDirectory(vscode.Uri.file(skillsDir));
      // Can't easily use readDirectory sync, fall back to fs
      const dirs = require('node:fs').readdirSync(skillsDir, { withFileTypes: true });
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
    } catch {
      return [];
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
      require('node:fs').writeFileSync(agentsMdPath, content, 'utf-8');
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Failed to create AGENTS.md: ${err.message}` } });
    }
  }

  private async _handleReviewCommand(args: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;
    const root = workspaceFolders[0].uri.fsPath;
    try {
      const { execFileSync } = require('node:child_process');
      const diff = execFileSync('git', ['diff', '--cached', ...(args ? args.split(' ') : [])], { cwd: root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      const prompt = `Review the following uncommitted changes:\n\n${diff.slice(0, 10000)}${diff.length > 10000 ? '\n...(truncated)' : ''}\n\nProvide a concise code review focusing on potential bugs, security issues, and improvements.`;
      // Send as a user message like normal sendMessage
      this._processPrompt(prompt, 'review', undefined);
    } catch (err: any) {
      this.postMessage({ type: 'error', payload: { message: `Review failed: ${err.message}` } });
    }
  }

  private async _processPrompt(prompt: string, mode: string, context?: any): Promise<void> {
    const sessionId = this._currentSessionId || (await this._opencode.createSession(`Review - ${prompt.slice(0, 50)}...`)).id;
    if (!this._currentSessionId) this._currentSessionId = sessionId;

    this.postMessage({
      type: 'receiveMessage',
      payload: { role: 'user', content: prompt },
    });
    this.postMessage({ type: 'receiveMessage', payload: { role: 'assistant', content: '' } });

    const agent = MODE_TO_AGENT[mode] || 'build';
    let accumulatedContent = '';

    await this._opencode.sendPrompt(
      sessionId,
      prompt,
      (chunk) => {
        accumulatedContent += chunk;
        this.postMessage({ type: 'receiveChunk', payload: { content: chunk, fullContent: accumulatedContent } });
      },
      () => {},
      (error) => {
        this.postMessage({ type: 'error', payload: { message: error } });
      },
      undefined,
      agent,
      [],
      (event) => { this.postMessage({ type: 'toolEvent', payload: event }); },
      (meta) => { this.postMessage({ type: 'messageMeta', payload: meta }); },
    );
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
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${styleNonce}'; connect-src ${webview.cspSource} http://127.0.0.1:${serverPort} http://localhost:${serverPort};">
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
