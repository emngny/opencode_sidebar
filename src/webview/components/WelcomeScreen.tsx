import React from 'react';

interface Props {
  projectPath: string;
  branch: string;
  lastCommitTime: string;
}

export function WelcomeScreen({ projectPath, branch, lastCommitTime }: Readonly<Props>) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        gap: 16,
        padding: 20
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 56,
          height: 56,
          background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </div>

      {/* Title */}
      <h1
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: '#cdd6f4',
          margin: 0,
          textAlign: 'center'
        }}
      >
        Just ask anything
      </h1>

      {/* Project Path */}
      <div
        style={{
          fontSize: 13,
          color: '#89b4fa',
          fontFamily: 'monospace',
          textAlign: 'center'
        }}
      >
        {projectPath}
      </div>

      {/* Branch */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: '#a6adc8'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span>Branch: {branch}</span>
      </div>

      {/* Last Commit */}
      <div
        style={{
          fontSize: 13,
          color: '#89b4fa',
          textAlign: 'center'
        }}
      >
        Last change {lastCommitTime}
      </div>
    </div>
  );
}
