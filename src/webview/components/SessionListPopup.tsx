import React, { useState, useEffect, useRef } from 'react';
import { postMessage, onMessage } from '../vscode-api';
import { COLORS, RADIUS, SHADOW, sheetBackdrop, sheetHeader, sheetPanel } from '../styles';
import { hoverable } from '../hover';
import { Popup } from './Popup';

interface Props {
  onClose: () => void;
  onSelect: (sessionId: string) => void;
}

interface SessionItem {
  id: string;
  title?: string;
  time?: { created?: number };
}

export function SessionListPopup({ onClose, onSelect }: Readonly<Props>) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    postMessage({ type: 'getSessions' });
    const unsubscribe = onMessage((msg) => {
      if (msg.type === 'sessionList') {
        setSessions(Array.isArray(msg.payload) ? msg.payload : []);
        setLoading(false);
      } else if (msg.type === 'sessionDeleted') {
        setSessions((prev) => prev.filter((session) => session.id !== msg.payload.sessionId));
      }
    });
    return unsubscribe;
  }, []);

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    postMessage({ type: 'deleteSession', payload: { sessionId } });
  };

  const handleDeleteOld = async (days: number) => {
    const now = Date.now();
    const cutoff = days === 0 ? 0 : now - days * 24 * 60 * 60 * 1000;
    const oldSessions = cutoff === 0 ? sessions : sessions.filter((s) => s.time?.created && s.time.created < cutoff);
    for (const s of oldSessions) {
      postMessage({ type: 'deleteSession', payload: { sessionId: s.id } });
    }
    setShowDeleteMenu(false);
  };

  const getSessionAge = (ts?: number): string => {
    if (!ts) return '';
    const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  };

  const formatDate = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    const locale = (window as any).vscode?.env?.language || navigator.language || 'en-US';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  let sessionCountLabel = 'Loading...';
  if (!loading) {
    const sessionLabel = sessions.length === 1 ? 'session' : 'sessions';
    sessionCountLabel = `${sessions.length} ${sessionLabel}`;
  }

  return (
    <Popup
      labelledBy="session-list-title"
      onClose={onClose}
      initialFocus={closeRef}
      backdropStyle={sheetBackdrop}
      style={{ ...sheetPanel, maxHeight: '75vh' }}
    >
      {/* Header */}
      <div style={sheetHeader}>
        <div>
          <div id="session-list-title" style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>
            Session History
          </div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{sessionCountLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {sessions.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowDeleteMenu(!showDeleteMenu)}
                style={{
                  background: 'none',
                  border: `1px solid ${COLORS.bgHover}`,
                  color: COLORS.textDim,
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '6px 12px',
                  borderRadius: RADIUS.md,
                }}
                {...hoverable({ borderColor: COLORS.textMuted }, { borderColor: COLORS.bgHover })}
              >
                Delete old ▼
              </button>
              {showDeleteMenu && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 4,
                    backgroundColor: COLORS.bgLight,
                    border: `1px solid ${COLORS.bgHover}`,
                    borderRadius: RADIUS.lg,
                    padding: '4px 0',
                    minWidth: 140,
                    zIndex: 10,
                  }}
                >
                  {[
                    { days: 7, label: 'Older than 7 days' },
                    { days: 30, label: 'Older than 30 days' },
                    { days: 90, label: 'Older than 90 days' },
                    { days: 0, label: 'All sessions' },
                  ].map((opt) => (
                    <button
                      key={opt.days}
                      onClick={() => handleDeleteOld(opt.days)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: COLORS.text,
                      }}
                      {...hoverable({ backgroundColor: COLORS.bgHover }, { backgroundColor: 'transparent' })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close session history"
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
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: COLORS.textMuted, fontSize: 13 }}>
            {loading ? 'Loading...' : 'No sessions yet'}
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: COLORS.bgLight,
                borderRadius: 10,
                marginBottom: 6,
              }}
              {...hoverable({ backgroundColor: COLORS.bgHover }, { backgroundColor: COLORS.bgLight })}
            >
              <button
                onClick={() => onSelect(s.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: COLORS.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.title || `Session ${s.id.slice(0, 8)}`}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                    {s.time?.created ? `${formatDate(s.time.created)} · ${getSessionAge(s.time.created)}` : ''}
                  </div>
                </div>
              </button>
              <button
                onClick={(e) => handleDelete(e, s.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: COLORS.textMuted,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: RADIUS.sm,
                  fontSize: 12,
                  marginLeft: 8,
                  marginRight: 6,
                  flexShrink: 0,
                }}
                {...hoverable({ color: COLORS.red }, { color: COLORS.textMuted })}
                aria-label={`Delete ${s.title || `session ${s.id.slice(0, 8)}`}`}
                title="Delete"
              >
                🗑
              </button>
            </div>
          ))
        )}
      </div>
    </Popup>
  );
}
