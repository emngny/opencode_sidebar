import * as vscode from 'vscode';
import { ReviewQueue } from '../services/ReviewQueue';
import { OpencodeCli } from '../services/OpencodeCli';
import { getNonce } from '../utils';
import { ExtensionToWebviewMessage } from '../types';
import { getGitInfo } from '../services/GitInfo';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'opencode.sidebar';
  private _view?: vscode.WebviewView;
  private _opencode: OpencodeCli;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _reviewQueue: ReviewQueue,
  ) {
    this._opencode = new OpencodeCli();
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

    // Send git info when webview is ready
    setTimeout(() => {
      const gitInfo = getGitInfo();
      this.postMessage({ type: 'gitInfo', payload: gitInfo });
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
        case 'sendMessage': {
          const { prompt, model } = data.payload;

          // Show user message in chat
          this.postMessage({
            type: 'receiveMessage',
            payload: { role: 'user', content: prompt },
          });

          try {
            if (!this._opencode.isRunning) {
              await this._opencode.start();
            }

            // Create a new session for this conversation
            const session = await this._opencode.createSession(
              `VS Code - ${prompt.slice(0, 50)}...`,
            );
            currentSessionId = session.id;

            // Send the prompt and handle streaming
            let accumulatedContent = '';

            await this._opencode.sendPrompt(
              session.id,
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
                  payload: { role: 'tool', content: `Running tool: ${name}...` },
                });
              },
              (error) => {
                this.postMessage({ type: 'error', payload: { message: error } });
              },
              model,
            );

            // Notify webview that streaming is complete
            this.postMessage({ type: 'streamEnd', payload: { content: accumulatedContent } });
          } catch (err: any) {
            const msg = err?.message || err?.toString?.() || 'Bilinmeyen hata';
            console.error('[opencode] sendMessage error:', err);
            this.postMessage({
              type: 'error',
              payload: { message: msg },
            });
            this.postMessage({ type: 'streamEnd', payload: { content: '' } });
          }
          break;
        }

        case 'acceptReview': {
          await this._reviewQueue.acceptActive();
          break;
        }
        case 'rejectReview': {
          await this._reviewQueue.rejectActive();
          break;
        }
        case 'clearChat': {
          if (currentSessionId) {
            this._opencode.abortSession(currentSessionId).catch(() => {});
            currentSessionId = null;
          }
          break;
        }
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
      }
    });
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
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
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
