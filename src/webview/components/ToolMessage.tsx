import React from 'react';
import { COLORS, RADIUS } from '../styles';

interface Props {
  content: string;
}

function ToolMessageComponent({ content }: Readonly<Props>) {
  const isRunning = content.includes('running');
  const isCompleted = content.includes('completed') || content.includes('result');
  const isFailed = content.includes('failed') || content.includes('error');

  let icon = '🔧';
  let bgColor = COLORS.bg;
  if (isRunning) {
    icon = '⏳';
    bgColor = COLORS.bgLight;
  }
  if (isCompleted) {
    icon = '✅';
    bgColor = COLORS.successTint;
  }
  if (isFailed) {
    icon = '❌';
    bgColor = COLORS.dangerTint;
  }

  return (
    <div
      style={{
        fontSize: 12,
        color: COLORS.textDim,
        padding: '6px 12px',
        textAlign: 'center',
        backgroundColor: bgColor,
        borderRadius: RADIUS.lg,
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

export const ToolMessage = React.memo(ToolMessageComponent);
