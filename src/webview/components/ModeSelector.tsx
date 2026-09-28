import React from 'react';
import { COLORS } from '../styles';
import { getAgentColor } from './agentColors';

interface Props {
  mode: string;
  onChange: (mode: string) => void;
  agents: string[];
}

export function ModeSelector({ mode, onChange, agents }: Readonly<Props>) {
  const color = getAgentColor(mode);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: COLORS.textDim,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color?.text || COLORS.textMuted,
          flexShrink: 0,
        }}
      />
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value)}
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          color: COLORS.textDim,
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {agents.map((a) => {
          const display = typeof a === 'string' ? a.charAt(0).toUpperCase() + a.slice(1) : String(a);
          return (
            <option key={a} value={a} style={{ backgroundColor: COLORS.bgLight, color: COLORS.text }}>
              {display}
            </option>
          );
        })}
      </select>
    </div>
  );
}
