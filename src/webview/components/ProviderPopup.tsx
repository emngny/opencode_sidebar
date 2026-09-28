import React, { useState, useEffect, useRef } from 'react';
import { ProviderInfo, ProviderModel } from '../../shared/types';
import { postMessage, onMessage } from '../vscode-api';
import { COLORS, FONT_SIZE, RADIUS, SHADOW, SPACE, sheetBackdrop, sheetHeader, sheetPanel, sheetTabs } from '../styles';
import { Popup } from './Popup';

interface Props {
  readonly onClose: () => void;
  readonly onModelSelect?: (providerId: string, modelId: string) => void;
  readonly availableModels: Array<{ id: string; name: string; providerId: string }>;
  readonly hiddenModels: Record<string, boolean>;
  readonly onToggleModel: (modelId: string) => void;
  readonly onToggleAllModels?: (providerId: string, show: boolean) => void;
}

export function ProviderPopup({
  onClose,
  onModelSelect,
  availableModels,
  hiddenModels,
  onToggleModel,
  onToggleAllModels,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'models' | 'providers'>('models');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

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
          setMessages((prev) => ({ ...prev, [providerId]: success ? '✓ Saved' : `✗ ${error || 'Error'}` }));
          if (success) setTimeout(() => setMessages((prev) => ({ ...prev, [providerId]: '' })), 2000);
          break;
        }
      }
    });
    return unsubscribe;
  }, []);

  const filteredModels = availableModels.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) || m.providerId.toLowerCase().includes(search.toLowerCase()),
  );

  const groupedModels = filteredModels.reduce(
    (acc, m) => {
      if (!acc[m.providerId]) acc[m.providerId] = [];
      acc[m.providerId].push(m);
      return acc;
    },
    {} as Record<string, typeof availableModels>,
  );

  const handleSave = (providerId: string) => {
    const key = apiKeyInputs[providerId];
    if (!key) return;
    setSaving((prev) => ({ ...prev, [providerId]: true }));
    setMessages((prev) => ({ ...prev, [providerId]: 'Saving...' }));
    postMessage({ type: 'setApiKey', payload: { providerId, key } });
    setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
  };

  const handleRemove = (providerId: string) => {
    setSaving((prev) => ({ ...prev, [providerId]: true }));
    postMessage({ type: 'removeApiKey', payload: { providerId } });
  };

  const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        backgroundColor: checked ? COLORS.purple : COLORS.border,
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
          backgroundColor: COLORS.onAccent,
          transition: 'left 0.2s',
        }}
      />
    </div>
  );

  return (
    <Popup
      labelledBy="manage-models-title"
      onClose={onClose}
      initialFocus={searchRef}
      backdropStyle={sheetBackdrop}
      style={{ ...sheetPanel, maxHeight: '85vh' }}
    >
      {/* Header */}
      <div style={sheetHeader}>
        <div>
          <div id="manage-models-title" style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>
            Manage Models
          </div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
            {availableModels.length - Object.keys(hiddenModels).length} / {availableModels.length} visible
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: COLORS.textDim,
            cursor: 'pointer',
            fontSize: 20,
            padding: 4,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={sheetTabs}>
        <button
          onClick={() => setActiveTab('models')}
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            color: activeTab === 'models' ? COLORS.text : COLORS.textMuted,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'models' ? `2px solid ${COLORS.purple}` : '2px solid transparent',
          }}
        >
          Models
        </button>
        <button
          onClick={() => setActiveTab('providers')}
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            color: activeTab === 'providers' ? COLORS.text : COLORS.textMuted,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'providers' ? `2px solid ${COLORS.purple}` : '2px solid transparent',
          }}
        >
          Providers
        </button>
      </div>

      {/* Search Bar */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.bgHover}`, flexShrink: 0 }}>
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models..."
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: RADIUS.lg,
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.bgHover,
            color: COLORS.text,
            fontSize: 13,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {activeTab === 'models' ? (
          /* Models Tab */
          Object.keys(groupedModels).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: COLORS.textMuted, fontSize: 13 }}>
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
                      color: COLORS.textMuted,
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
                      <span style={{ fontSize: FONT_SIZE.xs, color: COLORS.textDim }}>
                        {models.filter((m) => !hiddenModels[m.id]).length}/{models.length}
                      </span>
                      <ToggleSwitch
                        checked={allVisible}
                        onChange={() => onToggleAllModels?.(providerId, !allVisible)}
                      />
                    </div>
                  </div>
                  {models.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        borderRadius: RADIUS.lg,
                        backgroundColor: COLORS.bgLight,
                        marginBottom: 4,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, color: COLORS.text }}>{m.name}</div>
                        <div style={{ fontSize: FONT_SIZE.xs, color: COLORS.textMuted, marginTop: 2 }}>ID: {m.id}</div>
                      </div>
                      <ToggleSwitch checked={!hiddenModels[m.id]} onChange={() => onToggleModel(m.id)} />
                    </div>
                  ))}
                </div>
              );
            })
          )
        ) : /* Providers Tab */
        providers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: COLORS.textMuted, fontSize: 13 }}>
            Provider not found. Make sure Opencode CLI is installed.
          </div>
        ) : (
          <div>
            <button
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 10,
                border: `1px dashed ${COLORS.border}`,
                backgroundColor: 'transparent',
                color: COLORS.accent,
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
                    backgroundColor: COLORS.bgLight,
                    borderRadius: 10,
                    border: `1px solid ${COLORS.bgHover}`,
                    marginBottom: 8,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          backgroundColor: isConnected ? COLORS.green : COLORS.border,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.text }}>{provider.name}</span>
                      {isConnected && (
                        <span
                          style={{
                            fontSize: FONT_SIZE.xs,
                            color: COLORS.green,
                            backgroundColor: COLORS.successFill,
                            padding: '1px 6px',
                            borderRadius: RADIUS.sm,
                          }}
                        >
                          CONNECTED
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: COLORS.textMuted }}>{models.length} model</span>
                  </div>

                  {/* API Key Input */}
                  <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="password"
                        value={apiKeyInputs[provider.id] || ''}
                        onChange={(e) => {
                          setApiKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }));
                        }}
                        placeholder={isConnected ? 'New API key...' : `${provider.name} API key`}
                        style={{
                          flex: 1,
                          padding: '6px 12px',
                          borderRadius: RADIUS.md,
                          border: `1px solid ${COLORS.border}`,
                          backgroundColor: COLORS.bgHover,
                          color: COLORS.text,
                          fontSize: 12,
                          fontFamily: 'monospace',
                        }}
                      />
                      <button
                        onClick={() => handleSave(provider.id)}
                        disabled={saving[provider.id] || !apiKeyInputs[provider.id]}
                        style={{
                          padding: '6px 16px',
                          borderRadius: RADIUS.md,
                          border: 'none',
                          backgroundColor:
                            saving[provider.id] || !apiKeyInputs[provider.id] ? COLORS.border : COLORS.purple,
                          color: COLORS.onAccent,
                          cursor: saving[provider.id] || !apiKeyInputs[provider.id] ? 'not-allowed' : 'pointer',
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
                          style={{
                            padding: '6px 12px',
                            borderRadius: RADIUS.md,
                            border: `1px solid ${COLORS.border}`,
                            backgroundColor: 'transparent',
                            color: COLORS.red,
                            cursor: saving[provider.id] ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {messages[provider.id] && (
                      <div
                        style={{
                          fontSize: 11,
                          color: messages[provider.id].startsWith('✓') ? COLORS.green : COLORS.red,
                        }}
                      >
                        {messages[provider.id]}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Popup>
  );
}
