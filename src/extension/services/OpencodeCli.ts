import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ProviderListResult } from '../types';

interface OpencodeServerInfo {
  port: number;
  password: string;
  url: string;
}

interface SessionInfo {
  id: string;
  title?: string;
}

interface SSEMessage {
  id: string;
  type: string;
  properties: any;
}

type EventHandler = (event: SSEMessage) => void;

export class OpencodeCli {
  private process: ChildProcess | null = null;
  private server: OpencodeServerInfo | null = null;
  private readonly eventHandlers: Set<EventHandler> = new Set();
  private abortController: AbortController | null = null;
  private readonly binaryPath: string = 'opencode';

  constructor() {
    this.binaryPath = this.resolveBinary();
  }

  private resolveBinary(): string {
    const candidates = [
      String.raw`C:\Users\eming\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe`,
      String.raw`C:\Users\eming\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64-baseline\bin\opencode.exe`,
      process.env.LOCALAPPDATA + String.raw`\opencode\opencode.exe`,
    ];

    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return 'opencode';
  }

  async start(): Promise<void> {
    if (this.server) return;

    const password = 'oc-vsc-' + Math.random().toString(36).slice(2, 14);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.binaryPath, ['serve', '--port', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: password,
        },
      });

      let started = false;
      let outputBuffer = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputBuffer += text;

        const match = new RegExp(/http:\/\/127\.0\.0\.1:(\d+)/).exec(outputBuffer);
        if (match && !started) {
          started = true;
          const port = Number.parseInt(match[1], 10);
          this.server = { port, password, url: `http://127.0.0.1:${port}` };
          this.process = proc;
          resolve();
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.error('[opencode:err]', text);
      });

      proc.on('error', (err: Error) => {
        if (!started) reject(err);
      });

      proc.on('exit', (code) => {
        if (!started) reject(new Error(`opencode serve exited with code ${code}`));
        this.server = null;
        this.process = null;
      });

      setTimeout(() => {
        if (!started) {
          proc.kill();
          reject(new Error('opencode serve timeout'));
        }
      }, 30000);
    });
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  get url(): string | null {
    return this.server?.url ?? null;
  }

  private get authHeader(): Record<string, string> {
    if (!this.server) return {};
    // Server default username is "opencode" (from OPENCODE_SERVER_USERNAME env or default)
    const encoded = Buffer.from(`opencode:${this.server.password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  private async apiFetch(path: string, options: RequestInit = {}): Promise<any> {
    if (!this.server) throw new Error('Opencode server not running');

    const url = `${this.server.url}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[opencode:api] ${options.method || 'GET'} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  }

  async createSession(title?: string): Promise<SessionInfo> {
    await this.start();
    const data = await this.apiFetch('/session', {
      method: 'POST',
      body: JSON.stringify({
        title: title || `VS Code - ${new Date().toLocaleString()}`,
      }),
    });
    return { id: data.id, title: data.title };
  }

  async listSessions(): Promise<SessionInfo[]> {
    await this.start();
    const data = await this.apiFetch('/session');
    return Array.isArray(data) ? data : [];
  }

  async listProviders(): Promise<ProviderListResult> {
    await this.start();
    return this.apiFetch('/provider');
  }

  async getProviderAuth(): Promise<Record<string, Array<{ type: string; label: string; prompts?: any[] }>>> {
    await this.start();
    return this.apiFetch('/provider/auth');
  }

  async setAuth(providerId: string, key: string): Promise<boolean> {
    await this.start();
    try {
      await this.apiFetch('/auth/set', {
        method: 'POST',
        body: JSON.stringify({ key: providerId, info: { type: 'api', key } }),
      });
      return true;
    } catch {
      // Fallback: try config endpoint
      try {
        await this.apiFetch('/config', {
          method: 'PATCH',
          body: JSON.stringify({
            providers: { [providerId]: { options: { apiKey: key } } },
          }),
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async removeAuth(providerId: string): Promise<boolean> {
    await this.start();
    try {
      await this.apiFetch('/auth/remove', {
        method: 'POST',
        body: JSON.stringify({ key: providerId }),
      });
      return true;
    } catch {
      return false;
    }
  }

  async sendPrompt(
    sessionId: string,
    prompt: string,
    onContent?: (text: string) => void,
    onToolCall?: (name: string, args: any) => void,
    onError?: (error: string) => void,
    model?: string,
  ): Promise<string> {
    await this.start();

    const body: Record<string, any> = {
      parts: [{ type: 'text', text: prompt }],
    };

    if (model?.includes('/')) {
      const [providerID, modelID] = model.split('/');
      body.model = { providerID, modelID };
    } else if (model) {
      body.model = { providerID: 'opencode', modelID: model };
    }

    // Abort any previous event listeners
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    const url = `${this.server!.url}/session/${sessionId}/message`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader,
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[opencode:api] POST /session/${sessionId}/message -> ${response.status}: ${text.slice(0, 500)}`);
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // SSE stream response
    if (contentType.includes('event-stream')) {
      console.log('[opencode] Reading SSE stream from prompt response');
      let messageId = '';
      let idleReceived = false;

      try {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!idleReceived) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.properties?.info?.id) messageId = event.properties.info.id;
                this.handleEvent(event, sessionId, onContent, onToolCall, onError);
                if (event.type === 'session.status' && event.properties?.status?.type === 'idle') {
                  idleReceived = true;
                }
              } catch { /* skip parse error */ }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('[opencode:sse] Stream error:', err?.message);
          onError?.(err.message || 'Stream error');
        }
      }

      return messageId;
    }

    // Regular JSON response
    const data: any = await response.json();
    return data?.info?.id || '';
  }

  private handleEvent(
    event: SSEMessage,
    sessionId: string,
    onContent?: (text: string) => void,
    onToolCall?: (name: string, args: any) => void,
    onError?: (error: string) => void,
  ): void {
    switch (event.type) {
      case 'message.part.updated': {
        const part = event.properties?.part;
        if (part?.type === 'text' && part?.text) {
          onContent?.(part.text);
        }
        if (part?.type === 'reasoning' && part?.text) {
          // Could show thinking
        }
        if (part?.type === 'tool_call') {
          onToolCall?.(part.name || 'unknown', part.args);
        }
        if (part?.type === 'tool_result' && part?.result) {
          onContent?.(`\n[Tool: ${part.name || 'unknown'}]\n${part.result}\n[/Tool]\n`);
        }
        break;
      }
      case 'session.error': {
        onError?.(event.properties?.error?.message || 'Unknown error');
        break;
      }
      case 'session.status': {
        if (event.properties?.status?.type === 'idle') {
          // Session became idle = done processing
        }
        break;
      }
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    try {
      await this.apiFetch(`/session/${sessionId}/abort`, { method: 'POST' });
    } catch {
      // ignore
    }
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  stop(): void {
    this.abortController?.abort();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.server = null;
  }
}
