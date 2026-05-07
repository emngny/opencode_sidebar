import React from 'react';

interface Props {
  content: string;
}

export function ToolMessage({ content }: Readonly<Props>) {
  const isRunning = content.includes('running');
  const isCompleted = content.includes('completed') || content.includes('result');
  const isFailed = content.includes('failed') || content.includes('error');

  let icon = '🔧';
  let bgColor = '#1e1e2e';
  if (isRunning) { icon = '⏳'; bgColor = '#181825'; }
  if (isCompleted) { icon = '✅'; bgColor = 'rgba(166,227,161,0.08)'; }
  if (isFailed) { icon = '❌'; bgColor = 'rgba(243,139,168,0.08)'; }

  return (
    <div
      style={{
        fontSize: 12,
        color: '#a6adc8',
        padding: '6px 12px',
        textAlign: 'center',
        backgroundColor: bgColor,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      <span>{icon}</span>
      <span>{content}</span>
    </div>
  );
}