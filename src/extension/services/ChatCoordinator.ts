import { randomUUID } from 'node:crypto';
import type { ContextPart, ExtensionToWebviewMessage } from '../../shared/types';
import type { OpencodeCli } from './OpencodeCli';
import type { ContextService } from './ContextService';
import type { SessionService } from './SessionService';

export class ChatCoordinator {
  constructor(
    private readonly _opencode: OpencodeCli,
    private readonly _sessions: SessionService,
    private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
    private readonly _context?: ContextService,
  ) {}

  async processPrompt(prompt: string, mode: string, context?: ContextPart[], model?: string): Promise<void> {
    const processed = this._context
      ? await this._context.process(prompt, context)
      : { userContent: prompt, extraParts: [] };
    const requestId = randomUUID();
    let sessionId = '';
    try {
      sessionId =
        this._sessions.currentSessionId ||
        (await this._opencode.createSession(`Review - ${prompt.slice(0, 50)}...`)).id;
      if (!this._sessions.currentSessionId) this._sessions.currentSessionId = sessionId;
      this._postMessage({
        type: 'receiveMessage',
        payload: { role: 'user', content: prompt, requestId, sessionId },
      });
      // No assistant placeholder here. One turn is several server messages, and
      // each needs its own bubble in arrival order; a bubble opened up front
      // would be a permanent empty one sitting above the tool cards.
      //
      // `fullContent` is therefore accumulated per server message rather than
      // across the turn — a single running total would paste post-tool narration
      // into the bubble the agent spoke into before the tool ran.
      const textByMessage = new Map<string, string>();
      let latestContent = '';
      const appendText = (chunk: string, key = ''): string => {
        const next = (textByMessage.get(key) ?? '') + chunk;
        textByMessage.set(key, next);
        latestContent = next;
        return next;
      };
      await this._opencode.sendPrompt(sessionId, processed.userContent, {
        requestId,
        onContent: (chunk, messageId) => {
          this._postMessage({
            type: 'receiveChunk',
            payload: {
              content: chunk,
              fullContent: appendText(chunk, messageId),
              messageId,
              requestId,
              sessionId,
            },
          });
        },
        onError: (error) => this._postMessage({ type: 'error', payload: { message: error, requestId, sessionId } }),
        model,
        agent: mode,
        extraParts: processed.extraParts,
        onToolEvent: (event) => this._postMessage({ type: 'toolEvent', payload: { ...event, requestId, sessionId } }),
        onMessageMeta: (meta) => this._postMessage({ type: 'messageMeta', payload: { ...meta, requestId, sessionId } }),
        onReasoning: (reasoning, messageId) =>
          this._postMessage({
            type: 'reasoningContent',
            payload: { content: reasoning, messageId, requestId, sessionId },
          }),
        onDiffs: (diffs) => {
          for (const diff of diffs) {
            if (!diff.path || (diff.added === 0 && diff.deleted === 0)) continue;
            this._postMessage({
              type: 'toolEvent',
              payload: {
                id: `file_edit_${diff.path}_${Date.now()}`,
                requestId,
                sessionId,
                type: 'file_edit',
                name: 'file_edit',
                status: 'completed',
                content: diff.path,
                meta: { path: diff.path, added: diff.added, deleted: diff.deleted, content: diff.content },
              },
            });
          }
        },
      });
      this._postMessage({ type: 'streamEnd', payload: { content: latestContent, requestId, sessionId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._postMessage({ type: 'error', payload: { message, requestId, sessionId } });
      this._postMessage({ type: 'streamEnd', payload: { content: '', requestId, sessionId } });
    }
  }
}
