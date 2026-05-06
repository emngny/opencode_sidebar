import React from 'react';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: '#1e1e2e', borderRadius: 12,
          border: '1px solid #313244',
          padding: '20px 24px', maxWidth: 320, width: '90%',
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, color: '#cdd6f4', lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6,
              border: '1px solid #45475a', background: 'transparent',
              color: '#a6adc8', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6,
              border: '1px solid #f38ba8', background: '#f38ba8',
              color: '#1e1e2e', cursor: 'pointer', fontWeight: 600,
            }}
          >
            Revert
          </button>
        </div>
      </div>
    </div>
  );
}
