import { SSEMessage } from './SseStream';

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

/**
 * Normalized file diff with parsed line counts and content.
 */
export interface NormalizedDiff {
  path: string;
  added: number;
  deleted: number;
  content: string;
}

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'list', 'webfetch']);

function extractReadPaths(tool: string, args: any): string[] {
  if (!args) return [];
  const a = typeof args === 'string' ? JSON.parse(args) : args;
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

function normalizeDiff(d: any): NormalizedDiff {
  const path = d.path || d.file || '';
  const content = d.content || d.patch || '';
  let added = typeof d.added === 'number' ? d.added : 0;
  let deleted = typeof d.deleted === 'number' ? d.deleted : 0;
  if (added === 0 && deleted === 0 && content) {
    for (const line of content.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) deleted++;
    }
  }
  return { path, added, deleted, content };
}

export class EventDispatcher {
  private callbacks: EventCallbacks;
  private sessionPartDeltas: Map<string, Set<string>> = new Map();
  private sessionPartTypes: Map<string, Map<string, string>> = new Map();

  constructor(callbacks: EventCallbacks) {
    this.callbacks = callbacks;
  }

  resetSession(sessionId: string): void {
    this.sessionPartDeltas.set(sessionId, new Set());
    this.sessionPartTypes.set(sessionId, new Map());
  }

  dispatch(event: SSEMessage, sessionId: string): void {
    const cb = this.callbacks;

    // Track message metadata from event info
    const info = event.properties?.info;
    if (info?.id && cb.onMessageMeta) {
      const agent = info.agent || undefined;
      const modelId = info.model ? `${info.model.providerID}/${info.model.modelID}` : undefined;
      const time = info.time ? { created: info.time.created, completed: info.time.completed } : undefined;
      if (agent || modelId || time) {
        cb.onMessageMeta!({ id: info.id, agent, modelId, time });
      }
    }

    switch (event.type) {
      case 'message.part.updated': {
        const part = event.properties?.part;
        if (part?.id && part?.type) {
          const types = this.sessionPartTypes.get(sessionId);
          types?.set(part.id, part.type);
        }
        if (part?.type === 'text') break;
        if (part?.type === 'reasoning') break;
        if (part?.type === 'compaction') {
          cb.onToolEvent?.({
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
          const toolName = part.name || 'unknown';
          const toolArgs = part.args;
          const readTools = ['read', 'grep', 'glob', 'list', 'webfetch'];
          if (readTools.includes(toolName)) {
            const paths = extractReadPaths(toolName, toolArgs);
            if (paths.length > 0) {
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
        if (part?.type === 'tool') {
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
        break;
      }
      case 'message.part.delta': {
        const props = event.properties;
        if (props?.field === 'text' && props?.delta) {
          const types = this.sessionPartTypes.get(sessionId);
          const partType = props.partID ? types?.get(props.partID) : undefined;
          if (partType === 'reasoning') {
            cb.onReasoning?.(props.delta);
            break;
          }
          const deltas = this.sessionPartDeltas.get(sessionId);
          if (deltas && props.partID) deltas.add(props.partID);
          cb.onContent?.(props.delta);
        }
        break;
      }
      case 'session.error': {
        cb.onError?.(event.properties?.error?.message || 'Unknown error');
        break;
      }
      case 'session.status': {
        // idle status handled by caller
        break;
      }
      case 'message.updated': {
        const rawSummaryDiffs = event.properties?.info?.summary?.diffs;
        if (Array.isArray(rawSummaryDiffs) && rawSummaryDiffs.length > 0 && cb.onDiffs) {
          const normalized = rawSummaryDiffs.map(normalizeDiff);
          console.log('[opencode] Diffs from message.updated:', normalized.length, 'files');
          cb.onDiffs(normalized);
        }
        break;
      }
      case 'session.diff': {
        const rawDiff = event.properties?.diff;
        if (Array.isArray(rawDiff) && rawDiff.length > 0 && cb.onDiffs) {
          const normalized = rawDiff.map(normalizeDiff);
          console.log('[opencode] Diffs from session.diff:', normalized.length, 'files');
          cb.onDiffs(normalized);
        }
        break;
      }
      case 'permission.asked': {
        const permId = event.properties?.id || event.properties?.permissionID || event.properties?.permissionId;
        const permSessionId = event.properties?.sessionID || event.properties?.sessionId || sessionId;
        const permType = event.properties?.permission;
        const patterns = event.properties?.patterns || [];
        console.log('[opencode] Permission asked:', permType, patterns, 'id:', permId, 'session:', permSessionId);
        cb.onToolEvent?.({
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
}