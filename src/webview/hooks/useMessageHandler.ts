import { useEffect, useRef } from 'react';
import { ExtensionToWebviewMessage, ChatMessage, ProviderListResult, SavedModelPayload } from '../../extension/types';
import { onMessage } from '../vscode-api';
import { ModelItem } from './useModelManager';
import { genId } from './useChatState';

interface MessageHandlerState {
  // Chat state setters
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setContextEvents: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; status: string; content: string; meta?: any }>>>;
  // Streaming refs
  pendingChunkRef: React.MutableRefObject<string>;
  chunkFlushTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamingMsgIdRef: React.MutableRefObject<string | null>;
  DEBOUNCE_MS: number;
  flushPendingChunk: () => void;
  cleanupStreaming: () => void;
  // Model manager setters
  setModel: React.Dispatch<React.SetStateAction<string>>;
  setMode: React.Dispatch<React.SetStateAction<string>>;
  setGitInfo: React.Dispatch<React.SetStateAction<{ branch: string; lastCommitTime: string; projectPath: string }>>;
  setAvailableModels: React.Dispatch<React.SetStateAction<ModelItem[]>>;
  setHiddenModels: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setProvidersLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setSkills: React.Dispatch<React.SetStateAction<Array<{ name: string; description?: string }>>>;
  setFileSearchResults: React.Dispatch<React.SetStateAction<Array<{ name: string; path: string }>>>;
  setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setRevertActive: React.Dispatch<React.SetStateAction<boolean>>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<{ message: string; onConfirm: () => void } | null>>;
  setReadPermissionPrompt: React.Dispatch<React.SetStateAction<{ filePath: string; reason: string; requestId: string } | null>>;
  setAgents: React.Dispatch<React.SetStateAction<string[]>>;
  processProviderList: (result: ProviderListResult) => void;
  tryAutoSelectModel: (models: ModelItem[], currentModel: string, hidden: Record<string, boolean>) => void;
}

export function useMessageHandler(state: MessageHandlerState): void {
  const {
    setMessages, setBusy, setContextEvents,
    pendingChunkRef, chunkFlushTimerRef, streamingMsgIdRef, DEBOUNCE_MS,
    flushPendingChunk, cleanupStreaming,
    setModel, setMode, setGitInfo, setAvailableModels, setHiddenModels,
    setProvidersLoaded, setSkills, setFileSearchResults, setFileSearchQuery,
    setRevertActive, setConfirmDialog, setReadPermissionPrompt, setAgents,
    processProviderList, tryAutoSelectModel,
  } = state;

  const streamEndedRef = useRef(false);

  useEffect(() => {
    const processProviderListRef = { current: processProviderList };
    const tryAutoSelectRef = { current: tryAutoSelectModel };

    const unsubscribe = onMessage((msg: ExtensionToWebviewMessage) => {
      switch (msg.type) {
        case 'receiveMessage': {
          streamEndedRef.current = false;
          const newMsg: ChatMessage = {
            role: msg.payload.role,
            content: msg.payload.content,
            timestamp: Date.now(),
            id: genId(),
          };
          if (msg.payload.role === 'assistant') newMsg.isStreaming = true;
          setMessages((prev) => {
            const updated = [...prev, newMsg];
            return updated;
          });
          break;
        }
        case 'receiveChunk': {
          if (streamEndedRef.current) break;
          if (msg.payload.fullContent) {
            cleanupStreaming();
            flushPendingChunk();
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = prev.findIndex((m, i) => i === prev.length - 1 && m.role === 'assistant');
              if (lastIdx >= 0) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: msg.payload.fullContent || '',
                  isStreaming: true,
                };
              } else {
                const newId = genId();
                streamingMsgIdRef.current = newId;
                updated.push({
                  role: 'assistant',
                  content: msg.payload.fullContent || '',
                  timestamp: Date.now(),
                  id: newId,
                  isStreaming: true,
                });
              }
              return updated;
            });
          } else {
            pendingChunkRef.current += msg.payload.content || '';
            if (!chunkFlushTimerRef.current) {
              chunkFlushTimerRef.current = setTimeout(() => {
                chunkFlushTimerRef.current = null;
                if (!streamEndedRef.current) flushPendingChunk();
              }, DEBOUNCE_MS);
            }
          }
          break;
        }
        case 'streamEnd': {
          streamEndedRef.current = true;
          cleanupStreaming();
          flushPendingChunk();
          streamingMsgIdRef.current = null;
          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'assistant') {
                const updated = [...prev];
                updated[i] = { ...updated[i], isStreaming: false };
                return updated;
              }
            }
            return prev;
          });
          setBusy(false);
          break;
        }
        case 'status': {
          setBusy(msg.payload.status === 'running');
          break;
        }
        case 'sessionLoaded': {
          setMessages([]);
          const { messages: sessionMessages } = msg.payload;
          if (Array.isArray(sessionMessages)) {
            const converted: ChatMessage[] = sessionMessages.map((m: any) => ({
              role: m.info?.role === 'user' ? 'user' : 'assistant',
              content: m.parts?.map((p: any) => p.text || p.content || '').join('\n') || m.info?.content || '',
              timestamp: m.info?.time?.created || Date.now(),
              id: m.info?.id || genId(),
            }));
            setMessages(converted);
          }
          break;
        }
        case 'gitInfo': {
          setGitInfo(msg.payload);
          break;
        }
        case 'projectInfo': {
          const payload = msg.payload as { project?: any; path?: any; vcs?: any };
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
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `❌ ${msg.payload.message}`, timestamp: Date.now(), id: genId() },
          ]);
          setBusy(false);
          break;
        }
        case 'savedModel': {
          if (msg.payload) {
            const modelStr = typeof msg.payload === 'string'
              ? msg.payload
              : (msg.payload as SavedModelPayload).model;
            if (modelStr) setModel(modelStr);
          }
          break;
        }
        case 'fileSearchResults': {
          setFileSearchResults(msg.payload.files || []);
          setFileSearchQuery(msg.payload.query || '');
          break;
        }
        case 'toolEvent': {
          const event = msg.payload;
          const eventId = event.id || `tool_${Date.now()}_${genId()}`;
          const isContextTool = ['read', 'glob', 'grep', 'list', 'webfetch', 'websearch', 'search'].includes(event.name);
          if (isContextTool) {
            setContextEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === eventId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], status: event.status, content: event.content || '', meta: event.meta };
                return updated;
              }
              return [...prev, { id: eventId, name: event.name, status: event.status, content: event.content || '', meta: event.meta }];
            });
          } else {
            setContextEvents([]);
            const baseId = event.id || '';
            setMessages((prev) => {
              const idx = prev.findIndex((m) =>
                m.role === 'event' &&
                baseId.length > 0 &&
                (m.id === baseId || m.id === `${baseId}_fixed` || (m.id && m.id.startsWith(baseId + '_')))
              );
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], content: event.content || '', eventStatus: event.status as ChatMessage['eventStatus'], eventMeta: event.meta, timestamp: Date.now() };
                return updated;
              }
              const msgId = baseId ? `${baseId}_${Date.now()}` : `event_${Date.now()}`;
              return [...prev, { role: 'event', content: event.content || '', timestamp: Date.now(), id: msgId, eventType: event.type as ChatMessage['eventType'], eventStatus: event.status as ChatMessage['eventStatus'], eventMeta: event.meta }];
            });
          }
          break;
        }
        case 'revertResult': {
          const { messages: sessionMessages, reverted } = msg.payload;
          setMessages([]);
          if (Array.isArray(sessionMessages)) {
            const converted: ChatMessage[] = sessionMessages.map((m: any) => ({
              role: m.info?.role === 'user' ? 'user' : 'assistant',
              content: m.parts?.map((p: any) => p.text || p.content || '').join('\n') || m.info?.content || '',
              timestamp: m.info?.time?.created || Date.now(),
              id: m.info?.id || genId(),
            }));
            setMessages(converted);
          }
          setRevertActive(reverted);
          break;
        }
        case 'messageMeta': {
          const meta = msg.payload;
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'assistant' && !updated[i].agent) {
                const duration = meta.time?.completed && meta.time?.created
                  ? Math.round((meta.time.completed - meta.time.created) / 1000)
                  : undefined;
                updated[i] = { ...updated[i], agent: meta.agent, modelId: meta.modelId, duration };
                break;
              }
            }
            return updated;
          });
          break;
        }
        case 'reasoningContent': {
          const text = msg.payload;
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'assistant') {
                updated[i] = { ...updated[i], reasoning: (updated[i].reasoning || '') + text };
                break;
              }
            }
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
          // Auto-select first model if none selected
          const all = msg.payload.all || [];
          const conn = msg.payload.connected || [];
          const ta = tryAutoSelectRef.current;
          setModel((currentModel) => {
            setHiddenModels((hidden) => {
              const models: ModelItem[] = [];
              for (const provider of all) {
                if (conn.includes(provider.id)) {
                  for (const [modelId, modelInfo] of Object.entries(provider.models || {})) {
                    models.push({
                      id: `${provider.id}/${modelId}`,
                      name: (modelInfo as any).name || modelId,
                      providerId: provider.id,
                    });
                  }
                }
              }
              ta(models, currentModel, hidden);
              return hidden; // unchanged
            });
            return currentModel; // unchanged
          });
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
    setMessages, setBusy, setContextEvents,
    pendingChunkRef, chunkFlushTimerRef, streamingMsgIdRef, DEBOUNCE_MS,
    flushPendingChunk, cleanupStreaming,
    setModel, setMode, setGitInfo, setAvailableModels, setHiddenModels,
    setProvidersLoaded, setSkills, setFileSearchResults, setFileSearchQuery,
    setRevertActive, setConfirmDialog, setReadPermissionPrompt, setAgents,
    processProviderList, tryAutoSelectModel,
  ]);
}
