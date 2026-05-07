import React from 'react';
import { ChatMessage } from '../../extension/types';
import { ThinkingDots } from './ThinkingDots';
import { DiffPreview } from './DiffPreview';
import { DiffChanges } from './DiffChanges';

interface Props {
  message: ChatMessage;
  onLoadSession?: (id: string) => void;
  onRespondPermission?: (permId: string, sessionId: string, response: 'allow' | 'deny', remember?: boolean) => void;
  onOpenDiff?: (filePath: string) => void;
}

function formatArgs(args: any): React.ReactNode {
  if (typeof args === 'string') return <span style={{ fontSize: 11, color: '#6c7086' }}>{args}</span>;
  if (typeof args !== 'object' || args === null) return <span style={{ fontSize: 11, color: '#6c7086' }}>{String(args)}</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
      {Object.entries(args).map(([key, value]) => {
        let display: string;
        if (typeof value === 'string') {
          display = value.length > 60 ? value.slice(0, 60) + '...' : value;
        } else if (typeof value === 'object' && value !== null) {
          display = JSON.stringify(value).slice(0, 60);
          if (JSON.stringify(value).length > 60) display += '...';
        } else {
          display = String(value);
        }
        return (
          <div key={key} style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: '#89b4fa', whiteSpace: 'nowrap' }}>{key}</span>
            <span style={{ color: '#cdd6f4', wordBreak: 'break-word' }}>= {display}</span>
          </div>
        );
      })}
    </div>
  );
}

export function EventCard({ message, onLoadSession, onRespondPermission, onOpenDiff }: Readonly<Props>) {
  const eventType = message.eventType;
  const status = message.eventStatus;
  const meta = message.eventMeta;
  const [expanded, setExpanded] = React.useState(eventType !== 'tool_result' || status === 'failed');

  let icon = '🔧';
  let titleColor = '#cdd6f4';
  let borderColor = '#45475a';
  let bgColor = '#181825';

  if (eventType === 'thinking') {
    icon = '💭';
    borderColor = '#585b70';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, fontSize: 12, color: '#a6adc8' }}>
        <ThinkingDots small />
        <span>Thinking...</span>
      </div>
    );
  }

  if (eventType === 'permission') {
    const permType = meta?.permType || 'unknown';
    const patterns = meta?.patterns || [];
    const [responded, setResponded] = React.useState<string | null>(null);
    const handleResponse = (resp: 'allow' | 'deny', remember?: boolean) => {
      setResponded(resp);
      onRespondPermission?.(meta?.permId ?? '', meta?.permSessionId ?? '', resp, remember);
    };
    if (responded || status === 'completed') {
      return (
        <div style={{
          padding: '10px 14px', backgroundColor: 'rgba(166,227,161,0.05)',
          border: '1px solid rgba(166,227,161,0.3)', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 8, maxWidth: '90%', alignSelf: 'flex-start',
          fontSize: 12, color: '#a6e3a1',
        }}>
          <span style={{ fontSize: 14 }}>{responded === 'deny' ? '🔒' : '🔓'}</span>
          <span>Permission {responded || 'resolved'}</span>
        </div>
      );
    }
    return (
      <div style={{
        padding: '12px 14px', backgroundColor: 'rgba(137,180,250,0.06)',
        border: '1px solid rgba(137,180,250,0.3)', borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '90%', alignSelf: 'flex-start',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          <span style={{ fontSize: 12, color: '#89b4fa', fontWeight: 500 }}>Permission required</span>
        </div>
        <div style={{ fontSize: 12, color: '#a6adc8', paddingLeft: 22 }}>
          {permType}{patterns.length > 0 && <span style={{ color: '#cdd6f4', fontFamily: 'monospace', marginLeft: 4 }}>{patterns.join(', ')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, paddingLeft: 22 }}>
          <button onClick={() => handleResponse('allow', false)} disabled={!!responded} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(137,180,250,0.3)', background: 'rgba(137,180,250,0.15)', color: '#89b4fa', cursor: responded ? 'not-allowed' : 'pointer', opacity: responded ? 0.6 : 1 }}>Allow once</button>
          <button onClick={() => handleResponse('allow', true)} disabled={!!responded} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid #7c3aed', background: '#7c3aed', color: '#fff', cursor: responded ? 'not-allowed' : 'pointer', opacity: responded ? 0.6 : 1 }}>Always</button>
          <button onClick={() => handleResponse('deny', false)} disabled={!!responded} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid #45475a', background: 'transparent', color: '#f38ba8', cursor: responded ? 'not-allowed' : 'pointer', opacity: responded ? 0.6 : 1 }}>Deny</button>
        </div>
      </div>
    );
  }

  if (eventType === 'file_read') {
    icon = '📖';
    borderColor = 'rgba(137,180,250,0.3)';
    bgColor = 'rgba(137,180,250,0.04)';
    titleColor = '#89b4fa';
  } else if (status === 'running') {
    icon = '⏳';
    borderColor = '#585b70';
    titleColor = '#89b4fa';
  } else if (status === 'completed') {
    icon = '✅';
    borderColor = 'rgba(166,227,161,0.3)';
    bgColor = 'rgba(166,227,161,0.05)';
    titleColor = '#a6e3a1';
  } else if (status === 'failed') {
    icon = '❌';
    borderColor = 'rgba(243,139,168,0.3)';
    bgColor = 'rgba(243,139,168,0.05)';
    titleColor = '#f38ba8';
  }

  let title = message.content;
  const toolName = meta?.name || eventType?.replace('_', ' ') || 'tool';

  let argsContent: React.ReactNode = null;
  let resultContent: React.ReactNode = null;
  let errorContent: React.ReactNode = null;
  let fileInfo: React.ReactNode = null;

  if (eventType === 'tool_call' && meta?.args) {
    argsContent = formatArgs(meta.args);
  }

  if (eventType === 'tool_result' && meta?.result) {
    if (typeof meta.result === 'string') {
      resultContent = <pre style={{ margin: 0, fontSize: 10, color: '#6c7086', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{meta.result.slice(0, 500)}{meta.result.length > 500 ? '...' : ''}</pre>;
    } else {
      resultContent = <pre style={{ margin: 0, fontSize: 10, color: '#6c7086', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(meta.result, null, 2).slice(0, 500)}{JSON.stringify(meta.result).length > 500 ? '...' : ''}</pre>;
    }
  }

  if (status === 'failed' && meta?.error) {
    errorContent = (
      <div style={{ fontSize: 11, color: '#f38ba8', padding: '6px 10px', backgroundColor: 'rgba(243,139,168,0.08)', borderRadius: 6 }}>
        {meta.error}
      </div>
    );
  }

  if ((eventType === 'file_edit' || eventType === 'tool_result' || eventType === 'file_read') && meta?.path) {
    const added = meta.added ?? 0;
    const deleted = meta.deleted ?? 0;
    if (eventType === 'file_read' || added > 0 || deleted > 0) {
      fileInfo = (
        <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}>
          <DiffChanges additions={added} deletions={deleted} variant="bars" />
          <span style={{ color: '#a6e3a1' }}>+{added}</span>
          <span style={{ color: '#f38ba8' }}>-{deleted}</span>
          <button
            onClick={(e) => { e.stopPropagation(); if (meta.path) onOpenDiff?.(meta.path); }}
            style={{
              marginLeft: 8, padding: '2px 8px', fontSize: 10, borderRadius: 4,
              border: '1px solid rgba(137,180,250,0.3)',
              background: 'rgba(137,180,250,0.1)',
              color: '#89b4fa', cursor: 'pointer',
            }}
          >
            Open
          </button>
        </div>
      );
    }
    title = meta.path;
  } else if ((eventType === 'file_edit' || eventType === 'file_read' || eventType === 'tool_result') && meta?.path) {
    title = meta.path;
  }

  let taskLink: React.ReactNode = null;
  if (eventType === 'tool_result' && meta?.sessionId) {
    const agentLabel = meta.subagentType ? `${meta.subagentType.charAt(0).toUpperCase() + meta.subagentType.slice(1)} agent` : 'Sub-agent';
    icon = '📋';
    title = meta.description || `${agentLabel} task`;
    const sessionId = meta.sessionId;
    taskLink = sessionId && onLoadSession ? (
      <button
        onClick={(e) => { e.stopPropagation(); onLoadSession(sessionId); }}
        style={{
          padding: '4px 10px', fontSize: 11, borderRadius: 6,
          border: '1px solid rgba(137,180,250,0.3)',
          background: 'rgba(137,180,250,0.1)',
          color: '#89b4fa', cursor: 'pointer',
        }}
      >
        🔗 Open {agentLabel}
      </button>
    ) : null;
  }

  const hasDetail = argsContent || resultContent || errorContent || fileInfo || !!taskLink;

  return (
    <div
      style={{
        padding: '8px 12px',
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: '90%',
        alignSelf: 'flex-start',
        cursor: hasDetail ? 'pointer' : 'default',
      }}
      onClick={() => hasDetail && setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, color: titleColor, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {status === 'running' && <ThinkingDots small />}
        {hasDetail && (
          <span style={{ color: '#585b70', fontSize: 10, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            ▶
          </span>
        )}
      </div>

      {expanded && hasDetail && (
        <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fileInfo}
          {eventType === 'file_edit' && meta?.content && <DiffPreview patch={meta.content} />}
          {argsContent}
          {resultContent}
          {errorContent}
          {taskLink}
        </div>
      )}
      {taskLink && !expanded && (
        <div style={{ paddingLeft: 22 }}>{taskLink}</div>
      )}
    </div>
  );
}