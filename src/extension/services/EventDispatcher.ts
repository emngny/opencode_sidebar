import { SSEMessage } from './SseStream';
import { NormalizedDiff, normalizeDiff } from '../utils/diffUtils';
import { isRecord, ToolPart } from '../../shared/types';

export interface ToolEvent {
  id: string;
  type: string;
  name: string;
  status: string;
  content: string;
  meta?: Record<string, unknown>;
}

export interface MessageMeta {
  id: string;
  agent?: string;
  modelId?: string;
  time?: { created?: number; completed?: number };
}

/**
 * Callback interface for handling SSE events from the opencode server.
 * All callbacks are optional and called at appropriate points during streaming.
 */
export interface EventCallbacks {
  onContent?: (text: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
  onError?: (error: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
  onMessageMeta?: (meta: MessageMeta) => void;
  onReasoning?: (text: string) => void;
  onDiffs?: (diffs: NormalizedDiff[]) => void;
}

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'list', 'webfetch']);

function extractReadPaths(tool: string, args: unknown): string[] {
  if (!args) return [];
  let a: unknown = args;
  if (typeof args === 'string') {
    try { a = JSON.parse(args) as unknown; } catch { return []; }
  }
  if (!isRecord(a) && !Array.isArray(a)) return [];
  switch (tool) {
    case 'read': {
      if (isRecord(a) && typeof a['path'] === 'string') return [a['path'] as string];
      if (Array.isArray(a)) return (a as unknown[]).filter((x): x is string => typeof x === 'string');
      return [];
    }
    case 'grep':
      return isRecord(a) && typeof a['include'] === 'string' ? [a['include'] as string] : [];
    case 'glob':
      return isRecord(a) && typeof a['pattern'] === 'string' ? [a['pattern'] as string] : [];
    case 'list':
      return isRecord(a) && typeof a['path'] === 'string' ? [a['path'] as string] : [];
    case 'webfetch':
      return isRecord(a) && typeof a['url'] === 'string' ? [a['url'] as string] : [];
    default:
      return [];
  }
}

export class EventDispatcher {
  private readonly callbacks: EventCallbacks;
  private readonly sessionPartTypes: Map<string, Map<string, string>> = new Map();

  constructor(callbacks: EventCallbacks) {
    this.callbacks = callbacks;
  }

  resetSession(sessionId: string): void {
    this.sessionPartTypes.set(sessionId, new Map());
  }

  clearSession(sessionId: string): void {
    this.sessionPartTypes.delete(sessionId);
  }

  dispatch(event: SSEMessage, sessionId: string): void {
    const propsForSession = event.properties as Record<string, unknown>;
    const eventSessionIdRaw = propsForSession['sessionID'] ?? propsForSession['sessionId'];
    const eventSessionId = typeof eventSessionIdRaw === 'string' ? eventSessionIdRaw : undefined;
    // Only filter when the event explicitly belongs to a different session.
    // permission.asked carries its own sessionId that may differ from the
    // caller's sessionId — don't drop it.
    if (eventSessionId && eventSessionId !== sessionId && event.type !== 'permission.asked') return;
    this.handleMessageMeta(event);
    switch (event.type) {
      case 'message.part.updated':
        this.handleMessagePartUpdated(event, sessionId);
        break;
      case 'message.part.delta':
        this.handleMessagePartDelta(event, sessionId);
        break;
      case 'session.error':
        this.handleSessionError(event);
        break;
      case 'session.status':
        this.handleSessionStatus(event, sessionId);
        break;
      case 'message.updated':
        this.handleMessageUpdated(event);
        break;
      case 'session.diff':
        this.handleSessionDiff(event);
        break;
      case 'permission.asked':
        this.handlePermissionAsked(event, sessionId);
        break;
    }
  }

  /** Extracts agent, model, and timing metadata from message events. */
  private handleMessageMeta(event: SSEMessage): void {
    const cb = this.callbacks;
    const infoRaw = (event.properties as Record<string, unknown>)['info'];
    if (!isRecord(infoRaw) || typeof infoRaw['id'] !== 'string' || !cb.onMessageMeta) return;
    const agent = typeof infoRaw['agent'] === 'string' ? (infoRaw['agent'] as string) : undefined;
    const modelRaw = isRecord(infoRaw['model']) ? (infoRaw['model'] as Record<string, unknown>) : undefined;
    const modelId = modelRaw && typeof modelRaw['providerID'] === 'string' && typeof modelRaw['modelID'] === 'string'
      ? `${modelRaw['providerID'] as string}/${modelRaw['modelID'] as string}`
      : undefined;
    const timeRaw = isRecord(infoRaw['time']) ? (infoRaw['time'] as Record<string, unknown>) : undefined;
    const time = timeRaw
      ? {
          created: typeof timeRaw['created'] === 'number' ? (timeRaw['created'] as number) : undefined,
          completed: typeof timeRaw['completed'] === 'number' ? (timeRaw['completed'] as number) : undefined,
        }
      : undefined;
    if (agent || modelId || time) {
      cb.onMessageMeta!({ id: infoRaw['id'] as string, agent, modelId, time });
    }
  }

  /** Emits tool lifecycle transitions and normalizes tool result payloads. */
  private handleMessagePartUpdated(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;
    const partRaw = (event.properties as Record<string, unknown>)['part'];
    const part = isRecord(partRaw) ? (partRaw as Record<string, unknown>) : undefined;
    if (part && typeof part['id'] === 'string' && typeof part['type'] === 'string') {
      const types = this.sessionPartTypes.get(sessionId);
      types?.set(part['id'] as string, part['type'] as string);
    }
    const partType = part && typeof part['type'] === 'string' ? (part['type'] as string) : undefined;
    if (partType === 'text' || partType === 'reasoning') return;
    if (partType === 'compaction') {
      const state = isRecord(part?.['state']) ? (part?.['state'] as Record<string, unknown>) : undefined;
      cb.onToolEvent?.({
        id: typeof part?.['id'] === 'string' ? (part?.['id'] as string) : 'compaction',
        type: 'compacting',
        name: 'compaction',
        status: state?.['status'] === 'completed' ? 'completed' : 'running',
        content: state?.['status'] === 'completed' ? 'Conversation compacted' : 'Compacting conversation...',
        meta: { result: part?.['result'] ?? state?.['result'] },
      });
      return;
    }
    if (partType === 'tool_call' && part) {
      this.handleToolCallEvent(cb, part as unknown as ToolPart);
    }
    if (partType === 'tool' && part) {
      this.handleToolStateEvent(cb, part as unknown as ToolPart);
    }
    if (partType === 'tool_result' && part?.['result'] !== undefined) {
      const name = typeof part['name'] === 'string' ? (part['name'] as string) : 'unknown';
      const partId = typeof part['id'] === 'string' ? (part['id'] as string) : undefined;
      const partName = typeof part['name'] === 'string' ? (part['name'] as string) : undefined;
      const id = partId ?? partName ?? 'tool';
      cb.onToolEvent?.({
        id,
        type: 'tool_result',
        name,
        status: 'completed',
        content: `${name} result`,
        meta: { result: part['result'] },
      });
      const resultStr = typeof part['result'] === 'string' ? (part['result'] as string) : JSON.stringify(part['result']);
      cb.onContent?.(`\n[Tool: ${name}]\n${resultStr}\n[/Tool]\n`);
    }
  }

  private handleToolCallEvent(cb: EventCallbacks, part: ToolPart): void {
    const rec = part as Record<string, unknown>;
    const toolName = typeof rec['name'] === 'string' ? (rec['name'] as string) : 'unknown';
    const toolArgs: unknown = rec['args'];
    if (READ_TOOLS.has(toolName)) {
      const paths = extractReadPaths(toolName, toolArgs);
      for (const p of paths) {
        cb.onToolEvent?.({
          id: `${(rec['id'] as string) || toolName}_read_${p}`,
          type: 'file_read',
          name: toolName,
          status: 'running',
          content: `Reading: ${p}`,
          meta: { path: p, tool: toolName },
        });
      }
    }
    cb.onToolEvent?.({
      id: (rec['id'] as string) || (rec['name'] as string) || 'tool',
      type: 'tool_call',
      name: toolName,
      status: 'running',
      content: `${toolName} calling...`,
      meta: { args: toolArgs as string | number | boolean | null | undefined },
    });
    cb.onToolCall?.(toolName, toolArgs);
  }

  private handleToolStateEvent(cb: EventCallbacks, part: ToolPart): void {
    const rec = part as Record<string, unknown>;
    const toolName = typeof rec['tool'] === 'string' ? (rec['tool'] as string) : 'unknown';
    const state = isRecord(rec['state']) ? (rec['state'] as Record<string, unknown>) : undefined;
    const status = typeof state?.['status'] === 'string' ? (state['status'] as string) : undefined;
    const inputRec = isRecord(state?.['input']) ? (state['input'] as Record<string, unknown>) : undefined;
    const toolArgs: unknown = inputRec?.['args'] ?? rec['args'] ?? inputRec;
    if (status === 'running') {
      cb.onToolEvent?.({
        id: (rec['id'] as string) || toolName,
        type: 'tool_result',
        name: toolName,
        status: 'running',
        content: `${toolName} running...`,
        meta: { args: toolArgs },
      });
    } else if (status === 'completed') {
      const toolResult: unknown = rec['result'] ?? state?.['result'];
      const meta: Record<string, unknown> = { result: toolResult, args: toolArgs };
      if (toolName === 'task' && state) {
        const metadata = isRecord(state['metadata']) ? (state['metadata'] as Record<string, unknown>) : undefined;
        const input = inputRec;
        if (metadata?.['sessionId']) meta['sessionId'] = metadata['sessionId'];
        if (input?.['description']) meta['description'] = input['description'];
        if (input?.['subagent_type']) meta['subagentType'] = input['subagent_type'];
      }
      if (READ_TOOLS.has(toolName)) {
        const input = isRecord(state?.['input']) ? (state['input'] as Record<string, unknown>) : undefined;
        const paths = extractReadPaths(toolName, input?.['args'] ?? rec['args'] ?? toolResult);
        for (const p of paths) {
          cb.onToolEvent?.({
            id: `${(rec['id'] as string) || toolName}_read_${p}`,
            type: 'file_read',
            name: toolName,
            status: 'completed',
            content: `Read: ${p}`,
            meta: { path: p, tool: toolName, result: toolResult as string | number | boolean | null | undefined },
          });
        }
      }
      cb.onToolEvent?.({
        id: (rec['id'] as string) || toolName,
        type: 'tool_result',
        name: toolName,
        status: 'completed',
        content: toolName === 'task' ? 'Task completed' : `${toolName} completed`,
        meta,
      });
      if (toolResult !== undefined && toolResult !== null && toolResult !== '') {
        cb.onContent?.(`\n[${toolName} result]\n${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}\n[/${toolName}]\n`);
      }
    } else if (status === 'failed') {
      if (READ_TOOLS.has(toolName)) {
        const input = isRecord(state?.['input']) ? (state['input'] as Record<string, unknown>) : undefined;
        const paths = extractReadPaths(toolName, input?.['args'] ?? rec['args']);
        for (const p of paths) {
          cb.onToolEvent?.({
            id: `${(rec['id'] as string) || toolName}_read_${p}`,
            type: 'file_read',
            name: toolName,
            status: 'failed',
            content: `Read failed: ${p}`,
            meta: { path: p, tool: toolName, error: (state?.['error'] as string) || (state?.['reason'] as string) },
          });
        }
      }
      cb.onToolEvent?.({
        id: (rec['id'] as string) || toolName,
        type: 'tool_result',
        name: toolName,
        status: 'failed',
        content: `${toolName} failed`,
        meta: { error: (state?.['error'] as string) || (state?.['reason'] as string) },
      });
      cb.onError?.(`${toolName} failed: ${(state?.['error'] as string) || (state?.['reason'] as string) || 'unknown error'}`);
    }
  }

  /** Routes streaming deltas to reasoning or assistant content callbacks. */
  private handleMessagePartDelta(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;
    const props = event.properties as Record<string, unknown>;
    const delta = typeof props['delta'] === 'string' ? (props['delta'] as string) : undefined;
    if (delta) {
      const types = this.sessionPartTypes.get(sessionId);
      const partID = typeof props['partID'] === 'string' ? (props['partID'] as string) : undefined;
      const partType = partID ? types?.get(partID) : undefined;
      if (partType === 'reasoning') {
        cb.onReasoning?.(delta);
        return;
      }
      cb.onContent?.(delta);
    }
  }

  /** Forwards server-reported session errors to the error callback. */
  private handleSessionError(event: SSEMessage): void {
    const errRaw = (event.properties as Record<string, unknown>)['error'];
    const msg = isRecord(errRaw) && typeof errRaw['message'] === 'string' ? (errRaw['message'] as string) : 'Unknown error';
    this.callbacks.onError?.(msg);
  }

  /** Releases per-session stream state when server reports idle status. */
  private handleSessionStatus(event: SSEMessage, sessionId: string): void {
    const statusRaw = (event.properties as Record<string, unknown>)['status'];
    const type = isRecord(statusRaw) ? (statusRaw['type'] as string | undefined) : undefined;
    if (type === 'idle') {
      this.clearSession(sessionId);
    }
  }

  /** Emits normalized diffs embedded in updated message summaries. */
  private handleMessageUpdated(event: SSEMessage): void {
    const cb = this.callbacks;
    const infoRaw = (event.properties as Record<string, unknown>)['info'];
    const summaryRaw = isRecord(infoRaw) ? (infoRaw['summary'] as unknown) : undefined;
    const diffsRaw = isRecord(summaryRaw) ? ((summaryRaw as Record<string, unknown>)['diffs'] as unknown) : undefined;
    if (Array.isArray(diffsRaw) && diffsRaw.length > 0 && cb.onDiffs) {
      const normalized = (diffsRaw as unknown[]).map(normalizeDiff);
      cb.onDiffs(normalized);
    }
  }

  /** Emits normalized session-level file changes. */
  private handleSessionDiff(event: SSEMessage): void {
    const cb = this.callbacks;
    const rawDiff = (event.properties as Record<string, unknown>)['diff'];
    if (Array.isArray(rawDiff) && rawDiff.length > 0 && cb.onDiffs) {
      const normalized = (rawDiff as unknown[]).map(normalizeDiff);
      cb.onDiffs(normalized);
    }
  }

  /** Converts permission requests into UI tool events with decision metadata. */
  private handlePermissionAsked(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;
    const props = event.properties as Record<string, unknown>;
    const permId = (props['id'] as string | undefined) || (props['permissionID'] as string | undefined) || (props['permissionId'] as string | undefined);
    const permSessionId = (props['sessionID'] as string | undefined) || (props['sessionId'] as string | undefined) || sessionId;
    const permType = props['permission'] as string | undefined;
    const patternsRaw = props['patterns'];
    const patterns = Array.isArray(patternsRaw) ? (patternsRaw as unknown[]) : [];
    cb.onToolEvent?.({
      id: permId || 'permission',
      type: 'permission',
      name: 'permission',
      status: 'running',
      content: `${permType}${patterns.length > 0 ? ' ' + patterns.join(', ') : ''}`,
      meta: { permId, permSessionId, permType, patterns },
    });
  }
}