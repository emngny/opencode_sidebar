import React from 'react';
import { ChatMessage } from '../../extension/types';
import { Markdown } from './Markdown';
import { DiffChanges } from './DiffChanges';
import { getAgentColor } from './agentColors';

interface Props {
  messages: ChatMessage[];
  onRevert?: (messageId: string) => void;
  revertActive?: boolean;
  onUnrevert?: () => void;
  contextEvents?: Array<{ id: string; name: string; status: string; content: string; meta?: any }>;
  onLoadSession?: (sessionId: string) => void;
  onRespondPermission?: (permId: string, sessionId: string, response: string, remember?: boolean) => void;
}

export function ChatContainer({ messages, onRevert, revertActive, onUnrevert, contextEvents, onLoadSession, onRespondPermission }: Readonly<Props>) {
  if (messages.length === 0 && (!contextEvents || contextEvents.length === 0)) return null;

  const hasContext = contextEvents && contextEvents.length > 0;
  const allDone = contextEvents?.every((e) => e.status === 'completed' || e.status === 'failed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes thinking {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {hasContext && <ContextGroup events={contextEvents!} allDone={!!allDone} />}
      {messages.map((msg) => (
        <div key={msg.id || msg.timestamp}>
          {msg.eventType === 'compacting' ? (
            <CompactionDivider status={msg.eventStatus} />
          ) : msg.role === 'event' ? (
            <EventCard message={msg} onLoadSession={onLoadSession} onRespondPermission={onRespondPermission} />
          ) : msg.role === 'tool' ? (
            <ToolMessage content={msg.content} />
          ) : (
            <ChatBubble message={msg} onRevert={onRevert} />
          )}
        </div>
      ))}
      {revertActive && onUnrevert && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px 12px',
            backgroundColor: 'rgba(137,180,250,0.08)',
            border: '1px solid rgba(137,180,250,0.3)',
            borderRadius: 10,
            fontSize: 12,
            color: '#89b4fa',
          }}
        >
          <span>⏪ Messages reverted</span>
          <button
            onClick={onUnrevert}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(137,180,250,0.3)',
              background: 'rgba(137,180,250,0.1)',
              color: '#89b4fa',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Restore
          </button>
        </div>
      )}
    </div>
  );
}

function ChatBubble({ message, onRevert }: { message: ChatMessage; onRevert?: (id: string) => void }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const agentColor = !isUser ? getAgentColor(message.agent) : null;
  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? '#7c3aed' : '#313244',
        color: '#cdd6f4',
        padding: '10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        maxWidth: '85%',
        wordBreak: 'break-word',
        fontSize: 13,
        lineHeight: 1.5,
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: message.role === 'assistant' && message.isStreaming && !message.content ? 24 : undefined,
        position: 'relative',
        borderLeft: agentColor ? `3px solid ${agentColor.text}` : undefined,
        paddingLeft: agentColor ? 11 : 14,
      }}
      onMouseEnter={(e) => {
        const btns = e.currentTarget.querySelectorAll('.msg-action-btn') as NodeListOf<HTMLElement>;
        btns.forEach((b) => b.style.opacity = '1');
      }}
      onMouseLeave={(e) => {
        const btns = e.currentTarget.querySelectorAll('.msg-action-btn') as NodeListOf<HTMLElement>;
        btns.forEach((b) => b.style.opacity = '0');
      }}
    >
      {message.role === 'assistant' && message.isStreaming && message.content.length < 20 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#89b4fa', fontSize: 12 }}>
          <ThinkingDots />
          <span>Thinking...</span>
        </div>
      )}
      {/* Reasoning section */}
      {message.reasoning && (
        <div style={{ marginBottom: 4 }}>
          <div
            onClick={() => setShowReasoning(!showReasoning)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              fontSize: 11, color: '#6c7086', userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: showReasoning ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            <span>{message.isStreaming ? 'Reasoning...' : 'Reasoned for a few seconds'}</span>
          </div>
          {showReasoning && (
            <div style={{
              marginTop: 4, padding: '8px 10px',
              backgroundColor: 'rgba(137,180,250,0.06)',
              border: '1px solid rgba(137,180,250,0.15)',
              borderRadius: 8,
              fontSize: 11, color: '#a6adc8', lineHeight: 1.5,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 200, overflowY: 'auto',
            }}>
              {message.reasoning}
              {message.isStreaming && <span style={{ display: 'inline-block', animation: 'blink 1s step-end infinite', marginLeft: 2 }}>▌</span>}
            </div>
          )}
        </div>
      )}
      {message.content && (
        message.role === 'assistant' ? (
          <Markdown content={message.content} />
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>{message.role === 'user' ? highlightMentions(message.content) : collapseWhitespace(message.content)}</span>
        )
      )}
      {/* Metadata bar */}
      {!message.isStreaming && (message.agent || message.modelId || message.duration !== undefined) && (
        <div style={{ fontSize: 10, color: '#6c7086', display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {message.agent && (() => {
            const c = getAgentColor(message.agent);
            return (
              <span style={{
                padding: '1px 6px', borderRadius: 4, fontWeight: 500,
                backgroundColor: c?.bg || 'transparent',
                color: c?.text || '#6c7086',
                border: `1px solid ${c?.border || 'transparent'}`,
              }}>
                {message.agent}
              </span>
            );
          })()}
          {(message.agent && message.modelId) && <span>·</span>}
          {message.modelId && <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message.modelId}</span>}
          {(message.modelId && message.duration !== undefined) && <span>·</span>}
          {message.duration !== undefined && <span>{message.duration}s</span>}
          {message.interrupted && <span style={{ color: '#f38ba8' }}>· Interrupted</span>}
        </div>
      )}
      {message.isStreaming && message.content && (
        <span style={{ display: 'inline-block', animation: 'blink 1s step-end infinite', fontSize: 16, lineHeight: 1 }}>
          ▌
        </span>
      )}
      {/* Action buttons */}
      {message.content && !message.isStreaming && (
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
          {isUser && message.id && onRevert && (
            <button
              className="msg-action-btn"
              onClick={(e) => { e.stopPropagation(); onRevert(message.id!); }}
              style={{
                padding: '2px 6px',
                fontSize: 10,
                border: '1px solid #45475a',
                borderRadius: 4,
                background: '#313244',
                color: '#f38ba8',
                cursor: 'pointer',
                opacity: 0,
                transition: 'opacity 0.15s',
              }}
              title="Revert to this point"
            >
              ↺
            </button>
          )}
          <button
            className="msg-action-btn"
            onClick={handleCopy}
            style={{
              padding: '2px 6px',
              fontSize: 10,
              border: '1px solid #45475a',
              borderRadius: 4,
              background: '#313244',
              color: copied ? '#a6e3a1' : '#a6adc8',
              cursor: 'pointer',
              opacity: 0,
              transition: 'opacity 0.15s',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}

function CompactionDivider({ status }: { status?: string }) {
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

function ContextGroup({ events, allDone }: { events: Array<{ id: string; name: string; status: string; content: string; meta?: any }>; allDone: boolean }) {
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

function EventCard({ message, onLoadSession, onRespondPermission }: { message: ChatMessage; onLoadSession?: (id: string) => void; onRespondPermission?: (permId: string, sessionId: string, response: string, remember?: boolean) => void }) {
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

  // Permission prompt
  if (eventType === 'permission') {
    const permType = meta?.permType || 'unknown';
    const patterns = meta?.patterns || [];
    const [responded, setResponded] = React.useState<string | null>(null);
    const handleResponse = (resp: string, remember?: boolean) => {
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
          <span style={{ fontSize: 14 }}>{responded === 'reject' ? '🔒' : '🔓'}</span>
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
          <button onClick={() => handleResponse('once', false)} disabled={!!responded} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(137,180,250,0.3)', background: 'rgba(137,180,250,0.15)', color: '#89b4fa', cursor: responded ? 'not-allowed' : 'pointer', opacity: responded ? 0.6 : 1 }}>Allow once</button>
          <button onClick={() => handleResponse('always', true)} disabled={!!responded} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid #7c3aed', background: '#7c3aed', color: '#fff', cursor: responded ? 'not-allowed' : 'pointer', opacity: responded ? 0.6 : 1 }}>Always</button>
          <button onClick={() => handleResponse('reject', false)} disabled={!!responded} style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid #45475a', background: 'transparent', color: '#f38ba8', cursor: responded ? 'not-allowed' : 'pointer', opacity: responded ? 0.6 : 1 }}>Deny</button>
        </div>
      </div>
    );
  }

  if (status === 'running') {
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

  // Build expandable detail content
  let argsContent: React.ReactNode = null;
  let resultContent: React.ReactNode = null;
  let errorContent: React.ReactNode = null;
  let fileInfo: React.ReactNode = null;

  // Format arguments as key=value
  if (eventType === 'tool_call' && meta?.args) {
    argsContent = formatArgs(meta.args);
  }

  // Handle result
  if (eventType === 'tool_result' && meta?.result) {
    if (typeof meta.result === 'string') {
      resultContent = <pre style={{ margin: 0, fontSize: 10, color: '#6c7086', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{meta.result.slice(0, 500)}{meta.result.length > 500 ? '...' : ''}</pre>;
    } else {
      resultContent = <pre style={{ margin: 0, fontSize: 10, color: '#6c7086', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(meta.result, null, 2).slice(0, 500)}{JSON.stringify(meta.result).length > 500 ? '...' : ''}</pre>;
    }
  }

  // Handle error
  if (status === 'failed' && meta?.error) {
    errorContent = (
      <div style={{ fontSize: 11, color: '#f38ba8', padding: '6px 10px', backgroundColor: 'rgba(243,139,168,0.08)', borderRadius: 6 }}>
        {meta.error}
      </div>
    );
  }

  // Handle file changes
  if ((eventType === 'file_edit' || eventType === 'tool_result') && meta?.path) {
    const added = meta.added ?? 0;
    const deleted = meta.deleted ?? 0;
    if (added > 0 || deleted > 0) {
      fileInfo = (
        <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}>
          <DiffChanges additions={added} deletions={deleted} variant="bars" />
          <span style={{ color: '#a6e3a1' }}>+{added}</span>
          <span style={{ color: '#f38ba8' }}>-{deleted}</span>
        </div>
      );
    }
    title = meta.path;
  }

  // Task link (sub-agent)
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
      {/* Header row */}
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

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fileInfo}
          {argsContent}
          {resultContent}
          {errorContent}
          {taskLink}
        </div>
      )}
      {/* Task link always visible (not just expanded) */}
      {taskLink && !expanded && (
        <div style={{ paddingLeft: 22 }}>{taskLink}</div>
      )}
    </div>
  );
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

function ThinkingDots({ small }: { small?: boolean }) {
  const size = small ? 4 : 6;
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite' }} />
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.2s' }} />
      <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: '#89b4fa', animation: 'thinking 1.4s ease-in-out infinite 0.4s' }} />
    </div>
  );
}

function ToolMessage({ content }: { content: string }) {
  const isRunning = content.includes('running');
  const isCompleted = content.includes('completed') || content.includes('result');
  const isFailed = content.includes('failed') || content.includes('error');

  let icon = '🔧';
  let bgColor = '#1e1e2e';
  if (isRunning) { icon = '⏳'; bgColor = '#181825'; }
  if (isCompleted) { icon = '✅'; bgColor = 'rgba(166,227,161,0.08)'; }
  if (isFailed) { icon = '❌'; bgColor = 'rgba(243,139,168,0.08)'; }

  return (
    <div
      style={{
        fontSize: 12,
        color: '#a6adc8',
        padding: '6px 12px',
        textAlign: 'center',
        backgroundColor: bgColor,
        borderRadius: 8,
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

function highlightMentions(text: string): React.ReactNode {
  // Split by @word patterns, preserve the rest
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (!part.startsWith('@')) return part;
    const name = part.slice(1).toLowerCase();
    const agentColor = getAgentColor(name);
    if (agentColor) {
      return (
        <span key={i} style={{ color: agentColor.text, fontWeight: 500 }}>
          {part}
        </span>
      );
    }
    // File/other mention
    return (
      <span key={i} style={{ color: '#89b4fa' }}>
        {part}
      </span>
    );
  });
}

function collapseWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
