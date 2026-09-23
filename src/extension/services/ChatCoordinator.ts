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
    const processed = this._context ? await this._context.process(prompt, context) : { userContent: prompt, extraParts: [] };
    try {
      const sessionId = this._sessions.currentSessionId || (await this._opencode.createSession(`Review - ${prompt.slice(0, 50)}...`)).id;
      if (!this._sessions.currentSessionId) this._sessions.currentSessionId = sessionId;
      this._postMessage({ type: 'receiveMessage', payload: { role: 'user', content: prompt } });
      this._postMessage({ type: 'receiveMessage', payload: { role: 'assistant', content: '' } });
      let accumulatedContent = '';
      await this._opencode.sendPrompt(sessionId, processed.userContent, {
        onContent: (chunk) => {
          accumulatedContent += chunk;
          this._postMessage({ type: 'receiveChunk', payload: { content: chunk, fullContent: accumulatedContent } });
        },
        onError: (error) => this._postMessage({ type: 'error', payload: { message: error } }),
        model,
        agent: mode,
        extraParts: processed.extraParts,
        onToolEvent: (event) => this._postMessage({ type: 'toolEvent', payload: event }),
        onMessageMeta: (meta) => this._postMessage({ type: 'messageMeta', payload: meta }),
        onReasoning: (reasoning) => this._postMessage({ type: 'reasoningContent', payload: reasoning }),
        onDiffs: (diffs) => {
          for (const diff of diffs) {
            if (!diff.path || (diff.added === 0 && diff.deleted === 0)) continue;
            this._postMessage({
              type: 'toolEvent',
              payload: {
                id: `file_edit_${diff.path}_${Date.now()}`,
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
      this._postMessage({ type: 'streamEnd', payload: { content: accumulatedContent } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._postMessage({ type: 'error', payload: { message } });
      this._postMessage({ type: 'streamEnd', payload: { content: '' } });
    }
  }
}
