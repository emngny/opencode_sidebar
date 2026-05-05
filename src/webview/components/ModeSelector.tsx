import React from 'react';

interface Props {
  mode: string;
  onChange: (mode: string) => void;
}

const MODES = ['Build', 'Code', 'Ask', 'Debug'];

export function ModeSelector({ mode, onChange }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: '#a6adc8',
        cursor: 'pointer'
      }}
    >
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value)}
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          color: '#a6adc8',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          outline: 'none',
          fontWeight: 600
        }}
      >
        {MODES.map((m) => (
          <option key={m} value={m} style={{ backgroundColor: '#181825', color: '#cdd6f4' }}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
