import React, { useState, useEffect, useRef } from 'react';
import { ChatContainer } from './components/ChatContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BottomInput } from './components/BottomInput';
import { ModelSelector } from './components/ModelSelector';
import { ModeSelector } from './components/ModeSelector';
import { ProviderPopup } from './components/ProviderPopup';
import { SessionListPopup } from './components/SessionListPopup';
import { ChatMessage, ExtensionToWebviewMessage, GitInfo, ProviderListResult, ContextPart } from '../extension/types';
import { ConfirmDialog } from './components/ConfirmDialog';
import { postMessage, onMessage } from './vscode-api';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('Build');
  const [busy, setBusy] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [showSessions, setShowSessions] = useState(false);

  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ branch: 'main', lastCommitTime: 'a minute ago', projectPath: 'C:/Projects/opencode_sidebar' });
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; providerId: string }>>([]);
  const [hiddenModels, setHiddenModels] = useState<Record<string, boolean>>({});
  const [fileSearchResults, setFileSearchResults] = useState<Array<{ name: string; path: string }>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [revertActive, setRevertActive] = useState(false);
  const [currentMeta, setCurrentMeta] = useState<{ id: string; agent?: string; modelId?: string; time?: { created?: number; completed?: number } } | null>(null);
  // Context group: accumulates read/glob/grep/list/search tools
  const [contextEvents, setContextEvents] = useState<Array<{ id: string; name: string; status: string; content: string; meta?: any }>>([]);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const pendingRevertRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onMessage((msg: ExtensionToWebviewMessage) => {
      switch (msg.type) {
        case 'receiveMessage': {
          const newMsg: ChatMessage = { role: msg.payload.role, content: msg.payload.content, timestamp: Date.now(), id: Math.random().toString(36).slice(2) };
          if (msg.payload.role === 'assistant') newMsg.isStreaming = true;
          setMessages((prev) => {
            const updated = [...prev, newMsg];
            console.log('[webview] Messages updated, new count:', updated.length);
            return updated;
          });
          break;
        }
        case 'receiveChunk': {
          setMessages((prev) => {
            let lastAssistantIdx = -1;
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
              }
            }
            const updated = [...prev];
            if (lastAssistantIdx < 0) {
              // No assistant message yet - create one (race condition fix)
              updated.push({
                role: 'assistant',
                content: msg.payload.fullContent || msg.payload.content || '',
                timestamp: Date.now(),
                id: Math.random().toString(36).slice(2),
                isStreaming: true,
              });
            } else {
              updated[lastAssistantIdx] = {
                ...updated[lastAssistantIdx],
                content: msg.payload.fullContent || updated[lastAssistantIdx].content + (msg.payload.content || ''),
                isStreaming: true,
              };
            }
            return updated;
          });
          break;
        }
        case 'streamEnd': {
          setMessages((prev) => {
            // Find the last assistant message to mark as not streaming
            let lastAssistantIdx = -1;
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
              }
            }
            if (lastAssistantIdx < 0) return prev;
            const updated = [...prev];
            updated[lastAssistantIdx] = { ...updated[lastAssistantIdx], isStreaming: false };
            return updated;
          });
          setBusy(false);
          break;
        }
        case 'status': setBusy(msg.payload.busy); break;
        case 'sessionLoaded': {
          setMessages([]);
          const { messages: sessionMessages } = msg.payload;
          if (Array.isArray(sessionMessages)) {
            const converted: ChatMessage[] = sessionMessages.map((m: any) => ({
              role: m.info?.role === 'user' ? 'user' : 'assistant',
              content: m.parts?.map((p: any) => p.text || p.content || '').join('\n') || m.info?.content || '',
              timestamp: m.info?.time?.created || Date.now(),
              id: m.info?.id || Math.random().toString(36).slice(2),
            }));
            setMessages(converted);
          }
          break;
        }
        case 'gitInfo': setGitInfo(msg.payload); break;
        case 'projectInfo': {
          const { project, path: pathInfo, vcs } = msg.payload;
          setGitInfo({
            projectPath: pathInfo?.path || project?.path || gitInfo.projectPath,
            branch: vcs?.branch || gitInfo.branch,
            lastCommitTime: vcs?.message || gitInfo.lastCommitTime,
          });
          break;
        }
        case 'error': {
          setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${msg.payload.message}`, timestamp: Date.now(), id: Math.random().toString(36).slice(2) }]);
          setBusy(false);
          break;
        }
        case 'savedModel': {
          if (msg.payload) setModel(msg.payload);
          break;
        }
        case 'fileSearchResults': {
          setFileSearchResults(msg.payload.files || []);
          setFileSearchQuery(msg.payload.query || '');
          break;
        }
        case 'toolEvent': {
          const event = msg.payload;
          const isContextTool = ['read', 'glob', 'grep', 'list', 'webfetch', 'websearch', 'search'].includes(event.name);
          if (isContextTool) {
            setContextEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === event.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], status: event.status, content: event.content, meta: event.meta };
                return updated;
              }
              return [...prev, { id: event.id, name: event.name, status: event.status, content: event.content, meta: event.meta }];
            });
          } else {
            setContextEvents([]); // clear context group when non-context event arrives
            const baseId = event.id || '';
            setMessages((prev) => {
              // Find exact match first, then fall back to startsWith for legacy/compat
              const idx = prev.findIndex((m) => 
                m.role === 'event' && 
                baseId.length > 0 && 
                (m.id === baseId || m.id === `${baseId}_fixed` || (m.id && m.id.startsWith(baseId + '_')))
              );
              
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], content: event.content, eventStatus: event.status, eventMeta: event.meta, timestamp: Date.now() };
                return updated;
              }
              // Use baseId as the primary ID if provided, to ensure updates find it
              const msgId = baseId ? `${baseId}_${Date.now()}` : `event_${Date.now()}`;
              return [...prev, { role: 'event', content: event.content, timestamp: Date.now(), id: msgId, eventType: event.type, eventStatus: event.status, eventMeta: event.meta }];
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
              id: m.info?.id || Math.random().toString(36).slice(2),
            }));
            setMessages(converted);
          }
          setRevertActive(reverted);
          break;
        }
        case 'messageMeta': {
          const meta = msg.payload;
          setCurrentMeta(meta);
          // Apply metadata to the last assistant message that doesn't have it yet
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
        case 'providerList': {
          const result: ProviderListResult = msg.payload;
          const all = result.all || [];
          const conn = result.connected || [];
          const models: Array<{ id: string; name: string; providerId: string }> = [];
          for (const provider of all) {
            if (conn.includes(provider.id)) {
              for (const [modelId, modelInfo] of Object.entries(provider.models || {})) {
                models.push({
                  id: `${provider.id}/${modelId}`,
                  name: modelInfo.name || modelId,
                  providerId: provider.id,
                });
              }
            }
          }
          models.sort((a, b) => {
            // Pinned providers first
            const aIsPinned = a.providerId === 'opencode' || a.providerId === 'opencode-go' ? 0 : 1;
            const bIsPinned = b.providerId === 'opencode' || b.providerId === 'opencode-go' ? 0 : 1;
            if (aIsPinned !== bIsPinned) return aIsPinned - bIsPinned;
            // Same provider: sort by name alphabetically
            if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
            return a.name.localeCompare(b.name);
          });

          // Auto-select first model if none is selected
          if (!model) {
            const visibleModels = models.filter((m) => !hiddenModels[m.id]);
            if (visibleModels.length > 0) {
              setModel(visibleModels[0].id);
            }
          }

          setAvailableModels(models);
          setProvidersLoaded(true);
          break;
        }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => { postMessage({ type: 'listProviders' }); postMessage({ type: 'getSavedModel' }); }, []);

  // Save model when it changes
  useEffect(() => {
    if (model) {
      postMessage({ type: 'saveModel', payload: { model } });
    }
  }, [model]);

  const handleSend = (prompt: string, context?: ContextPart[]) => {
    console.log('[webview] Sending prompt:', prompt, 'context:', context?.length || 0, 'items');
    setBusy(true);
    setContextEvents([]);
    postMessage({ type: 'sendMessage', payload: { prompt, model, mode, context } });
  };
  const handleOpenDiff = (filePath: string) => {
    postMessage({ type: 'openDiff', payload: { filePath } });
  };
  const toggleModelVisibility = (modelId: string) => { setHiddenModels((prev) => ({ ...prev, [modelId]: !prev[modelId] })); };
  const handleToggleAllModels = (providerId: string, show: boolean) => {
    setHiddenModels((prev) => {
      const next = { ...prev };
      for (const model of availableModels) {
        if (model.providerId === providerId) {
          if (show) delete next[model.id];
          else next[model.id] = true;
        }
      }
      return next;
    });
  };
  const handleAbort = () => { postMessage({ type: 'abort' }); setBusy(false); };
  const handleRevert = (messageId: string) => {
    pendingRevertRef.current = messageId;
    setConfirmDialog({
      message: 'Revert to this message? This will undo all file changes made after it.',
      onConfirm: () => {
        const id = pendingRevertRef.current;
        pendingRevertRef.current = null;
        if (id) postMessage({ type: 'revertMessage', payload: { messageId: id } });
      },
    });
  };
  const handleUnrevert = () => {
    postMessage({ type: 'unrevert' });
  };
  const handleRespondPermission = (permId: string, permSessionId: string, response: string, remember?: boolean) => {
    postMessage({ type: 'respondPermission', payload: { permId, permSessionId, response, remember } });
  };
  const handleLoadSession = (sessionId: string) => {
    setMessages([]);
    setShowSessions(false);
    postMessage({ type: 'loadSession', payload: { sessionId } });
  };
  const showWelcome = messages.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#1e1e2e', position: 'relative' }}>
      {/* Main Content */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {showWelcome ? (
          <WelcomeScreen projectPath={gitInfo.projectPath} branch={gitInfo.branch} lastCommitTime={gitInfo.lastCommitTime} />
        ) : (
          <div style={{ flex: 1, padding: '16px 12px' }}>
            <ChatContainer messages={messages} onRevert={handleRevert} revertActive={revertActive} onUnrevert={handleUnrevert} contextEvents={contextEvents} onLoadSession={handleLoadSession} onRespondPermission={handleRespondPermission} onOpenDiff={handleOpenDiff} />
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Busy Indicator */}
      {busy && (
        <div style={{ padding: '8px 16px', fontSize: 12, color: '#89b4fa', backgroundColor: '#181825', textAlign: 'center', borderTop: '1px solid #313244' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#89b4fa', marginRight: 8, animation: 'pulse 1s infinite', verticalAlign: 'middle' }} />
          Processing...
          <button onClick={handleAbort} style={{ marginLeft: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid #45475a', backgroundColor: 'transparent', color: '#f38ba8', cursor: 'pointer', fontSize: 11 }}>Abort</button>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      {/* Bottom Bar: Input + Bottom Row */}
      <div>
        <BottomInput
          onSend={handleSend}
          disabled={busy}
          onSearchFiles={(query) => postMessage({ type: 'searchFiles', payload: { query } })}
          fileSearchResults={fileSearchResults}
          fileSearchQuery={fileSearchQuery}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 12px', backgroundColor: '#181825', borderTop: '1px solid #313244' }}>
          <ModeSelector mode={mode} onChange={setMode} />
           <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setShowSessions(true)}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#585b70',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#cdd6f4')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#585b70')}
              title="Session History"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {providersLoaded ? (
              <ModelSelector model={model} onChange={setModel} availableModels={availableModels.filter(m => !hiddenModels[m.id])} />
            ) : (
              <span style={{ fontSize: 11, color: '#585b70', padding: '4px 8px' }}>Loading...</span>
            )}
            <button
              onClick={() => setShowProviders(true)}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: showProviders ? '#89b4fa' : '#585b70',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#cdd6f4')}
              onMouseLeave={(e) => (e.currentTarget.style.color = showProviders ? '#89b4fa' : '#585b70')}
              title="Provider Settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Provider Popup */}
      {showProviders && (
        <ProviderPopup
          onClose={() => { setShowProviders(false); postMessage({ type: 'listProviders' }); }}
          onModelSelect={(providerId, modelId) => { setModel(`${providerId}/${modelId}`); setShowProviders(false); }}
          availableModels={availableModels}
          hiddenModels={hiddenModels}
          onToggleModel={toggleModelVisibility}
          onToggleAllModels={handleToggleAllModels}
        />
      )}

      {/* Session List Popup */}
      {showSessions && (
        <SessionListPopup
          onClose={() => setShowSessions(false)}
          onSelect={handleLoadSession}
        />
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
