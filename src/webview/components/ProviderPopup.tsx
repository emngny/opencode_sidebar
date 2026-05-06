import React, { useState, useEffect, useRef } from 'react';
import { ProviderInfo, ProviderModel } from '../../extension/types';
import { postMessage, onMessage } from '../vscode-api';

interface Props {
  readonly onClose: () => void;
  readonly onModelSelect?: (providerId: string, modelId: string) => void;
  readonly availableModels: Array<{ id: string; name: string; providerId: string }>;
  readonly hiddenModels: Record<string, boolean>;
  readonly onToggleModel: (modelId: string) => void;
  readonly onToggleAllModels?: (providerId: string, show: boolean) => void;
}

export function ProviderPopup({ onClose, onModelSelect, availableModels, hiddenModels, onToggleModel, onToggleAllModels }: Props) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'models' | 'providers'>('models');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
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

  const filteredModels = availableModels.filter(
    (m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.providerId.toLowerCase().includes(search.toLowerCase())
  );

  const groupedModels = filteredModels.reduce((acc, m) => {
    if (!acc[m.providerId]) acc[m.providerId] = [];
    acc[m.providerId].push(m);
    return acc;
  }, {} as Record<string, typeof availableModels>);

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

  const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <div
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        backgroundColor: checked ? '#7c3aed' : '#45475a',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: '#fff',
          transition: 'left 0.2s',
        }}
      />
    </div>
  );

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
            <div style={{ fontSize: 16, fontWeight: 600, color: '#cdd6f4' }}>Manage Models</div>
            <div style={{ fontSize: 11, color: '#585b70', marginTop: 2 }}>
              {availableModels.length - Object.keys(hiddenModels).length} / {availableModels.length} visible
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a6adc8', cursor: 'pointer', fontSize: 20, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <button
            onClick={() => setActiveTab('models')}
            style={{
              flex: 1,
              padding: '12px 16px',
              backgroundColor: 'transparent',
              border: 'none',
              color: activeTab === 'models' ? '#cdd6f4' : '#585b70',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              borderBottom: activeTab === 'models' ? '2px solid #7c3aed' : '2px solid transparent',
            }}
          >
            Modeller
          </button>
          <button
            onClick={() => setActiveTab('providers')}
            style={{
              flex: 1,
              padding: '12px 16px',
              backgroundColor: 'transparent',
              border: 'none',
              color: activeTab === 'providers' ? '#cdd6f4' : '#585b70',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              borderBottom: activeTab === 'providers' ? '2px solid #7c3aed' : '2px solid transparent',
            }}
          >
            Providers
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Model ara..."
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #45475a',
              backgroundColor: '#313244',
              color: '#cdd6f4',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {activeTab === 'models' ? (
            /* Models Tab */
            Object.keys(groupedModels).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#585b70', fontSize: 13 }}>
                Model not found
              </div>
            ) : (
              Object.entries(groupedModels).map(([providerId, models]) => {
                const allVisible = models.every((m) => !hiddenModels[m.id]);
                return (
                <div key={providerId} style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#585b70',
                      fontWeight: 600,
                      padding: '8px 0 4px',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{providerId}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#6c7086' }}>{models.filter((m) => !hiddenModels[m.id]).length}/{models.length}</span>
                      <ToggleSwitch checked={allVisible} onChange={() => onToggleAllModels?.(providerId, !allVisible)} />
                    </div>
                  </div>
                  {models.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 8,
                        backgroundColor: '#181825',
                        marginBottom: 4,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, color: '#cdd6f4' }}>{m.name}</div>
                        <div style={{ fontSize: 10, color: '#585b70', marginTop: 2 }}>ID: {m.id}</div>
                      </div>
                      <ToggleSwitch checked={!hiddenModels[m.id]} onChange={() => onToggleModel(m.id)} />
                    </div>
                  ))}
                </div>
              );
            })
            )
          ) : (
            /* Providers Tab */
            providers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#585b70', fontSize: 13 }}>
                Provider not found. Make sure Opencode CLI is installed.
              </div>
            ) : (
              <div>
                <button
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 10,
                    border: '1px dashed #45475a',
                    backgroundColor: 'transparent',
                    color: '#89b4fa',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Connect Provider
                </button>
                {providers.map((provider) => {
                  const isConnected = connected.includes(provider.id);
                  const models = Object.values(provider.models || {});

                  return (
                    <div
                      key={provider.id}
                      style={{
                        backgroundColor: '#181825',
                        borderRadius: 10,
                        border: '1px solid #313244',
                        marginBottom: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: isConnected ? '#a6e3a1' : '#45475a', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#cdd6f4' }}>{provider.name}</span>
                          {isConnected && <span style={{ fontSize: 10, color: '#a6e3a1', backgroundColor: 'rgba(166,227,161,0.1)', padding: '1px 6px', borderRadius: 4 }}>CONNECTED</span>}
                        </div>
                        <span style={{ fontSize: 11, color: '#585b70' }}>{models.length} model</span>
                      </div>

                      {/* API Key Input */}
                      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="password"
                            value={apiKeys[provider.id] || ''}
                            onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                            placeholder={isConnected ? 'New API key...' : `${provider.name} API key`}
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
                            {saving[provider.id] ? '...' : isConnected ? 'Update' : 'Save'}

                          
                          </button>
                          {isConnected && (
                            <button
                              onClick={() => handleRemove(provider.id)}
                              disabled={saving[provider.id]}
                              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #45475a', backgroundColor: 'transparent', color: '#f38ba8', cursor: saving[provider.id] ? 'not-allowed' : 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {messages[provider.id] && (
                          <div style={{ fontSize: 11, color: messages[provider.id].startsWith('✓') ? '#a6e3a1' : '#f38ba8' }}>
                            {messages[provider.id]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}