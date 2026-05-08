import React from 'react';
import { getAgentColor } from './agentColors';

interface Props {
  mode: string;
  onChange: (mode: string) => void;
  agents: string[];
}

export function ModeSelector({ mode, onChange, agents }: Props) {
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
        {agents.map((a) => {
          const display = typeof a === 'string'
            ? a.charAt(0).toUpperCase() + a.slice(1)
            : String(a);
          return (
            <option key={a} value={a} style={{ backgroundColor: '#181825', color: '#cdd6f4' }}>
              {display}
            </option>
          );
        })}
      </select>
    </div>
  );
}
