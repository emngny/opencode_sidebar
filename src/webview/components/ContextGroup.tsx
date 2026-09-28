import React from 'react';
import { COLORS, FONT_SIZE, SPACE } from '../styles';

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

function ContextGroupComponent({ events, allDone }: Readonly<Props>) {
  const [expanded, setExpanded] = React.useState(false);
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.name] = (counts[e.name] || 0) + 1;
  }
  const label = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  const anyRunning = events.some((e) => e.status === 'running');
  let headerIcon = '🔍';
  if (!anyRunning && allDone) {
    headerIcon = '✅';
  }

  return (
    <button
      type="button"
      style={{
        border: `1px solid ${allDone ? COLORS.successBorder : COLORS.border}`,
        borderRadius: 10,
        backgroundColor: allDone ? COLORS.successTint : COLORS.bgLight,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'background-color 0.3s',
        alignSelf: 'flex-start',
        maxWidth: '90%',
        textAlign: 'left',
        padding: 0,
        color: 'inherit',
        font: 'inherit',
      }}
      onClick={() => setExpanded((current) => !current)}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: allDone ? COLORS.green : COLORS.textDim,
        }}
      >
        <span style={{ fontSize: 14 }}>{headerIcon}</span>
        <span style={{ flex: 1 }}>{anyRunning ? 'Gathering context...' : 'Gathered context'}</span>
        <span style={{ color: COLORS.textDim, fontSize: 11 }}>{label}</span>
        <span
          style={{
            color: COLORS.textMuted,
            fontSize: FONT_SIZE.xs,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
      </div>

      {/* Expanded items */}
      {expanded && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {events.map((e) => {
            let statusIcon = '❌';
            if (e.status === 'running') statusIcon = '⏳';
            if (e.status === 'completed') statusIcon = '✅';
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: `${SPACE.xs}px 0`,
                  fontSize: 11,
                  color: COLORS.textDim,
                }}
              >
                <span>{statusIcon}</span>
                <span style={{ color: COLORS.textDim, fontWeight: 500 }}>{e.name}</span>
                {e.meta?.args && (
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 150,
                      color: COLORS.textMuted,
                    }}
                  >
                    {typeof e.meta.args === 'string' ? e.meta.args : JSON.stringify(e.meta.args)}
                  </span>
                )}
                {e.status === 'running' && (
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    <span
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: '50%',
                        backgroundColor: COLORS.accent,
                        animation: 'thinking 1.4s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: '50%',
                        backgroundColor: COLORS.accent,
                        animation: 'thinking 1.4s ease-in-out infinite 0.2s',
                      }}
                    />
                    <span
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: '50%',
                        backgroundColor: COLORS.accent,
                        animation: 'thinking 1.4s ease-in-out infinite 0.4s',
                      }}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}

export const ContextGroup = React.memo(ContextGroupComponent);
