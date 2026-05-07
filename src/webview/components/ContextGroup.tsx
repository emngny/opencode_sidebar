import React from 'react';

interface ContextEvent {
  id: string;
  name: string;
  status: string;
  content: string;
  meta?: any;
}

interface Props {
  events: ContextEvent[];
  allDone: boolean;
}

export function ContextGroup({ events, allDone }: Readonly<Props>) {
  const [expanded, setExpanded] = React.useState(false);
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.name] = (counts[e.name] || 0) + 1;
  }
  const label = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
  const anyRunning = events.some((e) => e.status === 'running');

  return (
    <div
      style={{
        border: `1px solid ${allDone ? 'rgba(166,227,161,0.3)' : '#45475a'}`,
        borderRadius: 10,
        backgroundColor: allDone ? 'rgba(166,227,161,0.04)' : '#181825',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'background-color 0.3s',
        alignSelf: 'flex-start',
        maxWidth: '90%',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: allDone ? '#a6e3a1' : '#a6adc8' }}>
        <span style={{ fontSize: 14 }}>
          {anyRunning ? '🔍' : allDone ? '✅' : '🔍'}
        </span>
        <span style={{ flex: 1 }}>
          {anyRunning ? 'Gathering context...' : 'Gathered context'}
        </span>
        <span style={{ color: '#6c7086', fontSize: 11 }}>{label}</span>
        <span style={{ color: '#585b70', fontSize: 10, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
      </div>

      {/* Expanded items */}
      {expanded && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {events.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11, color: '#6c7086' }}>
              <span>{e.status === 'running' ? '⏳' : e.status === 'completed' ? '✅' : '❌'}</span>
              <span style={{ color: '#a6adc8', fontWeight: 500 }}>{e.name}</span>
              {e.meta?.args && (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150, color: '#585b70' }}>
                  {typeof e.meta.args === 'string' ? e.meta.args : JSON.stringify(e.meta.args)}
                </span>
              )}
              {e.status === 'running' && (
                <span style={{ display: 'inline-flex', gap: 2 }}>
                  <span style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.2s' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.4s' }} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}