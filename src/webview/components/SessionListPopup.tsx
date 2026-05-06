import React, { useState, useEffect, useRef } from 'react';
import { postMessage, onMessage } from '../vscode-api';

interface Props {
  onClose: () => void;
  onSelect: (sessionId: string) => void;
}

interface SessionItem {
  id: string;
  title?: string;
  time?: { created?: number };
}

export function SessionListPopup({ onClose, onSelect }: Props) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    postMessage({ type: 'getSessions' });
    const unsubscribe = onMessage((msg) => {
      if (msg.type === 'sessionList') {
        setSessions(Array.isArray(msg.payload) ? msg.payload : []);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    postMessage({ type: 'deleteSession', payload: { sessionId } });
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  const formatDate = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: '#1e1e2e', border: '1px solid #313244', borderBottom: 'none',
          borderRadius: '16px 16px 0 0', width: '100%', maxHeight: '75vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#cdd6f4' }}>Session History</div>
            <div style={{ fontSize: 11, color: '#585b70', marginTop: 2 }}>
              {loading ? 'Loading...' : `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a6adc8', cursor: 'pointer', fontSize: 20, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#585b70', fontSize: 13 }}>Loading...</div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#585b70', fontSize: 13 }}>No sessions yet</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => onSelect(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 10, backgroundColor: '#181825',
                  marginBottom: 6, cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#313244')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#181825')}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || `Oturum ${s.id.slice(0, 8)}`}
                  </div>
                  <div style={{ fontSize: 11, color: '#585b70', marginTop: 2 }}>
                    {s.time?.created ? formatDate(s.time.created) : ''}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  style={{
                    background: 'none', border: 'none', color: '#585b70', cursor: 'pointer',
                    padding: '4px 8px', borderRadius: 4, fontSize: 12, marginLeft: 8,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#f38ba8')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#585b70')}
                  title="Sil"
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}