import React, { useState, useEffect, useRef } from 'react';
import { ChatContainer } from './components/ChatContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BottomInput } from './components/BottomInput';
import { ModelSelector } from './components/ModelSelector';
import { ModeSelector } from './components/ModeSelector';
import { ReviewActions } from './components/ReviewActions';
import { ProviderPopup } from './components/ProviderPopup';
import { SessionListPopup } from './components/SessionListPopup';
import { ChatMessage, ExtensionToWebviewMessage, GitInfo, ProviderListResult, ContextPart } from '../extension/types';
import { postMessage, onMessage } from './vscode-api';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('Build');
  const [busy, setBusy] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ branch: 'main', lastCommitTime: 'a minute ago', projectPath: 'C:/Projects/opencode_sidebar' });
  const [review, setReview] = useState<{ filename: string; inserts: number; deletes: number } | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; providerId: string }>>([]);
  const [hiddenModels, setHiddenModels] = useState<Record<string, boolean>>({});
  const [fileSearchResults, setFileSearchResults] = useState<Array<{ name: string; path: string }>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
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
        case 'reviewReady': setReview(msg.payload); break;
        case 'reviewResolved': setReview(null); break;
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
          const baseId = event.id || '';
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id && m.role === 'event' && m.id.startsWith(baseId) && baseId.length > 0);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                content: event.content,
                eventStatus: event.status,
                eventMeta: event.meta,
                timestamp: Date.now(),
              };
              return updated;
            }
            return [...prev, {
              role: 'event',
              content: event.content,
              timestamp: Date.now(),
              id: `${baseId}_${Date.now()}`,
              eventType: event.type,
              eventStatus: event.status,
              eventMeta: event.meta,
            }];
          });
          break;
        }
        case 'providerList': {
          const result: ProviderListResult = msg.payload;
          const all = result.all || [];
          const conn = result.connected || [];
          setProviderCount(all.length);
          setConnectedCount(conn.length);
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
            const aIsPinned = a.providerId === 'opencode' || a.providerId === 'opencode-go' ? 0 : 1;
            const bIsPinned = b.providerId === 'opencode' || b.providerId === 'opencode-go' ? 0 : 1;
            return aIsPinned - bIsPinned;
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
    postMessage({ type: 'sendMessage', payload: { prompt, model, mode, context } });
  };
  const handleAccept = () => { postMessage({ type: 'acceptReview' }); setReview(null); };
  const handleReject = () => { postMessage({ type: 'rejectReview' }); setReview(null); };
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
            <ChatContainer messages={messages} />
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

      {/* Review Actions */}
      {review && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #313244', backgroundColor: '#181825' }}>
          <ReviewActions filename={review.filename} inserts={review.inserts} deletes={review.deletes} onAccept={handleAccept} onReject={handleReject} />
        </div>
      )}

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
    </div>
  );
}
