import { randomUUID } from 'node:crypto';
import { OpencodeCli } from './OpencodeCli';
import { toolEventsFromPart } from './EventDispatcher';
import { ToolPart } from '../../shared/types';
import { NormalizedDiff } from '../utils/diffUtils';
import { ChatMessage, SessionListItem, RawSessionMessage, mapRawMessagesToChatMessages } from '../../shared/types';

/** Tool cards kept per turn when a session is restored, oldest dropped first. */
const RESTORED_TOOL_CARDS_PER_TURN = 3;

/**
 * Stamps the trailing assistant message with the id of the turn that is still
 * streaming server-side.
 *
 * `mapRawMessagesToChatMessages` cannot know about in-flight turns, so a
 * rehydrated transcript comes back with no `requestId` anywhere. The webview
 * routes deltas by `requestId`; without the stamp it fails to find a target
 * message and opens a second bubble for a turn that is already on screen.
 */
function markStreamingTail(messages: ChatMessage[], requestId: string): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    const next = [...messages];
    next[i] = { ...messages[i], requestId, isStreaming: true };
    return next;
  }
  return messages;
}

/**
 * Re-inserts the tool cards `mapRawMessagesToChatMessages` drops.
 *
 * That mapper only flattens text parts, so a restored session came back with
 * the conversation but none of its cards — no reads, no commands, no edits. The
 * part → card mapping itself is borrowed from the live stream so the two paths
 * cannot drift apart.
 */
function withToolEvents(messages: ChatMessage[], raw: RawSessionMessage[], genId: () => string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const parts = raw[i]?.parts ?? [];
    const toolEvents = parts
      .filter((p) => p?.type === 'tool')
      .flatMap((p) => toolEventsFromPart(p as unknown as ToolPart));
    // A message that only ran tools has no text; keeping it would leave an
    // empty bubble above its own cards.
    if (message.content.trim() !== '' || toolEvents.length === 0) out.push(message);
    for (const event of toolEvents) {
      out.push({
        id: genId(),
        role: 'event',
        content: event.content,
        timestamp: message.timestamp,
        eventType: 'tool_result',
        eventStatus: event.status === 'running' || event.status === 'failed' ? event.status : 'completed',
        eventMeta: { ...event.meta, name: event.name },
      });
    }
  }
  return out;
}

/**
 * Appends one card per file the session changed.
 *
 * The session diff is cumulative, so it already holds one entry per file and
 * no folding is needed. It carries no record of *when* each edit landed, which
 * is why the cards go at the end rather than inline — guessing a turn from
 * timestamps would place them under the wrong message.
 */
function withFileEdits(messages: ChatMessage[], diffs: NormalizedDiff[], genId: () => string): ChatMessage[] {
  const changed = diffs.filter((d) => d.path && (d.added > 0 || d.deleted > 0));
  if (changed.length === 0) return messages;
  const lastTimestamp = messages.at(-1)?.timestamp ?? Date.now();
  return [
    ...messages,
    ...changed.map((diff) => ({
      id: genId(),
      role: 'event' as const,
      content: diff.path,
      timestamp: lastTimestamp,
      eventType: 'file_edit' as const,
      eventStatus: 'completed' as const,
      eventMeta: { path: diff.path, added: diff.added, deleted: diff.deleted, content: diff.content },
    })),
  ];
}

/**
 * Trims each turn's routine tool cards down to the last few.
 *
 * A long session stores hundreds of parts, and restoring them all turns the
 * transcript into a wall of cards. Failures are never dropped — a hidden error
 * is worse than a long list — and neither are the cards that explain what
 * changed on disk.
 */
function trimRestoredTools(messages: ChatMessage[]): ChatMessage[] {
  const isRoutine = (m: ChatMessage): boolean =>
    m.role === 'event' && (m.eventType === 'tool_result' || m.eventType === 'tool_call') && m.eventStatus !== 'failed';

  const out: ChatMessage[] = [];
  let turn = 0;
  let turnStart = 0;

  const flush = (): void => {
    const turnMessages = out.slice(turnStart);
    const routine = turnMessages.map((m, i) => (isRoutine(m) ? i : -1)).filter((i) => i >= 0);
    const excess = routine.length - RESTORED_TOOL_CARDS_PER_TURN;
    if (excess <= 0) return;
    const dropped = routine.slice(0, excess);
    const removed = new Set(dropped);
    const kept = turnMessages.filter((_, i) => !removed.has(i));
    const insertAt = dropped[0];
    const summary: ChatMessage = {
      id: `ops_summary_${turn}`,
      role: 'event',
      content: `${dropped.length} earlier operations`,
      timestamp: turnMessages[insertAt].timestamp,
      eventType: 'tool_result',
      eventStatus: 'completed',
      eventMeta: { name: 'operations' },
    };
    out.splice(turnStart, turnMessages.length, ...kept.slice(0, insertAt), summary, ...kept.slice(insertAt));
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flush();
      turnStart = out.length;
      turn += 1;
    }
    out.push(message);
  }
  flush();
  return out;
}

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

  async loadSession(sessionId: string, activeRequestId?: string | null): Promise<ChatMessage[]> {
    this._currentSessionId = sessionId;
    const genId = () => `${sessionId}_${Date.now()}_${randomUUID()}`;
    const raw: RawSessionMessage[] = await this._opencode.getSessionMessages(sessionId);
    // Opencode returns RawSessionMessage[]; map to ChatMessage for webview
    // Use a cryptographically unique fallback when upstream messages lack IDs.
    const mapped = mapRawMessagesToChatMessages(raw, genId);
    const withTools = withToolEvents(mapped, raw, genId);
    const withEdits = withFileEdits(withTools, await this.readSessionDiff(sessionId), genId);
    const trimmed = trimRestoredTools(withEdits);
    return activeRequestId ? markStreamingTail(trimmed, activeRequestId) : trimmed;
  }

  /**
   * Session diffs are supplementary: a restored conversation is still worth
   * showing if the server refuses to hand them over.
   */
  private async readSessionDiff(sessionId: string): Promise<NormalizedDiff[]> {
    try {
      return await this._opencode.getSessionDiff(sessionId);
    } catch {
      return [];
    }
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
