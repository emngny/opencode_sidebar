import React from 'react';

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
        borderRadius: 8,
        backgroundColor: '#181825',
        border: '1px solid #313244',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}
    >
      {patch.split('\n').map((line, i) => {
        let bg = 'transparent';
        let color = '#cdd6f4';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          bg = 'rgba(166,227,161,0.08)';
          color = '#a6e3a1';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          bg = 'rgba(243,139,168,0.08)';
          color = '#f38ba8';
        } else if (line.startsWith('@@')) {
          color = '#89b4fa';
        } else if (line.startsWith('Index:') || line.startsWith('===')) {
          color = '#6c7086';
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