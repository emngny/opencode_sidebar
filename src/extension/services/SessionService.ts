import { OpencodeCli } from './OpencodeCli';
import { ChatMessage } from '../types';

interface SessionListItem {
  id: string;
  name?: string;
  title?: string;
  updated?: string;
  time?: { created?: number; completed?: number };
  messageCount?: number;
  [key: string]: unknown;
}

export class SessionService {
  private _currentSessionId: string | null = null;

  constructor(private readonly _opencode: OpencodeCli) {}

  get currentSessionId(): string | null {
    return this._currentSessionId;
  }

  set currentSessionId(id: string | null) {
    this._currentSessionId = id;
  }

  async ensureSession(prompt: string): Promise<string> {
    if (this._currentSessionId) {
      return this._currentSessionId;
    }
    const session = await this._opencode.createSession(`VS Code - ${prompt.slice(0, 50)}...`);
    this._currentSessionId = session.id;
    return session.id;
  }

  async listSessions(): Promise<SessionListItem[]> {
    return this._opencode.listSessions() as unknown as SessionListItem[];
  }

  async loadSession(sessionId: string): Promise<ChatMessage[]> {
    this._currentSessionId = sessionId;
    return this._opencode.getSessionMessages(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this._opencode.deleteSession(sessionId);
  }

  async revert(messageId: string): Promise<{ result: unknown; messages: ChatMessage[] }> {
    if (!this._currentSessionId) throw new Error('No active session');
    const result = await this._opencode.revertSession(this._currentSessionId, messageId);
    const messages = await this._opencode.getSessionMessages(this._currentSessionId);
    return { result, messages };
  }

  async unrevert(): Promise<{ result: unknown; messages: ChatMessage[] }> {
    if (!this._currentSessionId) throw new Error('No active session');
    const result = await this._opencode.unrevertSession(this._currentSessionId);
    const messages = await this._opencode.getSessionMessages(this._currentSessionId);
    return { result, messages };
  }

  abort(): void {
    if (this._currentSessionId) {
      this._opencode.abortSession(this._currentSessionId).catch(() => {});
      this._currentSessionId = null;
    }
  }
}
