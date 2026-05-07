import { describe, it, expect } from 'vitest';
import { EventDispatcher } from './EventDispatcher';

describe('EventDispatcher', () => {
  const createDispatcher = (callbacks: any = {}) => new EventDispatcher(callbacks);

  it('should call onContent for message.part.delta with field text', () => {
    let capturedContent = '';
    const dispatcher = createDispatcher({
      onContent: (text: string) => { capturedContent = text; },
    });

    dispatcher.dispatch({
      type: 'message.part.delta',
      properties: { field: 'text', delta: 'Hello world' },
    }, 'session-1');

    expect(capturedContent).toBe('Hello world');
  });

  it('should call onReasoning for reasoning delta', () => {
    let capturedReasoning = '';
    const dispatcher = createDispatcher({
      onReasoning: (text: string) => { capturedReasoning = text; },
    });

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: { id: 'p1', type: 'reasoning' },
      },
    }, 'session-1');

    dispatcher.resetSession('session-1');

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: { id: 'p1', type: 'reasoning' },
      },
    }, 'session-1');

    dispatcher.dispatch({
      type: 'message.part.delta',
      properties: { field: 'text', delta: 'Thinking...', partID: 'p1' },
    }, 'session-1');

    expect(capturedReasoning).toBe('Thinking...');
  });

  it('should call onError for session.error', () => {
    let capturedError = '';
    const dispatcher = createDispatcher({
      onError: (err: string) => { capturedError = err; },
    });

    dispatcher.dispatch({
      type: 'session.error',
      properties: { error: { message: 'Something went wrong' } },
    }, 'session-1');

    expect(capturedError).toBe('Something went wrong');
  });

  it('should call onError with unknown for missing message', () => {
    let capturedError = '';
    const dispatcher = createDispatcher({
      onError: (err: string) => { capturedError = err; },
    });

    dispatcher.dispatch({
      type: 'session.error',
      properties: {},
    }, 'session-1');

    expect(capturedError).toBe('Unknown error');
  });

  it('should track part types in sessionPartTypes', () => {
    const dispatcher = createDispatcher({});

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: { id: 'part-1', type: 'tool_call', name: 'read', args: {} },
      },
    }, 'session-abc');

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: { id: 'part-2', type: 'tool', tool: 'read' },
      },
    }, 'session-abc');

    dispatcher.resetSession('session-abc');
    dispatcher.clearSession('session-abc');
  });

  it('should call onDiffs for message.updated with summary diffs', () => {
    let capturedDiffs: any[] = [];
    const dispatcher = createDispatcher({
      onDiffs: (diffs: any[]) => { capturedDiffs = diffs; },
    });

    dispatcher.dispatch({
      type: 'message.updated',
      properties: {
        info: {
          summary: {
            diffs: [
              { path: 'file1.ts', content: '+1\n-1' },
              { path: 'file2.ts', added: 5, deleted: 2 },
            ],
          },
        },
      },
    }, 'session-1');

    expect(capturedDiffs).toHaveLength(2);
    expect(capturedDiffs[0].path).toBe('file1.ts');
    expect(capturedDiffs[1].path).toBe('file2.ts');
  });

  it('should call onDiffs for session.diff', () => {
    let capturedDiffs: any[] = [];
    const dispatcher = createDispatcher({
      onDiffs: (diffs: any[]) => { capturedDiffs = diffs; },
    });

    dispatcher.dispatch({
      type: 'session.diff',
      properties: {
        diff: [
          { path: 'changed.ts', content: '+1' },
        ],
      },
    }, 'session-1');

    expect(capturedDiffs).toHaveLength(1);
    expect(capturedDiffs[0].path).toBe('changed.ts');
  });

  it('should call onToolEvent for permission.asked', () => {
    let capturedEvent: any = null;
    const dispatcher = createDispatcher({
      onToolEvent: (event: any) => { capturedEvent = event; },
    });

    dispatcher.dispatch({
      type: 'permission.asked',
      properties: {
        id: 'perm-123',
        permission: 'read',
        patterns: ['**/.env'],
        sessionId: 'sess-1',
      },
    }, 'session-1');

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent.type).toBe('permission');
    expect(capturedEvent.name).toBe('permission');
    expect(capturedEvent.meta?.permType).toBe('read');
  });

  it('should handle session.status idle', () => {
    const dispatcher = createDispatcher({});

    dispatcher.dispatch({
      type: 'session.status',
      properties: { status: { type: 'idle' } },
    }, 'session-idle');

    dispatcher.clearSession('session-idle');
  });
});

describe('EventDispatcher - tool events', () => {
  it('should emit tool_call event', () => {
    let toolName = '';
    let toolArgs: any = null;
    const dispatcher = new EventDispatcher({
      onToolCall: (name: string, args: any) => {
        toolName = name;
        toolArgs = args;
      },
    });

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'call-1',
          type: 'tool_call',
          name: 'grep',
          args: { pattern: 'TODO' },
        },
      },
    }, 'session-1');

    expect(toolName).toBe('grep');
    expect(toolArgs.pattern).toBe('TODO');
  });

  it('should emit tool_result completed', () => {
    let event: any = null;
    const dispatcher = new EventDispatcher({
      onToolEvent: (e) => { event = e; },
    });

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'result-1',
          type: 'tool',
          tool: 'task',
          state: { status: 'completed', result: 'done', metadata: { sessionId: 's-1' } },
        },
      },
    }, 'session-1');

    expect(event.status).toBe('completed');
    expect(event.meta?.sessionId).toBe('s-1');
  });

  it('should emit tool_result failed', () => {
    let event: any = null;
    const dispatcher = new EventDispatcher({
      onToolEvent: (e) => { event = e; },
      onError: () => {},
    });

    dispatcher.dispatch({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'fail-1',
          type: 'tool',
          tool: 'read',
          state: { status: 'failed', error: 'File not found' },
        },
      },
    }, 'session-1');

    expect(event.status).toBe('failed');
  });
});