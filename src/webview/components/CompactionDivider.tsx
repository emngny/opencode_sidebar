import React from 'react';
import { COLORS, FONT_SIZE } from '../styles';

interface Props {
  status?: string;
}

function CompactionDividerComponent({ status }: Readonly<Props>) {
  const completed = status === 'completed';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
      <div style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
      <span style={{ fontSize: FONT_SIZE.xs, color: completed ? COLORS.green : COLORS.textDim, whiteSpace: 'nowrap' }}>
        {completed ? '✓ Conversation compressed' : 'Compressing...'}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
    </div>
  );
}

export const CompactionDivider = React.memo(CompactionDividerComponent);
