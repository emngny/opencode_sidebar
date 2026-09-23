import { OpencodeCli } from './OpencodeCli';
import { ChatMessage, SessionListItem, RawSessionMessage, mapRawMessagesToChatMessages } from '../../shared/types';

/**
 * Manages chat session lifecycle: creation, loading, deletion, and current session state.
 */
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
    const sessions = await this._opencode.listSessions();
    return sessions as unknown as SessionListItem[];
  }

  async loadSession(sessionId: string): Promise<ChatMessage[]> {
    this._currentSessionId = sessionId;
    const raw: RawSessionMessage[] = await this._opencode.getSessionMessages(sessionId);
    // Opencode returns RawSessionMessage[]; map to ChatMessage for webview
    // Use a simple id fallback — SessionService doesn't have genId, use info.id or index
    return mapRawMessagesToChatMessages(raw, () => `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this._opencode.deleteSession(sessionId);
  }

  async revert(messageId: string): Promise<{ result: unknown; messages: ChatMessage[] }> {
    if (!this._currentSessionId) throw new Error('No active session');
    const result = await this._opencode.revertSession(this._currentSessionId, messageId);
    const raw = await this._opencode.getSessionMessages(this._currentSessionId);
    const messages = mapRawMessagesToChatMessages(raw, () => `${this._currentSessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    return { result, messages };
  }

  async unrevert(): Promise<{ result: unknown; messages: ChatMessage[] }> {
    if (!this._currentSessionId) throw new Error('No active session');
    const result = await this._opencode.unrevertSession(this._currentSessionId);
    const raw = await this._opencode.getSessionMessages(this._currentSessionId);
    const messages = mapRawMessagesToChatMessages(raw, () => `${this._currentSessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    return { result, messages };
  }

  async abort(): Promise<void> {
    const sessionId = this._currentSessionId;
    if (!sessionId) return;
    await this._opencode.abortSession(sessionId);
    if (this._currentSessionId === sessionId) {
      this._currentSessionId = null;
    }
  }
}
