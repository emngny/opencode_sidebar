import React from 'react';
import { DiffChanges } from './DiffChanges';

interface Props {
  filename: string;
  inserts: number;
  deletes: number;
  onAccept: () => void;
  onReject: () => void;
}

export function ReviewActions({ filename, inserts, deletes, onAccept, onReject }: Readonly<Props>) {
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 8, color: '#a6adc8' }}>
        Review: <strong style={{ color: '#cdd6f4' }}>{filename}</strong>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, marginBottom: 12 }}>
        <DiffChanges additions={inserts} deletions={deletes} variant="bars" />
        <span style={{ color: '#a6e3a1', fontWeight: 500 }}>+{inserts}</span>
        <span style={{ color: '#f38ba8', fontWeight: 500 }}>-{deletes}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onAccept}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 10,
            border: 'none',
            backgroundColor: '#a6e3a1',
            color: '#1e1e2e',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          Accept
        </button>
        <button
          onClick={onReject}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 10,
            border: 'none',
            backgroundColor: '#f38ba8',
            color: '#1e1e2e',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
