import React from 'react';

interface Props {
  model: string;
  onChange: (model: string) => void;
  availableModels: Array<{ id: string; name: string; providerId: string }>;
}

const STATIC_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-opus', label: 'Claude 3 Opus' },
  { value: 'kimi-k2.6', label: 'Kimi K2.6 (3x limits)' },
];

export function ModelSelector({ model, onChange, availableModels }: Props) {
  const dynamicModels = availableModels.map((m) => ({
    value: m.id,
    label: `${m.name} (${m.providerId})`,
  }));

  const allOptions = dynamicModels.length > 0 ? dynamicModels : STATIC_MODELS;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: '#a6adc8',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <select
        value={model}
        onChange={(e) => onChange(e.target.value)}
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          color: '#a6adc8',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          outline: 'none',
          maxWidth: 140,
          textOverflow: 'ellipsis',
        }}
      >
        {allOptions.map((m) => (
          <option key={m.value} value={m.value} style={{ backgroundColor: '#181825', color: '#cdd6f4' }}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
