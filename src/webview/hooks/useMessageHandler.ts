import { useEffect, useRef } from 'react';
import {
  ExtensionToWebviewMessage,
  ChatMessage,
  ProviderListResult,
  ProviderModel,
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
  setFileSearchResults: React.Dispatch<React.SetStateAction<Array<{ name: string; path: string }>>>;
  setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  fileSearchRequestIdRef: React.MutableRefObject<string | null>;
  setRevertActive: React.Dispatch<React.SetStateAction<boolean>>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<{ message: string; onConfirm: () => void } | null>>;
  setReadPermissionPrompt: React.Dispatch<
    React.SetStateAction<{ filePath: string; reason: string; requestId: string } | null>
  >;
  setAgents: React.Dispatch<React.SetStateAction<string[]>>;
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
    setFileSearchResults,
    setFileSearchQuery,
    fileSearchRequestIdRef,
    setRevertActive,
    setConfirmDialog,
    setReadPermissionPrompt,
    setAgents,
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
          const { requestId, sessionId, fullContent } = msg.payload;
          if (!isCurrentRequest(requestId, sessionId)) break;
          if (fullContent !== undefined) {
            cleanupStreaming(requestId);
            flushPendingChunk(requestId);
            setMessages((prev) => {
              const index = requestId
                ? prev.findIndex((message) => message.role === 'assistant' && message.requestId === requestId)
                : prev.reduce((found, message, index) => (message.role === 'assistant' ? index : found), -1);
              if (index < 0) return prev;
              const updated = [...prev];
              updated[index] = { ...updated[index], content: fullContent, isStreaming: true };
              return updated;
            });
          } else if (requestId) {
            pendingChunkRef.current.set(
              requestId,
              (pendingChunkRef.current.get(requestId) || '') + msg.payload.content,
            );
            if (!chunkFlushTimerRef.current.has(requestId)) {
              chunkFlushTimerRef.current.set(
                requestId,
                setTimeout(() => {
                  chunkFlushTimerRef.current.delete(requestId);
                  if (isCurrentRequest(requestId, sessionId)) flushPendingChunk(requestId);
                }, DEBOUNCE_MS),
              );
            }
          }
          break;
        }
        case 'streamEnd': {
          const { requestId, sessionId } = msg.payload;
          if (!isCurrentRequest(requestId, sessionId)) break;
          cleanupStreaming(requestId);
          flushPendingChunk(requestId);
          setMessages((prev) => {
            const index = requestId
              ? prev.findIndex((message) => message.role === 'assistant' && message.requestId === requestId)
              : prev.reduce((found, message, index) => (message.role === 'assistant' ? index : found), -1);
            if (index < 0) return prev;
            const updated = [...prev];
            updated[index] = { ...updated[index], isStreaming: false };
            return updated;
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
          activeRequestIdRef.current = null;
          activeSessionIdRef.current = null;
          lastRequestIdRef.current = null;
          setMessages([]);
          const { messages: sessionMessages } = msg.payload;
          if (Array.isArray(sessionMessages)) {
            // SessionService already maps RawSessionMessage -> ChatMessage
            setMessages(sessionMessages as ChatMessage[]);
          }
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
          if (Array.isArray(agentArray) && agentArray.length > 0) {
            setAgents(agentArray);
          }
          setAgentModels(msg.payload.agentModels ?? {});
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      cleanupStreaming();
      flushPendingChunk();
    };
  }, [
    setMessages,
    setBusy,
    setContextEvents,
    pendingChunkRef,
    chunkFlushTimerRef,
    streamingMsgIdRef,
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
    setFileSearchResults,
    setFileSearchQuery,
    setRevertActive,
    setConfirmDialog,
    setReadPermissionPrompt,
    setAgents,
    processProviderList,
    tryAutoSelectModel,
  ]);
}
