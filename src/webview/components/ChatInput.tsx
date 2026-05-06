import React, { useState } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Readonly<Props>) {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Ask Opencode..."
        style={{
          flex: 1,
          resize: 'none',
          padding: 8,
          borderRadius: 4,
          border: '1px solid var(--vscode-input-border)',
          backgroundColor: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          fontFamily: 'inherit',
          minHeight: 40,
          maxHeight: 120,
          fontSize: 13
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        style={{
          padding: '8px 12px',
          borderRadius: 4,
          border: 'none',
          backgroundColor: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          cursor: 'pointer',
          opacity: disabled ? 0.6 : 1,
          fontSize: 13,
          fontWeight: 'bold'
        }}
      >
        Send
      </button>
    </div>
  );
}
