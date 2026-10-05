import { useEffect, useRef } from 'react';
import {
  ExtensionToWebviewMessage,
  ChatMessage,
  CommandSummary,
  ProviderListResult,
  SavedModelPayload,
  isRecord,
} from '../../shared/types';
import { onMessage } from '../vscode-api';
import { ModelItem, ModelSwitch, buildModelItems } from './modelUtils';
import { genId } from './useChatState';

interface MessageHandlerState {
  // Chat state setters
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setContextEvents: React.Dispatch<
    React.SetStateAction<
      Array<{ id: string; name: string; status: string; content: string; meta?: Record<string, unknown> }>
    >
  >;
  // Streaming refs
  pendingChunkRef: React.MutableRefObject<Map<string, string>>;
  chunkFlushTimerRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  streamingMsgIdRef: React.MutableRefObject<Map<string, string>>;
  streamingStepRef: React.MutableRefObject<Map<string, string>>;
  DEBOUNCE_MS: number;
  flushPendingChunk: (requestId?: string) => void;
  cleanupStreaming: (requestId?: string) => void;
  // Model manager setters
  setModel: React.Dispatch<React.SetStateAction<string>>;
  setMode: React.Dispatch<React.SetStateAction<string>>;
  setGitInfo: React.Dispatch<React.SetStateAction<{ branch: string; lastCommitTime: string; projectPath: string }>>;
  setAvailableModels: React.Dispatch<React.SetStateAction<ModelItem[]>>;
  setAgentModels: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setHiddenModels: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setProvidersLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setSkills: React.Dispatch<React.SetStateAction<Array<{ name: string; description?: string }>>>;
  setCommands: React.Dispatch<React.SetStateAction<CommandSummary[]>>;
  setFileSearchResults: React.Dispatch<React.SetStateAction<Array<{ name: string; path: string }>>>;
  setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  fileSearchRequestIdRef: React.MutableRefObject<string | null>;
  setRevertActive: React.Dispatch<React.SetStateAction<boolean>>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<{ message: string; onConfirm: () => void } | null>>;
  setReadPermissionPrompt: React.Dispatch<
    React.SetStateAction<{ filePath: string; reason: string; requestId: string } | null>
  >;
  setAgents: React.Dispatch<React.SetStateAction<string[]>>;
  /** Marks the first `agentList` as the server's authoritative answer. */
  onAgentsLoaded: () => void;
  processProviderList: (result: ProviderListResult) => void;
  tryAutoSelectModel: (models: ModelItem[]) => ModelSwitch | null;
}

export function useMessageHandler(state: MessageHandlerState): void {
  const {
    setMessages,
    setBusy,
    setContextEvents,
    pendingChunkRef,
    chunkFlushTimerRef,
    streamingMsgIdRef,
    streamingStepRef,
    DEBOUNCE_MS,
    flushPendingChunk,
    cleanupStreaming,
    setModel,
    setMode,
    setGitInfo,
    setAvailableModels,
    setAgentModels,
    setHiddenModels,
    setProvidersLoaded,
    setSkills,
    setCommands,
    setFileSearchResults,
    setFileSearchQuery,
    fileSearchRequestIdRef,
    setRevertActive,
    setConfirmDialog,
    setReadPermissionPrompt,
    setAgents,
    onAgentsLoaded,
    processProviderList,
    tryAutoSelectModel,
  } = state;

  const activeRequestIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const lastRequestIdRef = useRef<string | null>(null);

  const isCurrentRequest = (requestId?: string, sessionId?: string): boolean => {
    if (requestId && activeRequestIdRef.current) return requestId === activeRequestIdRef.current;
    if (requestId && lastRequestIdRef.current) return requestId === lastRequestIdRef.current;
    if (sessionId && activeSessionIdRef.current) return sessionId === activeSessionIdRef.current;
    return true;
  };

  useEffect(() => {
    const processProviderListRef = { current: processProviderList };
    const tryAutoSelectRef = { current: tryAutoSelectModel };

    const unsubscribe = onMessage((msg: ExtensionToWebviewMessage) => {
      switch (msg.type) {
        case 'receiveMessage': {
          const { requestId, sessionId, role } = msg.payload;
          if (requestId && role !== 'user' && !isCurrentRequest(requestId, sessionId)) break;
          if (requestId && (role === 'user' || !activeRequestIdRef.current)) {
            activeRequestIdRef.current = requestId;
            activeSessionIdRef.current = sessionId || null;
            lastRequestIdRef.current = requestId;
          }
          const newMsg: ChatMessage = {
            role,
            content: msg.payload.content,
            timestamp: Date.now(),
            id: requestId || genId(),
            requestId,
            sessionId,
          };
          if (role === 'assistant') {
            newMsg.isStreaming = true;
            if (requestId) streamingMsgIdRef.current.set(requestId, newMsg.id!);
          }
          setMessages((prev) => [...prev, newMsg]);
          break;
        }
        case 'receiveChunk': {
          const { requestId, sessionId, content, messageId } = msg.payload;
          if (!isCurrentRequest(requestId, sessionId)) break;
          // Deltas go into the buffer, not the transcript: a state update per
          // token re-parses the whole markdown on every keypress. The debounce
          // in flushPendingChunk turns them into at most one render per 80ms.
          const bufferChunk = (key: string) => {
            pendingChunkRef.current.set(key, (pendingChunkRef.current.get(key) || '') + content);
            if (!chunkFlushTimerRef.current.has(key)) {
              chunkFlushTimerRef.current.set(
                key,
                setTimeout(() => {
                  chunkFlushTimerRef.current.delete(key);
                  if (isCurrentRequest(requestId, sessionId)) flushPendingChunk(key);
                }, DEBOUNCE_MS),
              );
            }
          };
          if (messageId) {
            const key = requestId || messageId;
            if (streamingStepRef.current.get(key) !== messageId) {
              // Step boundary: flush while streamingMsgIdRef still points at
              // the previous step's bubble, or its tail lands in this one.
              flushPendingChunk(key);
              streamingStepRef.current.set(key, messageId);
              setMessages((prev) => {
                const index = prev.findIndex(
                  (message) => message.role === 'assistant' && message.serverMessageId === messageId,
                );
                if (index >= 0) {
                  streamingMsgIdRef.current.set(key, prev[index].id!);
                  if (prev[index].isStreaming) return prev;
                  const updated = [...prev];
                  updated[index] = { ...updated[index], isStreaming: true };
                  return updated;
                }
                const created: ChatMessage = {
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  id: `srv_${messageId}`,
                  serverMessageId: messageId,
                  requestId,
                  sessionId,
                  isStreaming: true,
                };
                streamingMsgIdRef.current.set(key, created.id!);
                return [...prev, created];
              });
            }
            bufferChunk(key);
          } else if (requestId) {
            bufferChunk(requestId);
          }
          break;
        }
        case 'streamEnd': {
          const { requestId, sessionId } = msg.payload;
          if (!isCurrentRequest(requestId, sessionId)) break;
          // Flush before cleanup: cleanup drops the buffer, so the reverse
          // order would silently lose the turn's last 80ms of text.
          flushPendingChunk(requestId);
          cleanupStreaming(requestId);
          setMessages((prev) => {
            // A turn leaves one bubble per agent step and all of them are open
            // when it ends, so every one of them has to be closed here — not
            // just the first.
            let target = -1;
            if (!requestId)
              target = prev.reduce((found, message, index) => (message.role === 'assistant' ? index : found), -1);
            let changed = false;
            const updated = prev.map((message, index) => {
              const inTurn = requestId
                ? message.role === 'assistant' && message.requestId === requestId
                : index === target;
              if (!inTurn || !message.isStreaming) return message;
              changed = true;
              return { ...message, isStreaming: false };
            });
            return changed ? updated : prev;
          });
          if (requestId) streamingMsgIdRef.current.delete(requestId);
          activeRequestIdRef.current = null;
          activeSessionIdRef.current = null;
          setBusy(false);
          break;
        }
        case 'status': {
          setBusy(msg.payload.status === 'running');
          break;
        }
        case 'sessionLoaded': {
          cleanupStreaming();
          const { sessionId, messages, busy, activeRequestId } = msg.payload;
          // Reattach to the in-flight turn instead of starting a new one: the
          // payload is the whole transcript, so the id the server is still
          // streaming under has to become the active request here. Without it,
          // the next delta finds no target message and opens a duplicate bubble
          // for a turn that is already on screen.
          activeRequestIdRef.current = activeRequestId ?? null;
          lastRequestIdRef.current = activeRequestId ?? null;
          activeSessionIdRef.current = sessionId;
          // The webview remounts with `busy === false`, so a turn that is still
          // running server-side would render as finished without this.
          setBusy(busy === true);
          setMessages(Array.isArray(messages) ? (messages as ChatMessage[]) : []);
          break;
        }
        case 'gitInfo': {
          setGitInfo(msg.payload);
          break;
        }
        case 'projectInfo': {
          const payload = msg.payload as {
            project?: { path?: string };
            path?: { path?: string };
            vcs?: { branch?: string; message?: string };
          };
          const pathInfo = payload?.path;
          const project = payload?.project;
          const vcs = payload?.vcs;
          setGitInfo((prev) => ({
            projectPath: pathInfo?.path || project?.path || prev.projectPath,
            branch: vcs?.branch || prev.branch,
            lastCommitTime: vcs?.message || prev.lastCommitTime,
          }));
          break;
        }
        case 'error': {
          const { requestId, sessionId } = msg.payload;
          if (!isCurrentRequest(requestId, sessionId)) break;
          // Flush before cleanup, as in streamEnd: cleanup drops the buffer.
          flushPendingChunk(requestId);
          cleanupStreaming(requestId);
          const content = `❌ ${msg.payload.message}`;
          setMessages((prev) => {
            const index = requestId
              ? prev.findIndex((message) => message.role === 'assistant' && message.requestId === requestId)
              : prev.reduce((found, message, index) => (message.role === 'assistant' ? index : found), -1);
            // Reuse the empty streaming bubble so a failed turn never renders blank.
            if (index >= 0 && !prev[index].content) {
              const updated = [...prev];
              updated[index] = { ...updated[index], content, isStreaming: false };
              return updated;
            }
            return [...prev, { role: 'assistant', content, timestamp: Date.now(), id: genId(), requestId, sessionId }];
          });
          setBusy(false);
          break;
        }
        case 'savedModel': {
          if (msg.payload) {
            const modelStr = typeof msg.payload === 'string' ? msg.payload : (msg.payload as SavedModelPayload).model;
            if (modelStr) setModel(modelStr);
          }
          break;
        }
        case 'fileSearchResults': {
          if (msg.payload.requestId && msg.payload.requestId !== fileSearchRequestIdRef.current) break;
          setFileSearchResults(msg.payload.files || []);
          setFileSearchQuery(msg.payload.query || '');
          break;
        }
        case 'toolEvent': {
          const event = msg.payload;
          if (!isCurrentRequest(event.requestId, event.sessionId)) break;
          const eventId = event.id || `tool_${Date.now()}_${genId()}`;
          const isContextTool = ['read', 'glob', 'grep', 'list', 'webfetch', 'websearch', 'search'].includes(
            event.name,
          );
          if (isContextTool) {
            setContextEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === eventId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  status: event.status,
                  content: event.content || '',
                  meta: event.meta,
                };
                return updated;
              }
              return [
                ...prev,
                { id: eventId, name: event.name, status: event.status, content: event.content || '', meta: event.meta },
              ];
            });
          } else {
            setContextEvents([]);
            const baseId = event.id || '';
            setMessages((prev) => {
              const idx = prev.findIndex(
                (m) =>
                  m.role === 'event' &&
                  baseId.length > 0 &&
                  (m.id === baseId || m.id === `${baseId}_fixed` || m.id?.startsWith(baseId + '_')),
              );
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  content: event.content || '',
                  eventStatus: event.status as ChatMessage['eventStatus'],
                  eventMeta: event.meta as ChatMessage['eventMeta'],
                  eventCount: updated[idx].eventCount,
                  timestamp: Date.now(),
                };
                return updated;
              }
              // Merge identical consecutive events (e.g. repeated "bash completed")
              // into one card with a counter instead of flooding the chat.
              const last = prev.at(-1);
              const sameTool =
                !!last &&
                last.role === 'event' &&
                last.eventType === event.type &&
                last.eventStatus === event.status &&
                last.content === (event.content || '') &&
                JSON.stringify(last.eventMeta?.args ?? null) ===
                  JSON.stringify(
                    (isRecord(event.meta) ? (event.meta as Record<string, unknown>)['args'] : undefined) ?? null,
                  ) &&
                JSON.stringify(last.eventMeta?.result ?? null) ===
                  JSON.stringify(
                    (isRecord(event.meta) ? (event.meta as Record<string, unknown>)['result'] : undefined) ?? null,
                  );
              if (sameTool && last) {
                const updated = [...prev];
                updated[prev.length - 1] = { ...last, eventCount: (last.eventCount || 1) + 1, timestamp: Date.now() };
                return updated;
              }
              const msgId = baseId ? `${baseId}_${Date.now()}` : `event_${Date.now()}`;
              return [
                ...prev,
                {
                  role: 'event',
                  content: event.content || '',
                  timestamp: Date.now(),
                  id: msgId,
                  eventType: event.type as ChatMessage['eventType'],
                  eventStatus: event.status as ChatMessage['eventStatus'],
                  eventMeta: event.meta as ChatMessage['eventMeta'],
                },
              ];
            });
          }
          break;
        }
        case 'revertResult': {
          const { messages: sessionMessages, reverted, sessionId } = msg.payload;
          if (sessionId && !isCurrentRequest(undefined, sessionId)) break;
          setMessages([]);
          if (Array.isArray(sessionMessages)) {
            setMessages(sessionMessages as ChatMessage[]);
          }
          setRevertActive(reverted);
          break;
        }
        case 'messageMeta': {
          const meta = msg.payload;
          if (!isCurrentRequest(meta.requestId, meta.sessionId)) break;
          setMessages((prev) => {
            const index = meta.requestId
              ? prev.findIndex((message) => message.role === 'assistant' && message.requestId === meta.requestId)
              : prev.reduce(
                  (found, message, index) => (message.role === 'assistant' && !message.agent ? index : found),
                  -1,
                );
            if (index < 0) return prev;
            const updated = [...prev];
            const duration =
              meta.time?.completed && meta.time?.created
                ? Math.round((meta.time.completed - meta.time.created) / 1000)
                : undefined;
            updated[index] = {
              ...updated[index],
              agent: meta.agent,
              modelId: meta.modelId,
              requestedModelId: meta.requestedModel,
              duration,
            };
            return updated;
          });
          break;
        }
        case 'reasoningContent': {
          const payload = typeof msg.payload === 'string' ? { content: msg.payload } : msg.payload;
          if (!isCurrentRequest(payload.requestId, payload.sessionId)) break;
          const text = payload.content;
          if (typeof text !== 'string') break;
          const messageId = payload.messageId;
          if (messageId) {
            // Reasoning opens the step before its first text delta, so the
            // bubble is created here — it lands where the text will land.
            // Flush first so the previous step's tail is not left buffered
            // against a flush target this bubble is about to take over.
            if (payload.requestId) flushPendingChunk(payload.requestId);
            setMessages((prev) => {
              const index = prev.findIndex(
                (message) => message.role === 'assistant' && message.serverMessageId === messageId,
              );
              if (index >= 0) {
                const updated = [...prev];
                updated[index] = {
                  ...updated[index],
                  reasoning: (updated[index].reasoning || '') + text,
                  isStreaming: true,
                };
                return updated;
              }
              const created: ChatMessage = {
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                id: `srv_${messageId}`,
                serverMessageId: messageId,
                requestId: payload.requestId,
                sessionId: payload.sessionId,
                isStreaming: true,
                reasoning: text,
              };
              if (payload.requestId) streamingMsgIdRef.current.set(payload.requestId, created.id!);
              return [...prev, created];
            });
            break;
          }
          setMessages((prev) => {
            const index = payload.requestId
              ? prev.findIndex((message) => message.role === 'assistant' && message.requestId === payload.requestId)
              : prev.reduce((found, message, index) => (message.role === 'assistant' ? index : found), -1);
            if (index < 0) return prev;
            const updated = [...prev];
            updated[index] = { ...updated[index], reasoning: (updated[index].reasoning || '') + text };
            return updated;
          });
          break;
        }
        case 'skillList': {
          setSkills(msg.payload.skills || []);
          break;
        }
        case 'commandList': {
          // An empty array is the server's real answer, so it replaces the list
          // rather than leaving a stale one on screen.
          setCommands(msg.payload.commands || []);
          break;
        }
        case 'providerList': {
          const pl = processProviderListRef.current;
          pl(msg.payload);
          // Select a valid model, replacing a saved model the server no longer offers.
          const models = buildModelItems(msg.payload);
          const switched = tryAutoSelectRef.current(models);
          // Only report replacements. The very first pick has nothing to replace.
          if (switched?.from) {
            const label = (id: string) => models.find((model) => model.id === id)?.name || id || 'none';
            setMessages((prev) => [
              ...prev,
              {
                role: 'system',
                content: `Model "${label(switched.from)}" is no longer available. Switched to "${label(switched.to)}".`,
                timestamp: Date.now(),
                id: genId(),
              },
            ]);
          }
          break;
        }
        case 'readFilePrompt': {
          setReadPermissionPrompt({
            filePath: msg.payload.filePath,
            reason: msg.payload.reason || '',
            requestId: msg.payload.requestId || '',
          });
          break;
        }
        case 'agentList': {
          const agentArray = msg.payload.agents;
          // The list is the server's answer even when empty: an empty list means
          // "no session-owning agents", which must stop the mode reconciler from
          // treating the previous list as still current.
          onAgentsLoaded();
          if (Array.isArray(agentArray) && agentArray.length > 0) {
            setAgents(agentArray);
          } else {
            setAgents([]);
          }
          setAgentModels(msg.payload.agentModels ?? {});
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      flushPendingChunk();
      cleanupStreaming();
    };
  }, [
    setMessages,
    setBusy,
    setContextEvents,
    pendingChunkRef,
    chunkFlushTimerRef,
    streamingMsgIdRef,
    streamingStepRef,
    DEBOUNCE_MS,
    flushPendingChunk,
    cleanupStreaming,
    setModel,
    setMode,
    setGitInfo,
    setAvailableModels,
    setAgentModels,
    setHiddenModels,
    setProvidersLoaded,
    setSkills,
    setCommands,
    setFileSearchResults,
    setFileSearchQuery,
    setRevertActive,
    setConfirmDialog,
    setReadPermissionPrompt,
    setAgents,
    onAgentsLoaded,
    processProviderList,
    tryAutoSelectModel,
  ]);
}
