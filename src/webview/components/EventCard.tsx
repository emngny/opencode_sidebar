import React from 'react';
import { ChatMessage, isRecord } from '../../shared/types';
import { COLORS, FONT_SIZE, RADIUS, SPACE } from '../styles';
import { ThinkingDots } from './ThinkingDots';
import { DiffPreview } from './DiffPreview';
import { DiffChanges } from './DiffChanges';

interface Props {
  message: ChatMessage;
  onLoadSession?: (id: string) => void;
  onRespondPermission?: (permId: string, sessionId: string, response: 'allow' | 'deny', remember?: boolean) => void;
  onOpenDiff?: (filePath: string) => void;
}

function formatArgs(args: unknown): React.ReactNode {
  if (typeof args === 'string') return <span style={{ fontSize: 11, color: COLORS.textDim }}>{args}</span>;
  if (typeof args !== 'object' || args === null)
    return <span style={{ fontSize: 11, color: COLORS.textDim }}>{String(args)}</span>;

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
            <span style={{ color: COLORS.accent, whiteSpace: 'nowrap' }}>{key}</span>
            <span style={{ color: COLORS.text, wordBreak: 'break-word' }}>= {display}</span>
          </div>
        );
      })}
    </div>
  );
}

function EventCardComponent({ message, onLoadSession, onRespondPermission, onOpenDiff }: Readonly<Props>) {
  const eventType = message.eventType;
  const status = message.eventStatus;
  const meta = message.eventMeta;
  // Collapsed by default for file edits and tool results; failures auto-expand so the error is visible.
  const [expanded, setExpanded] = React.useState(
    status === 'failed' || (eventType !== 'tool_result' && eventType !== 'file_edit'),
  );

  let icon = '🔧';
  let titleColor = COLORS.text;
  let borderColor = COLORS.border;
  let bgColor = COLORS.bgLight;

  if (eventType === 'thinking') {
    borderColor = COLORS.textMuted;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          backgroundColor: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: 10,
          fontSize: 12,
          color: COLORS.textDim,
        }}
      >
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
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: COLORS.successTint,
            border: `1px solid ${COLORS.successBorder}`,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: '90%',
            alignSelf: 'flex-start',
            fontSize: 12,
            color: COLORS.green,
          }}
        >
          <span style={{ fontSize: 14 }}>{responded === 'deny' ? '🔒' : '🔓'}</span>
          <span>Permission {responded || 'resolved'}</span>
        </div>
      );
    }
    return (
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: COLORS.accentTint,
          border: `1px solid ${COLORS.accentBorder}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: '90%',
          alignSelf: 'flex-start',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          <span style={{ fontSize: 12, color: COLORS.accent, fontWeight: 500 }}>Permission required</span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textDim, paddingLeft: 24 }}>
          {permType}
          {patterns.length > 0 && (
            <span style={{ color: COLORS.text, fontFamily: 'monospace', marginLeft: 4 }}>{patterns.join(', ')}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, paddingLeft: 24 }}>
          <button
            onClick={() => handleResponse('allow', false)}
            disabled={!!responded}
            style={{
              padding: `${SPACE.xs}px 12px`,
              fontSize: 11,
              borderRadius: RADIUS.md,
              border: `1px solid ${COLORS.accentBorder}`,
              background: COLORS.accentFill,
              color: COLORS.accent,
              cursor: responded ? 'not-allowed' : 'pointer',
              opacity: responded ? 0.6 : 1,
            }}
          >
            Allow once
          </button>
          <button
            onClick={() => handleResponse('allow', true)}
            disabled={!!responded}
            style={{
              padding: `${SPACE.xs}px 12px`,
              fontSize: 11,
              borderRadius: RADIUS.md,
              border: `1px solid ${COLORS.purple}`,
              background: COLORS.purple,
              color: COLORS.onAccent,
              cursor: responded ? 'not-allowed' : 'pointer',
              opacity: responded ? 0.6 : 1,
            }}
          >
            Always
          </button>
          <button
            onClick={() => handleResponse('deny', false)}
            disabled={!!responded}
            style={{
              padding: `${SPACE.xs}px 12px`,
              fontSize: 11,
              borderRadius: RADIUS.md,
              border: `1px solid ${COLORS.border}`,
              background: 'transparent',
              color: COLORS.red,
              cursor: responded ? 'not-allowed' : 'pointer',
              opacity: responded ? 0.6 : 1,
            }}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  if (eventType === 'file_read') {
    icon = '📖';
    borderColor = COLORS.accentBorder;
    bgColor = COLORS.accentTint;
    titleColor = COLORS.accent;
  } else if (status === 'running') {
    icon = '⏳';
    borderColor = COLORS.textMuted;
    titleColor = COLORS.accent;
  } else if (status === 'failed') {
    icon = '❌';
    borderColor = COLORS.dangerBorder;
    bgColor = COLORS.dangerTint;
    titleColor = COLORS.red;
  } else if (status === 'completed' && eventType === 'file_edit') {
    // The one card that is proof a file actually changed: the diff stream
    // already drops zero-change entries, so a green tick here is never a lie.
    icon = '✅';
    borderColor = COLORS.successBorder;
    bgColor = COLORS.successTint;
    titleColor = COLORS.green;
  } else if (status === 'completed') {
    // Everything else that finished — commands, diagnostics, sub-agent runs —
    // changes nothing on disk, so it keeps the neutral default. Tinting these
    // green made the transcript read as a list of files the agent had edited.
    icon = '🔧';
    borderColor = COLORS.border;
    bgColor = COLORS.bgLight;
    titleColor = COLORS.text;
  }

  let title = message.content;
  const toolName = meta?.name || eventType?.replace('_', ' ') || 'tool';

  // Show the actual command/input so repeated "bash completed" cards are distinguishable
  if ((eventType === 'tool_result' || eventType === 'tool_call') && meta?.args) {
    const a = meta.args;
    let cmd: unknown = null;
    if (typeof a !== 'string' && isRecord(a) && 'command' in a) {
      cmd = (a as Record<string, unknown>)['command'];
    }
    let commandText = '';
    if (Array.isArray(cmd)) {
      commandText = (cmd as unknown[]).join(' ');
    } else if (typeof cmd === 'string') {
      commandText = cmd;
    } else if (isRecord(a) && 'description' in a) {
      commandText = String((a as Record<string, unknown>)['description']);
    }
    const cmdText = commandText;
    if (cmdText) {
      const short = cmdText.length > 70 ? cmdText.slice(0, 70) + '...' : cmdText;
      title = status === 'running' ? `${toolName}: ${short}` : `${toolName} ✓ ${short}`;
    }
  }
  if (message.eventCount && message.eventCount > 1) {
    title = `${title} ×${message.eventCount}`;
  }

  let argsContent: React.ReactNode = null;
  let resultContent: React.ReactNode = null;
  let errorContent: React.ReactNode = null;
  let fileInfo: React.ReactNode = null;

  if ((eventType === 'tool_call' || eventType === 'tool_result') && meta?.args) {
    argsContent = formatArgs(meta.args);
  }

  if (eventType === 'tool_result' && meta?.result) {
    if (typeof meta.result === 'string') {
      resultContent = (
        <pre
          style={{
            margin: 0,
            fontSize: FONT_SIZE.xs,
            color: COLORS.textDim,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {meta.result.slice(0, 500)}
          {meta.result.length > 500 ? '...' : ''}
        </pre>
      );
    } else {
      resultContent = (
        <pre
          style={{
            margin: 0,
            fontSize: FONT_SIZE.xs,
            color: COLORS.textDim,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {JSON.stringify(meta.result, null, 2).slice(0, 500)}
          {JSON.stringify(meta.result).length > 500 ? '...' : ''}
        </pre>
      );
    }
  }

  if (status === 'failed' && meta?.error) {
    errorContent = (
      <div
        style={{
          fontSize: 11,
          color: COLORS.red,
          padding: '6px 12px',
          backgroundColor: COLORS.dangerTint,
          borderRadius: RADIUS.md,
        }}
      >
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
          <span style={{ color: COLORS.green }}>+{added}</span>
          <span style={{ color: COLORS.red }}>-{deleted}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (meta.path) onOpenDiff?.(meta.path);
            }}
            style={{
              marginLeft: 8,
              padding: `${SPACE.hair}px 8px`,
              fontSize: FONT_SIZE.xs,
              borderRadius: RADIUS.sm,
              border: `1px solid ${COLORS.accentBorder}`,
              background: COLORS.accentFill,
              color: COLORS.accent,
              cursor: 'pointer',
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
    const agentLabel = meta.subagentType
      ? `${meta.subagentType.charAt(0).toUpperCase() + meta.subagentType.slice(1)} agent`
      : 'Sub-agent';
    icon = '📋';
    title = meta.description || `${agentLabel} task`;
    const sessionId = meta.sessionId;
    taskLink =
      sessionId && onLoadSession ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLoadSession(sessionId);
          }}
          style={{
            padding: '4px 12px',
            fontSize: 11,
            borderRadius: RADIUS.md,
            border: `1px solid ${COLORS.accentBorder}`,
            background: COLORS.accentFill,
            color: COLORS.accent,
            cursor: 'pointer',
          }}
        >
          🔗 Open {agentLabel}
        </button>
      ) : null;
  }

  // Appended last: the title is reassigned further up for paths and sub-agent
  // tasks, so a count added earlier would be overwritten.
  if (message.fileEditCount && message.fileEditCount > 1) {
    title = `${title} ×${message.fileEditCount}`;
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
        cursor: 'default',
      }}
    >
      <button
        type="button"
        disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined}
        onClick={() => hasDetail && setExpanded((current) => !current)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: 0,
          border: 'none',
          background: 'none',
          color: 'inherit',
          textAlign: 'left',
          cursor: hasDetail ? 'pointer' : 'default',
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span
          style={{
            fontSize: 12,
            color: titleColor,
            fontWeight: 500,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {status === 'running' && <ThinkingDots small />}
        {hasDetail && (
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
        )}
      </button>

      {expanded && hasDetail && (
        <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fileInfo}
          {eventType === 'file_edit' && meta?.content && <DiffPreview patch={meta.content} />}
          {argsContent}
          {resultContent}
          {errorContent}
          {taskLink}
        </div>
      )}
      {taskLink && !expanded && <div style={{ paddingLeft: 24 }}>{taskLink}</div>}
    </div>
  );
}

export const EventCard = React.memo(EventCardComponent);
