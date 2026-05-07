import { SSEMessage } from './SseStream';
import { NormalizedDiff, normalizeDiff } from '../utils/diffUtils';

export interface ToolEvent {
  id: string;
  type: string;
  name: string;
  status: string;
  content: string;
  meta?: any;
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
  onToolCall?: (name: string, args: any) => void;
  onError?: (error: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
  onMessageMeta?: (meta: MessageMeta) => void;
  onReasoning?: (text: string) => void;
  onDiffs?: (diffs: NormalizedDiff[]) => void;
}

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'list', 'webfetch']);

function extractReadPaths(tool: string, args: any): string[] {
  if (!args) return [];
  let a = args;
  if (typeof args === 'string') {
    try { a = JSON.parse(args); } catch { return []; }
  }
  switch (tool) {
    case 'read':
      if (a.path) return [a.path];
      if (Array.isArray(a)) return a.filter((x: any) => typeof x === 'string');
      return [];
    case 'grep':
      return a.include ? [a.include] : [];
    case 'glob':
      return a.pattern ? [a.pattern] : [];
    case 'list':
      return a.path ? [a.path] : [];
    case 'webfetch':
      return a.url ? [a.url] : [];
    default:
      return [];
  }
}

export class EventDispatcher {
  private callbacks: EventCallbacks;
  private sessionPartTypes: Map<string, Map<string, string>> = new Map();

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

  private handleMessageMeta(event: SSEMessage): void {
    const cb = this.callbacks;
    const info = event.properties?.info;
    if (info?.id && cb.onMessageMeta) {
      const agent = info.agent || undefined;
      const modelId = info.model ? `${info.model.providerID}/${info.model.modelID}` : undefined;
      const time = info.time ? { created: info.time.created, completed: info.time.completed } : undefined;
      if (agent || modelId || time) {
        cb.onMessageMeta!({ id: info.id, agent, modelId, time });
      }
    }
  }

  private handleMessagePartUpdated(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;
    const part = event.properties?.part;
    if (part?.id && part?.type) {
      const types = this.sessionPartTypes.get(sessionId);
      types?.set(part.id, part.type);
    }
    if (part?.type === 'text' || part?.type === 'reasoning') return;
    if (part?.type === 'compaction') {
      cb.onToolEvent?.({
        id: part.id || 'compaction',
        type: 'compacting',
        name: 'compaction',
        status: part?.state?.status === 'completed' ? 'completed' : 'running',
        content: part?.state?.status === 'completed' ? 'Conversation compacted' : 'Compacting conversation...',
        meta: { result: part?.result || part?.state?.result },
      });
      return;
    }
    if (part?.type === 'tool_call') {
      this.handleToolCallEvent(cb, part);
    }
    if (part?.type === 'tool') {
      this.handleToolStateEvent(cb, part);
    }
    if (part?.type === 'tool_result' && part?.result) {
      cb.onToolEvent?.({
        id: part.id || part.name || 'tool',
        type: 'tool_result',
        name: part.name || 'unknown',
        status: 'completed',
        content: `${part.name || 'unknown'} result`,
        meta: { result: part.result },
      });
      cb.onContent?.(`\n[Tool: ${part.name || 'unknown'}]\n${part.result}\n[/Tool]\n`);
    }
  }

  private handleToolCallEvent(cb: EventCallbacks, part: any): void {
    const toolName = part.name || 'unknown';
    const toolArgs = part.args;
    if (READ_TOOLS.has(toolName)) {
      const paths = extractReadPaths(toolName, toolArgs);
      for (const p of paths) {
        cb.onToolEvent?.({
          id: `${part.id || toolName}_read_${p}`,
          type: 'file_read',
          name: toolName,
          status: 'running',
          content: `Reading: ${p}`,
          meta: { path: p, tool: toolName },
        });
      }
    }
    cb.onToolEvent?.({
      id: part.id || part.name || 'tool',
      type: 'tool_call',
      name: toolName,
      status: 'running',
      content: `${toolName} calling...`,
      meta: { args: toolArgs },
    });
    cb.onToolCall?.(toolName, toolArgs);
  }

  private handleToolStateEvent(cb: EventCallbacks, part: any): void {
    const toolName = part?.tool || 'unknown';
    const status = part?.state?.status;
    if (status === 'running') {
      cb.onToolEvent?.({
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
      if (READ_TOOLS.has(toolName)) {
        const paths = extractReadPaths(toolName, part?.state?.input?.args || part?.args || toolResult);
        for (const p of paths) {
          cb.onToolEvent?.({
            id: `${part.id || toolName}_read_${p}`,
            type: 'file_read',
            name: toolName,
            status: 'completed',
            content: `Read: ${p}`,
            meta: { path: p, tool: toolName, result: toolResult },
          });
        }
      }
      cb.onToolEvent?.({
        id: part.id || toolName,
        type: 'tool_result',
        name: toolName,
        status: 'completed',
        content: toolName === 'task' ? 'Task completed' : `${toolName} completed`,
        meta,
      });
      if (toolResult) {
        cb.onContent?.(`\n[${toolName} result]\n${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}\n[/${toolName}]\n`);
      }
    } else if (status === 'failed') {
      if (READ_TOOLS.has(toolName)) {
        const paths = extractReadPaths(toolName, part?.state?.input?.args || part?.args);
        for (const p of paths) {
          cb.onToolEvent?.({
            id: `${part.id || toolName}_read_${p}`,
            type: 'file_read',
            name: toolName,
            status: 'failed',
            content: `Read failed: ${p}`,
            meta: { path: p, tool: toolName, error: part.state.error || part.state.reason },
          });
        }
      }
      cb.onToolEvent?.({
        id: part.id || toolName,
        type: 'tool_result',
        name: toolName,
        status: 'failed',
        content: `${toolName} failed`,
        meta: { error: part.state.error || part.state.reason },
      });
      cb.onError?.(`${toolName} failed: ${part.state.error || part.state.reason || 'unknown error'}`);
    }
  }

  private handleMessagePartDelta(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;
    const props = event.properties;
    if (props?.delta) {
      const types = this.sessionPartTypes.get(sessionId);
      const partType = props.partID ? types?.get(props.partID) : undefined;
      if (partType === 'reasoning') {
        cb.onReasoning?.(props.delta);
        return;
      }
      cb.onContent?.(props.delta);
    }
  }

  private handleSessionError(event: SSEMessage): void {
    this.callbacks.onError?.(event.properties?.error?.message || 'Unknown error');
  }

  private handleSessionStatus(event: SSEMessage, sessionId: string): void {
    if (event.properties?.status?.type === 'idle') {
      this.clearSession(sessionId);
    }
  }

  private handleMessageUpdated(event: SSEMessage): void {
    const cb = this.callbacks;
    const rawSummaryDiffs = event.properties?.info?.summary?.diffs;
    if (Array.isArray(rawSummaryDiffs) && rawSummaryDiffs.length > 0 && cb.onDiffs) {
      const normalized = rawSummaryDiffs.map(normalizeDiff);
      cb.onDiffs(normalized);
    }
  }

  private handleSessionDiff(event: SSEMessage): void {
    const cb = this.callbacks;
    const rawDiff = event.properties?.diff;
    if (Array.isArray(rawDiff) && rawDiff.length > 0 && cb.onDiffs) {
      const normalized = rawDiff.map(normalizeDiff);
      cb.onDiffs(normalized);
    }
  }

  private handlePermissionAsked(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;
    const permId = event.properties?.id || event.properties?.permissionID || event.properties?.permissionId;
    const permSessionId = event.properties?.sessionID || event.properties?.sessionId || sessionId;
    const permType = event.properties?.permission;
    const patterns = event.properties?.patterns || [];
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