import React from 'react';

interface Props {
  status?: string;
}

function CompactionDividerComponent({ status }: Readonly<Props>) {
  const completed = status === 'completed';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
      <div style={{ flex: 1, height: 1, backgroundColor: '#45475a' }} />
      <span style={{ fontSize: 10, color: completed ? '#a6e3a1' : '#6c7086', whiteSpace: 'nowrap' }}>
        {completed ? '✓ Conversation compressed' : 'Compressing...'}
      </span>
      <div style={{ flex: 1, height: 1, backgroundColor: '#45475a' }} />
    </div>
  );
}

export const CompactionDivider = React.memo(CompactionDividerComponent);
