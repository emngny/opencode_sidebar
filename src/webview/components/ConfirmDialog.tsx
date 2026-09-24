import React from 'react';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: Readonly<Props>) {
  return (
    <dialog
      open
      aria-label={message}
      onCancel={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        width: '100%',
        maxWidth: 'none',
        height: '100%',
        maxHeight: 'none',
        border: 0,
        padding: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        color: 'inherit',
      }}
    >
      <div
        style={{
          backgroundColor: '#1e1e2e',
          borderRadius: 12,
          border: '1px solid #313244',
          padding: '20px 24px',
          maxWidth: 320,
          width: '90%',
          margin: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ fontSize: 13, color: '#cdd6f4', lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid #45475a',
              background: 'transparent',
              color: '#a6adc8',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid #f38ba8',
              background: '#f38ba8',
              color: '#1e1e2e',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Revert
          </button>
        </div>
      </div>
    </dialog>
  );
}
