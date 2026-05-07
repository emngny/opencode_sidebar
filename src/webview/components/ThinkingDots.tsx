import React from 'react';

interface Props {
  small?: boolean;
}

export function ThinkingDots({ small }: Readonly<Props>) {
  const size = small ? 4 : 6;
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite' }} />
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.2s' }} />
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.4s' }} />
    </div>
  );
}