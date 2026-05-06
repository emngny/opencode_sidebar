import React from 'react';
import { getAgentColor } from './agentColors';

interface Props {
  mode: string;
  onChange: (mode: string) => void;
}

const MODES = ['Build', 'Plan'];

export function ModeSelector({ mode, onChange }: Props) {
  const color = getAgentColor(mode);
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
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        backgroundColor: color?.text || '#585b70',
        flexShrink: 0,
      }} />
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
