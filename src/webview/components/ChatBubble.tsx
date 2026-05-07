import React from 'react';
import { ChatMessage } from '../../extension/types';
import { Markdown } from './Markdown';
import { getAgentColor } from './agentColors';
import { ThinkingDots } from './ThinkingDots';
import { COLORS, textNormal, textSmall, flexRow, gap } from '../styles';

interface Props {
  message: ChatMessage;
  onRevert?: (id: string) => void;
}

function highlightMentions(text: string): React.ReactNode {
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

export function ChatBubble({ message, onRevert }: Readonly<Props>) {
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
        <div style={{ ...flexRow, color: COLORS.accent, fontSize: 12, gap: 8 }}>
          <ThinkingDots />
          <span>Thinking...</span>
        </div>
      )}
      {message.reasoning && (
        <div style={{ marginBottom: 4 }}>
          <div
            onClick={() => setShowReasoning(!showReasoning)}
            style={{ ...flexRow, gap: 6, cursor: 'pointer', fontSize: 11, color: COLORS.textDim, userSelect: 'none' }}
          >
            <span>{showReasoning ? '▾' : '▸'}</span>
            <span>Reasoning ({message.reasoning.length} chars)</span>
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