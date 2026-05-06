import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ProviderListResult } from '../types';

interface NormalizedDiff {
  path: string;
  added: number;
  deleted: number;
  content: string;
}

function normalizeDiff(d: any): NormalizedDiff {
  const path = d.path || d.file || '';
  const content = d.content || d.patch || '';
  let added = typeof d.added === 'number' ? d.added : 0;
  let deleted = typeof d.deleted === 'number' ? d.deleted : 0;
  if (added === 0 && deleted === 0 && content) {
    // Parse added/deleted from unified diff
    for (const line of content.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) deleted++;
    }
  }
  return { path, added, deleted, content };
}

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
  private readonly cwd: string | undefined;
  // Track which part IDs have received deltas (to avoid duplicating full text updates)
  private readonly sessionPartDeltas: Map<string, Set<string>> = new Map();
  // Track partID -> partType for each session (to skip reasoning deltas)
  private readonly sessionPartTypes: Map<string, Map<string, string>> = new Map();

  constructor(cwd?: string) {
    this.binaryPath = this.resolveBinary();
    this.cwd = cwd;
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
        cwd: this.cwd,
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
          console.log('[opencode] Server started on port:', port);
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

  async getSessionDiff(sessionId: string): Promise<NormalizedDiff[]> {
    await this.start();
    try {
      const result = await this.apiFetch(`/session/${sessionId}/diff`);
      const arr = Array.isArray(result) ? result : (result?.files ? result.files : []);
      const normalized = arr.map(normalizeDiff);
      console.log('[opencode] Session diff result:', normalized.length, 'files');
      return normalized;
    } catch (err: any) {
      console.log('[opencode] Session diff not available:', err?.message);
      return [];
    }
  }

  async getSessionMessages(sessionId: string): Promise<any[]> {
    await this.start();
    try {
      return await this.apiFetch(`/session/${sessionId}/message`);
    } catch {
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.start();
    try {
      await this.apiFetch(`/session/${sessionId}`, { method: 'DELETE' });
      return true;
    } catch {
      return false;
    }
  }

  async getAgents(): Promise<any[]> {
    await this.start();
    try {
      return await this.apiFetch('/agent');
    } catch {
      return [];
    }
  }

  async getCurrentProject(): Promise<any> {
    await this.start();
    try {
      return await this.apiFetch('/project/current');
    } catch {
      return null;
    }
  }

  async getPath(): Promise<any> {
    await this.start();
    try {
      return await this.apiFetch('/path');
    } catch {
      return null;
    }
  }

  async getVcsInfo(): Promise<any> {
    await this.start();
    try {
      return await this.apiFetch('/vcs');
    } catch {
      return null;
    }
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
    if (!this.server) return false;
    try {
      const response = await fetch(`${this.server.url}/auth/${providerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ type: 'api', key }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async removeAuth(providerId: string): Promise<boolean> {
    await this.start();
    if (!this.server) return false;
    try {
      const response = await fetch(`${this.server.url}/auth/${providerId}`, {
        method: 'DELETE',
        headers: { ...this.authHeader },
      });
      return response.ok;
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
    agent?: string,
    extraParts?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
    onToolEvent?: (event: { id: string; type: string; name: string; status: string; content: string; meta?: any }) => void,
    onMessageMeta?: (meta: { id: string; agent?: string; modelId?: string; time?: { created?: number; completed?: number } }) => void,
    onReasoning?: (text: string) => void,
    onDiffs?: (diffs: NormalizedDiff[]) => void,
  ): Promise<string> {
    await this.start();

    const parts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      ...(extraParts || []),
      { type: 'text', text: prompt },
    ];
    const body: Record<string, any> = { parts };

    if (model?.includes('/')) {
      const [providerID, modelID] = model.split('/');
      body.model = { providerID, modelID };
    } else if (model) {
      body.model = { providerID: 'opencode', modelID: model };
    }
    if (agent) body.agent = agent;

    // Abort any previous event listeners
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    let messageId = '';
    let idle = false;

    // Reset delta tracking for this session
    this.sessionPartDeltas.set(sessionId, new Set());
    this.sessionPartTypes.set(sessionId, new Map());

    // Create a promise that resolves when session becomes idle
    const idlePromise = new Promise<void>((resolve) => {
      // Start reading /event SSE
      this.readSSE('/event', (event: SSEMessage) => {
        console.log('[opencode] /event:', event.type, JSON.stringify(event.properties).slice(0, 200));
        this.handleEvent(event, sessionId, onContent, onToolCall, onError, onToolEvent, onMessageMeta, onReasoning, onDiffs);
        if (!messageId && event.properties?.info?.id) messageId = event.properties.info.id;
        if (event.type === 'session.status' && event.properties?.status?.type === 'idle') {
          idle = true;
          resolve();
        }
      }, this.abortController!.signal);

      // Also try to read POST response as SSE
      const postUrl = `${this.server!.url}/session/${sessionId}/message`;
      fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify(body),
        signal: this.abortController!.signal,
      }).then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        const contentType = response.headers.get('content-type') || '';
        console.log('[opencode] POST /message content-type:', contentType);

        if (contentType.includes('event-stream')) {
          this.readSSEStream(response, (event: SSEMessage) => {
            console.log('[opencode] POST event:', event.type, JSON.stringify(event.properties).slice(0, 200));
        this.handleEvent(event, sessionId, onContent, onToolCall, onError, onToolEvent, onMessageMeta, onReasoning, onDiffs);
            if (!messageId && event.properties?.info?.id) messageId = event.properties.info.id;
            if (event.type === 'session.status' && event.properties?.status?.type === 'idle') {
              idle = true;
            }
          });
        } else {
          // JSON response - might contain message ID
          try {
            const data: any = await response.json();
            if (data?.info?.id) messageId = data.info.id;
          } catch {}
        }
      }).catch((err) => {
        console.error('[opencode:post] Error:', err?.message);
        onError?.(err.message || 'POST error');
        if (!idle) { idle = true; resolve(); }
      });

      // Timeout
      setTimeout(() => {
        if (!idle) {
          idle = true;
          console.log('[opencode] Session timeout expired for', sessionId);
          // Clean up server-side
          fetch(`${this.server!.url}/session/${sessionId}/abort`, {
            method: 'POST',
            headers: { ...this.authHeader },
          }).catch(() => {});
          resolve();
        }
      }, 60000);
    });

    await idlePromise;
    return messageId;
  }

  private readSSE(path: string, onEvent: (event: SSEMessage) => void, signal: AbortSignal): void {
    const run = async () => {
      try {
        const response = await fetch(`${this.server!.url}${path}`, {
          headers: { ...this.authHeader },
          signal,
        });
        this.readSSEStream(response, onEvent);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error(`[opencode:sse] ${path} error:`, err?.message);
        }
      }
    };
    run();
  }

  private readSSEStream(response: Response, onEvent: (event: SSEMessage) => void): void {
    const run = async () => {
      try {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                onEvent(JSON.parse(line.slice(6)) as SSEMessage);
              } catch { /* skip parse error */ }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('[opencode:sse-stream] Error:', err?.message);
        }
      }
    };
    run();
  }

  private handleEvent(
    event: SSEMessage,
    sessionId: string,
    onContent?: (text: string) => void,
    onToolCall?: (name: string, args: any) => void,
    onError?: (error: string) => void,
    onToolEvent?: (event: { id: string; type: string; name: string; status: string; content: string; meta?: any }) => void,
    onMessageMeta?: (meta: { id: string; agent?: string; modelId?: string; time?: { created?: number; completed?: number } }) => void,
    onReasoning?: (text: string) => void,
    onDiffs?: (diffs: NormalizedDiff[]) => void,
  ): void {
    // Track message metadata from event info
    const info = event.properties?.info;
    if (info?.id && onMessageMeta) {
      const agent = info.agent || undefined;
      const modelId = info.model ? `${info.model.providerID}/${info.model.modelID}` : undefined;
      const time = info.time ? { created: info.time.created, completed: info.time.completed } : undefined;
      if (agent || modelId || time) {
        onMessageMeta({ id: info.id, agent, modelId, time });
      }
    }
    switch (event.type) {
      case 'message.part.updated': {
        const part = event.properties?.part;
        if (part?.id && part?.type) {
          // Track part type for this session
          const types = this.sessionPartTypes.get(sessionId);
          types?.set(part.id, part.type);
        }
        if (part?.type === 'text') {
          // Deltas handle streaming text, skip full text update to avoid duplication
          break;
        }
        if (part?.type === 'reasoning') {
          // Thinking/reasoning - handled by ChatBubble isStreaming indicator
          break;
        }
        if (part?.type === 'compaction') {
          onToolEvent?.({
            id: part.id || 'compaction',
            type: 'compacting',
            name: 'compaction',
            status: part?.state?.status === 'completed' ? 'completed' : 'running',
            content: part?.state?.status === 'completed' ? 'Conversation compacted' : 'Compacting conversation...',
            meta: { result: part?.result || part?.state?.result },
          });
          break;
        }
        if (part?.type === 'tool_call') {
          onToolEvent?.({
            id: part.id || part.name || 'tool',
            type: 'tool_call',
            name: part.name || 'unknown',
            status: 'running',
            content: `${part.name || 'unknown'} calling...`,
            meta: { args: part.args },
          });
          onToolCall?.(part.name || 'unknown', part.args);
        }
        if (part?.type === 'tool') {
          const toolName = part?.tool || 'unknown';
          const status = part?.state?.status;
          if (status === 'running') {
            onToolEvent?.({
              id: part.id || toolName,
              type: 'tool_result',
              name: toolName,
              status: 'running',
              content: `${toolName} running...`,
            });
          } else if (status === 'completed') {
            const toolResult = part?.result || part?.state?.result;
            const meta: any = { result: toolResult };
            if (toolName === 'task') {
              meta.sessionId = part?.state?.metadata?.sessionId;
              meta.description = part?.state?.input?.description;
              meta.subagentType = part?.state?.input?.subagent_type;
            }
            onToolEvent?.({
              id: part.id || toolName,
              type: 'tool_result',
              name: toolName,
              status: 'completed',
              content: toolName === 'task' ? 'Task completed' : `${toolName} completed`,
              meta,
            });
            // Also send as content for backward compatibility
            if (toolResult) {
              onContent?.(`\n[${toolName} result]\n${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}\n[/${toolName}]\n`);
            }
          } else if (status === 'failed') {
            onToolEvent?.({
              id: part.id || toolName,
              type: 'tool_result',
              name: toolName,
              status: 'failed',
              content: `${toolName} failed`,
              meta: { error: part.state.error || part.state.reason },
            });
            onError?.(`${toolName} failed: ${part.state.error || part.state.reason || 'unknown error'}`);
          }
        }
        if (part?.type === 'tool_result' && part?.result) {
          onToolEvent?.({
            id: part.id || part.name || 'tool',
            type: 'tool_result',
            name: part.name || 'unknown',
            status: 'completed',
            content: `${part.name || 'unknown'} result`,
            meta: { result: part.result },
          });
          onContent?.(`\n[Tool: ${part.name || 'unknown'}]\n${part.result}\n[/Tool]\n`);
        }
        break;
      }
      case 'message.part.delta': {
        const props = event.properties;
        if (props?.field === 'text' && props?.delta) {
          // Check if this part is a "text" type (not "reasoning")
          const types = this.sessionPartTypes.get(sessionId);
          const partType = props.partID ? types?.get(props.partID) : undefined;
          if (partType === 'reasoning') {
            onReasoning?.(props.delta);
            break;
          }
          // Track that this part has received deltas
          const deltas = this.sessionPartDeltas.get(sessionId);
          if (deltas && props.partID) deltas.add(props.partID);
          onContent?.(props.delta);
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
      case 'message.updated': {
        const rawSummaryDiffs = event.properties?.info?.summary?.diffs;
        if (Array.isArray(rawSummaryDiffs) && rawSummaryDiffs.length > 0 && onDiffs) {
          const normalized = rawSummaryDiffs.map(normalizeDiff);
          console.log('[opencode] Diffs from message.updated:', normalized.length, 'files');
          onDiffs(normalized);
        }
        break;
      }
      case 'session.diff': {
        const rawDiff = event.properties?.diff;
        if (Array.isArray(rawDiff) && rawDiff.length > 0 && onDiffs) {
          const normalized = rawDiff.map(normalizeDiff);
          console.log('[opencode] Diffs from session.diff:', normalized.length, 'files');
          onDiffs(normalized);
        }
        break;
      }
      case 'permission.asked': {
        const permId = event.properties?.id || event.properties?.permissionID || event.properties?.permissionId;
        const permSessionId = event.properties?.sessionID || event.properties?.sessionId || sessionId;
        const permType = event.properties?.permission;
        const patterns = event.properties?.patterns || [];
        console.log('[opencode] Permission asked:', permType, patterns, 'id:', permId, 'session:', permSessionId);
        // Send permission prompt to UI instead of auto-granting
        onToolEvent?.({
          id: permId || 'permission',
          type: 'permission',
          name: 'permission',
          status: 'running',
          content: `${permType}${patterns.length > 0 ? ' ' + patterns.join(', ') : ''}`,
          meta: { permId, permSessionId, permType, patterns },
        });
        break;
      }
    }
  }

  async grantPermission(sessionID: string, permissionId: string): Promise<void> {
    await this.start();
    try {
      const url = `${this.server!.url}/session/${sessionID}/permissions/${permissionId}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ response: 'always', remember: true }),
      });
      if (response.ok) {
        console.log('[opencode] Permission granted:', permissionId);
      } else {
        const text = await response.text();
        console.error('[opencode] Permission grant failed:', response.status, text.slice(0, 200));
      }
    } catch (err: any) {
      console.error('[opencode] Failed to grant permission:', err?.message);
    }
  }

  async summarizeSession(sessionId: string, providerID: string, modelID: string): Promise<boolean> {
    await this.start();
    try {
      const result = await this.apiFetch(`/session/${sessionId}/summarize`, {
        method: 'POST',
        body: JSON.stringify({ providerID, modelID, auto: false }),
      });
      return result === true || result === 'true';
    } catch {
      return false;
    }
  }

  async revertSession(sessionId: string, messageId: string): Promise<any> {
    await this.start();
    try {
      return await this.apiFetch(`/session/${sessionId}/revert`, {
        method: 'POST',
        body: JSON.stringify({ messageID: messageId }),
      });
    } catch {
      return null;
    }
  }

  async unrevertSession(sessionId: string): Promise<any> {
    await this.start();
    try {
      return await this.apiFetch(`/session/${sessionId}/unrevert`, {
        method: 'POST',
      });
    } catch {
      return null;
    }
  }

  async respondPermission(sessionID: string, permissionId: string, response: string, remember?: boolean): Promise<boolean> {
    await this.start();
    try {
      const url = `${this.server!.url}/session/${sessionID}/permissions/${permissionId}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ response, remember: remember ?? false }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
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
