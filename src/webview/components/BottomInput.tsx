import React, { useState, useRef, useEffect } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function BottomInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

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
    <div
      style={{
        padding: '12px 16px',
        backgroundColor: '#181825'
      }}
    >
      {/* Input Container */}
      <div
        style={{
          backgroundColor: '#313244',
          borderRadius: 16,
          border: '1px solid #45475a',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder='Bir şeyler sorun... "Girdi doğrulama ekle"'
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#cdd6f4',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            width: '100%',
            minHeight: 22,
            maxHeight: 120,
            overflowY: 'auto',
            lineHeight: 1.5
          }}
        />

        {/* Buttons Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          {/* Plus Button */}
          <button
            onClick={() => { /* TODO: File attachment */ }}
            disabled={disabled}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              color: '#a6adc8',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#cdd6f4')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#a6adc8')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={disabled || !text.trim()}
            style={{
              backgroundColor: disabled || !text.trim() ? '#45475a' : '#7c3aed',
              border: 'none',
              color: '#fff',
              cursor: disabled || !text.trim() ? 'not-allowed' : 'pointer',
              padding: '6px 10px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s',
              opacity: disabled || !text.trim() ? 0.6 : 1
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
