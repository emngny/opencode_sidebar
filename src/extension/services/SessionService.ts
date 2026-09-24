import { randomUUID } from 'node:crypto';
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
    // Use a cryptographically unique fallback when upstream messages lack IDs.
    return mapRawMessagesToChatMessages(raw, () => `${sessionId}_${Date.now()}_${randomUUID()}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this._opencode.deleteSession(sessionId);
    if (this._currentSessionId === sessionId) {
      this._currentSessionId = null;
    }
  }

  async revert(messageId: string): Promise<{ sessionId: string; result: unknown; messages: ChatMessage[] }> {
    const sessionId = this._currentSessionId;
    if (!sessionId) throw new Error('No active session');
    const result = await this._opencode.revertSession(sessionId, messageId);
    const raw = await this._opencode.getSessionMessagesStrict(sessionId);
    const messages = mapRawMessagesToChatMessages(raw, () => `${sessionId}_${Date.now()}_${randomUUID()}`);
    return { sessionId, result, messages };
  }

  async unrevert(): Promise<{ sessionId: string; result: unknown; messages: ChatMessage[] }> {
    const sessionId = this._currentSessionId;
    if (!sessionId) throw new Error('No active session');
    const result = await this._opencode.unrevertSession(sessionId);
    const raw = await this._opencode.getSessionMessagesStrict(sessionId);
    const messages = mapRawMessagesToChatMessages(raw, () => `${sessionId}_${Date.now()}_${randomUUID()}`);
    return { sessionId, result, messages };
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
