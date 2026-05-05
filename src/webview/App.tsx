import React, { useState, useEffect, useRef } from 'react';
import { ChatContainer } from './components/ChatContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BottomInput } from './components/BottomInput';
import { ModelSelector } from './components/ModelSelector';
import { ModeSelector } from './components/ModeSelector';
import { ReviewActions } from './components/ReviewActions';
import { ProviderPopup } from './components/ProviderPopup';
import { ChatMessage, ExtensionToWebviewMessage, GitInfo, ProviderListResult } from '../extension/types';
import { postMessage, onMessage } from './vscode-api';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState('kimi-k2.6');
  const [mode, setMode] = useState('Build');
  const [busy, setBusy] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ branch: 'master', lastCommitTime: '55 dakika önce', projectPath: 'C:/Projects/opencode_sidebar' });
  const [review, setReview] = useState<{ filename: string; inserts: number; deletes: number } | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; providerId: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onMessage((msg: ExtensionToWebviewMessage) => {
      switch (msg.type) {
        case 'receiveMessage': {
          const newMsg: ChatMessage = { role: msg.payload.role, content: msg.payload.content, timestamp: Date.now(), id: Math.random().toString(36).slice(2) };
          if (msg.payload.role === 'assistant') newMsg.isStreaming = true;
          setMessages((prev) => [...prev, newMsg]);
          break;
        }
        case 'receiveChunk': {
          setMessages((prev) => {
            const lastIdx = prev.length - 1;
            if (lastIdx < 0) return prev;
            const last = prev[lastIdx];
            if (last.role !== 'assistant') return prev;
            const updated = [...prev];
            updated[lastIdx] = { ...last, content: msg.payload.fullContent || last.content + msg.payload.content, isStreaming: true };
            return updated;
          });
          break;
        }
        case 'streamEnd': {
          setMessages((prev) => {
            const lastIdx = prev.length - 1;
            if (lastIdx < 0) return prev;
            const updated = [...prev];
            updated[lastIdx] = { ...updated[lastIdx], isStreaming: false };
            return updated;
          });
          setBusy(false);
          break;
        }
        case 'status': setBusy(msg.payload.busy); break;
        case 'reviewReady': setReview(msg.payload); break;
        case 'reviewResolved': setReview(null); break;
        case 'gitInfo': setGitInfo(msg.payload); break;
        case 'error': {
          setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${msg.payload.message}`, timestamp: Date.now(), id: Math.random().toString(36).slice(2) }]);
          setBusy(false);
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
          setAvailableModels(models);
          break;
        }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => { postMessage({ type: 'listProviders' }); }, []);

  useEffect(() => {
    if (availableModels.length > 0) {
      const currentInList = availableModels.find((m) => m.id === model);
      if (!currentInList) {
        setModel(availableModels[0].id);
      }
    }
  }, [availableModels]);

  const handleSend = (prompt: string) => {
    setBusy(true);
    postMessage({ type: 'sendMessage', payload: { prompt, model } });
  };
  const handleAccept = () => { postMessage({ type: 'acceptReview' }); setReview(null); };
  const handleReject = () => { postMessage({ type: 'rejectReview' }); setReview(null); };
  const handleAbort = () => { postMessage({ type: 'abort' }); setBusy(false); };
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
        <BottomInput onSend={handleSend} disabled={busy} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 12px', backgroundColor: '#181825', borderTop: '1px solid #313244' }}>
          <ModeSelector mode={mode} onChange={setMode} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ModelSelector model={model} onChange={setModel} availableModels={availableModels} />
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
              title="Sağlayıcı Ayarları"
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
        />
      )}
    </div>
  );
}
