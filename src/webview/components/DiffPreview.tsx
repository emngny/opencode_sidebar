import React from 'react';
import { COLORS, RADIUS } from '../styles';

interface Props {
  patch: string;
}

export function DiffPreview({ patch }: Readonly<Props>) {
  return (
    <pre
      style={{
        margin: 0,
        fontSize: 11,
        lineHeight: 1.5,
        maxHeight: 300,
        overflow: 'auto',
        borderRadius: RADIUS.lg,
        backgroundColor: COLORS.bgLight,
        border: `1px solid ${COLORS.bgHover}`,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}
    >
      {patch.split('\n').map((line, i) => {
        let bg = 'transparent';
        let color = COLORS.text;
        if (line.startsWith('+') && !line.startsWith('+++')) {
          bg = COLORS.successRow;
          color = COLORS.green;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          bg = COLORS.dangerRow;
          color = COLORS.red;
        } else if (line.startsWith('@@')) {
          color = COLORS.accent;
        } else if (line.startsWith('Index:') || line.startsWith('===')) {
          color = COLORS.textDim;
        }
        return (
          <div key={i} style={{ backgroundColor: bg, color, padding: '1px 8px', whiteSpace: 'pre' }}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
