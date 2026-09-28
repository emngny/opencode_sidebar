import React from 'react';
import { COLORS, RADIUS, SHADOW } from '../styles';
import { Popup } from './Popup';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: Readonly<Props>) {
  // Focus the safe action, never the destructive one: a stray Enter must not
  // revert a message.
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Popup
      labelledBy="confirm-dialog-message"
      onClose={onCancel}
      initialFocus={cancelRef}
      backdropStyle={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        width: '100%',
        height: '100%',
        backgroundColor: COLORS.scrim,
      }}
      style={{
        backgroundColor: COLORS.bg,
        borderRadius: RADIUS.xl,
        border: `1px solid ${COLORS.bgHover}`,
        padding: '24px',
        maxWidth: 320,
        width: '90%',
        margin: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: SHADOW.lg,
      }}
    >
      <div id="confirm-dialog-message" style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.5 }}>
        {message}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          ref={cancelRef}
          onClick={onCancel}
          style={{
            padding: '6px 16px',
            fontSize: 12,
            borderRadius: RADIUS.md,
            border: `1px solid ${COLORS.border}`,
            background: 'transparent',
            color: COLORS.textDim,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: '6px 16px',
            fontSize: 12,
            borderRadius: RADIUS.md,
            border: `1px solid ${COLORS.red}`,
            background: COLORS.red,
            color: COLORS.bg,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Revert
        </button>
      </div>
    </Popup>
  );
}
