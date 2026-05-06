import * as vscode from 'vscode';
import { OpencodeCli } from '../services/OpencodeCli';
import { getNonce } from '../utils';
import { ExtensionToWebviewMessage } from '../types';
import { getGitInfo } from '../services/GitInfo';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode.sidebar';
  private _view?: vscode.WebviewView;
  private readonly _opencode: OpencodeCli;

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
    this._opencode.start().catch((err) => {
      console.error('Opencode server start failed:', err);
      this.postMessage({
        type: 'receiveMessage',
        payload: {
          role: 'system',
          content: `⚠️ Opencode CLI not available: ${err.message}. You can still use the mock mode.`,
        },
      });
    });

    let currentSessionId: string | null = null;

    webviewView.webview.onDidReceiveMessage(async (data) => {
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
          if (!currentSessionId || !messageId) break;
          try {
            const result = await this._opencode.revertSession(currentSessionId, messageId);
            const messages = await this._opencode.getSessionMessages(currentSessionId);
            this.postMessage({ type: 'revertResult', payload: { result, messages, reverted: true } });
          } catch (err: any) {
            this.postMessage({ type: 'error', payload: { message: `Revert failed: ${err.message}` } });
          }
          break;
        }
        case 'unrevert': {
          if (!currentSessionId) break;
          try {
            const result = await this._opencode.unrevertSession(currentSessionId);
            const messages = await this._opencode.getSessionMessages(currentSessionId);
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
        case 'sendMessage': {
          const { prompt, model, mode, context } = data.payload;
          const agent = mode === 'Plan' ? 'plan' : 'build';
          console.log('[opencode] Received sendMessage:', prompt?.slice(0, 50), 'mode:', mode);

          // Show user message in chat
          let userContent = prompt;
          const extraParts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

          if (context && Array.isArray(context)) {
            for (const item of context) {
              if (item.type === 'file') {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                  const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, item.path);
                  try {
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const text = new TextDecoder().decode(content);
                    extraParts.push({
                      type: 'text',
                      text: `File: ${item.path}\n\n${text}\n`,
                    });
                  } catch (e: any) {
                    console.log('[opencode] Failed to read file:', item.path, e.message);
                    userContent += `\n\n[File not found: ${item.path}]`;
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
            if (currentSessionId) {
              console.log('[opencode] Reusing session:', currentSessionId);
            } else {
              const session = await this._opencode.createSession(
                `VS Code - ${prompt.slice(0, 50)}...`,
              );
              currentSessionId = session.id;
              console.log('[opencode] Session created:', session.id);
            }
            const sessionId = currentSessionId;

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
          if (currentSessionId) {
            this._opencode.abortSession(currentSessionId).catch(() => {});
            currentSessionId = null;
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
              // Refresh provider list after setting key
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
            currentSessionId = sessionId;
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

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource} https:;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Opencode</title>
        <style>
          body { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; background-color: #1e1e2e; color: #cdd6f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
          #root { width: 100%; height: 100%; display: flex; flex-direction: column; }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
