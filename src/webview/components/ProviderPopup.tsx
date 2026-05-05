import React, { useState, useEffect, useRef } from 'react';
import { ProviderInfo, ProviderModel } from '../extension/types';
import { postMessage, onMessage } from '../vscode-api';

interface Props {
  onClose: () => void;
  onModelSelect?: (providerId: string, modelId: string) => void;
}

export function ProviderPopup({ onClose, onModelSelect }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>('opencode');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    postMessage({ type: 'listProviders' });
    const unsubscribe = onMessage((msg) => {
      switch (msg.type) {
        case 'providerList': {
          const result = msg.payload;
          const all: ProviderInfo[] = result.all || [];
          const conn: string[] = result.connected || [];
          const opencodeIdx = all.findIndex((p: ProviderInfo) => p.id === 'opencode');
          if (opencodeIdx > 0) {
            const [item] = all.splice(opencodeIdx, 1);
            all.unshift(item);
          }
          setProviders(all);
          setConnected(conn);
          break;
        }
        case 'providerUpdated': {
          const { providerId, success, error } = msg.payload;
          setSaving((prev) => ({ ...prev, [providerId]: false }));
          setMessages((prev) => ({ ...prev, [providerId]: success ? '✓ Kaydedildi' : `✗ ${error || 'Hata'}` }));
          if (success) setTimeout(() => setMessages((prev) => ({ ...prev, [providerId]: '' })), 2000);
          break;
        }
      }
    });
    return unsubscribe;
  }, []);

  const handleSave = (providerId: string) => {
    const key = apiKeys[providerId];
    if (!key) return;
    setSaving((prev) => ({ ...prev, [providerId]: true }));
    setMessages((prev) => ({ ...prev, [providerId]: 'Kaydediliyor...' }));
    postMessage({ type: 'setApiKey', payload: { providerId, key } });
  };

  const handleRemove = (providerId: string) => {
    setSaving((prev) => ({ ...prev, [providerId]: true }));
    postMessage({ type: 'removeApiKey', payload: { providerId } });
  };

  const getModels = (p: ProviderInfo): ProviderModel[] => Object.values(p.models || {});

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={popupRef}
        style={{
          backgroundColor: '#1e1e2e',
          border: '1px solid #313244',
          borderBottom: 'none',
          borderRadius: '16px 16px 0 0',
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#cdd6f4' }}>Sağlayıcılar</div>
            <div style={{ fontSize: 11, color: '#585b70', marginTop: 2 }}>
              {connected.length} / {providers.length} bağlı
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a6adc8', cursor: 'pointer', fontSize: 20, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {providers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: '#585b70', fontSize: 13 }}>
              Sağlayıcı bulunamadı. Opencode CLI kurulu olduğundan emin olun.
            </div>
          )}

          {providers.map((provider) => {
            const isConnected = connected.includes(provider.id);
            const models = getModels(provider);
            const isExpanded = expandedId === provider.id;

            return (
              <div
                key={provider.id}
                style={{
                  backgroundColor: '#181825',
                  borderRadius: 10,
                  border: `1px solid ${isConnected ? '#313244' : '#313244'}`,
                  marginBottom: 8,
                  overflow: 'hidden',
                }}
              >
                {/* Header Row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : provider.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: isConnected ? '#a6e3a1' : '#45475a', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#cdd6f4' }}>{provider.name}</span>
                    {isConnected && <span style={{ fontSize: 10, color: '#a6e3a1', backgroundColor: 'rgba(166,227,161,0.1)', padding: '1px 6px', borderRadius: 4 }}>BAĞLI</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#585b70' }}>{models.length} model</span>
                    <span style={{ fontSize: 10, color: '#585b70' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* API Key Input */}
                    <div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="password"
                          value={apiKeys[provider.id] || ''}
                          onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                          placeholder={isConnected ? 'Yeni API anahtarı...' : `${provider.name} API anahtarı`}
                          style={{
                            flex: 1,
                            padding: '7px 10px',
                            borderRadius: 6,
                            border: '1px solid #45475a',
                            backgroundColor: '#313244',
                            color: '#cdd6f4',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => handleSave(provider.id)}
                          disabled={saving[provider.id] || !apiKeys[provider.id]}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 6,
                            border: 'none',
                            backgroundColor: saving[provider.id] || !apiKeys[provider.id] ? '#45475a' : '#7c3aed',
                            color: '#fff',
                            cursor: saving[provider.id] || !apiKeys[provider.id] ? 'not-allowed' : 'pointer',
                            fontWeight: 500,
                            fontSize: 12,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {saving[provider.id] ? '...' : isConnected ? 'Güncelle' : 'Kaydet'}
                        </button>
                        {isConnected && (
                          <button
                            onClick={() => handleRemove(provider.id)}
                            disabled={saving[provider.id]}
                            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #45475a', backgroundColor: 'transparent', color: '#f38ba8', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                          >
                            Kaldır
                          </button>
                        )}
                      </div>
                      {messages[provider.id] && (
                        <div style={{ fontSize: 11, color: messages[provider.id].startsWith('✓') ? '#a6e3a1' : '#f38ba8', marginTop: 4 }}>
                          {messages[provider.id]}
                        </div>
                      )}
                    </div>

                    {/* Models */}
                    {models.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: '#a6adc8', marginBottom: 6, fontWeight: 500 }}>Kullanılabilir Modeller</div>
                        <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {models.map((model) => (
                            <div
                              key={`${provider.id}/${model.id}`}
                              onClick={() => onModelSelect?.(provider.id, model.id)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 6,
                                backgroundColor: '#1e1e2e',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#313244')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1e1e2e')}
                            >
                              <div style={{ fontSize: 12, color: '#cdd6f4' }}>{model.name || model.id}</div>
                              <div style={{ fontSize: 10, color: '#585b70' }}>
                                {model.limit?.context ? `${Math.round(model.limit.context / 1000)}K` : ''}
                                {model.capabilities?.reasoning ? ' 🧠' : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 16px', fontSize: 10, color: '#585b70', textAlign: 'center', borderTop: '1px solid #313244', flexShrink: 0 }}>
          API anahtarlarınız güvenli bir şekilde saklanır
        </div>
      </div>
    </div>
  );
}
