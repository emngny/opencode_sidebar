import React from 'react';
import { ChatMessage } from '../../shared/types';
import { Markdown } from './Markdown';
import { getAgentColor } from './agentColors';
import { ThinkingDots } from './ThinkingDots';
import { COLORS, FONT_SIZE, RADIUS, SHADOW, flexRow } from '../styles';

interface Props {
  message: ChatMessage;
  onRevert?: (id: string) => void;
  /** Model catalog, used to show the same display name as the model picker. */
  availableModels?: Array<{ id: string; name: string }>;
}

function highlightMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part) => {
    if (!part.startsWith('@')) return part;
    const name = part.slice(1).toLowerCase();
    const agentColor = getAgentColor(name);
    if (agentColor) {
      return (
        <span key={part} style={{ color: agentColor.text, fontWeight: 500 }}>
          {part}
        </span>
      );
    }
    return (
      <span key={part} style={{ color: COLORS.accent }}>
        {part}
      </span>
    );
  });
}

function collapseWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Resolves a raw `provider/model` id to the catalog display name so the
 * transcript and the model picker label the same model the same way.
 */
export function resolveModelLabel(modelId: string, models?: Array<{ id: string; name: string }>): string {
  return models?.find((model) => model.id === modelId)?.name || modelId;
}

function ChatBubbleComponent({ message, onRevert, availableModels }: Readonly<Props>) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const agentColor = !isUser ? getAgentColor(message.agent) : null;
  const hasBody = Boolean(message.content || message.reasoning);
  const modelLabel = message.modelId ? resolveModelLabel(message.modelId, availableModels) : undefined;
  // A selected agent can pin its own model server-side, which silently overrides
  // the model picker. Surface that instead of showing an unexplained model name.
  const modelOverridden = Boolean(
    message.modelId && message.requestedModelId && message.requestedModelId !== message.modelId,
  );
  const requestedLabel = message.requestedModelId
    ? resolveModelLabel(message.requestedModelId, availableModels)
    : undefined;
  // A turn can end with no text at all (tool-only or empty response).
  // Without an explicit marker the bubble renders as a bare badge with no content.
  const showEmptyOutput = message.role === 'assistant' && !message.isStreaming && !hasBody;
  const handleCopy = () => {
    navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  return (
    <div
      className="msg-bubble"
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? COLORS.purple : COLORS.bgHover,
        // White is the only foreground that clears 4.5:1 on the purple bubble.
        color: isUser ? COLORS.onAccent : COLORS.text,
        padding: '12px 16px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        maxWidth: '85%',
        wordBreak: 'break-word',
        fontSize: 13,
        lineHeight: 1.5,
        boxShadow: SHADOW.sm,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: message.role === 'assistant' && message.isStreaming && !message.content ? 24 : undefined,
        position: 'relative',
        animation: 'message-rise 180ms ease-out',
        borderLeft: agentColor ? `3px solid ${agentColor.text}` : undefined,
        // The 3px agent border eats into the content box, so the bordered
        // variant starts 4px tighter. The step is the border plus a pixel of
        // optical slack, not an off-scale measurement.
        paddingLeft: agentColor ? 12 : 16,
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
          <button
            type="button"
            onClick={() => setShowReasoning((visible) => !visible)}
            style={{
              ...flexRow,
              gap: 6,
              cursor: 'pointer',
              fontSize: 11,
              color: COLORS.textDim,
              userSelect: 'none',
              background: 'none',
              border: 'none',
              padding: 0,
              textAlign: 'left',
            }}
          >
            <span>{showReasoning ? '▾' : '▸'}</span>
            <span>Reasoning ({message.reasoning.length} chars)</span>
          </button>
          {showReasoning && (
            <div
              style={{
                marginTop: 4,
                padding: '8px 12px',
                backgroundColor: COLORS.accentTint,
                border: `1px solid ${COLORS.accentBorder}`,
                borderRadius: RADIUS.lg,
                fontSize: 11,
                color: COLORS.textDim,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {message.reasoning}
              {message.isStreaming && (
                <span
                  aria-hidden="true"
                  style={{ display: 'inline-block', animation: 'blink 1s step-end infinite', marginLeft: 2 }}
                >
                  ▌
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {message.content &&
        (message.role === 'assistant' ? (
          <div aria-live="polite" aria-atomic={false}>
            <Markdown content={message.content} />
          </div>
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>
            {message.role === 'user' ? highlightMentions(message.content) : collapseWhitespace(message.content)}
          </span>
        ))}
      {showEmptyOutput && (
        <span style={{ fontSize: 11, color: COLORS.textDim, fontStyle: 'italic' }}>No response text</span>
      )}
      {!message.isStreaming && (message.agent || message.modelId || message.duration !== undefined) && (
        <div
          style={{
            fontSize: FONT_SIZE.xs,
            color: COLORS.textDim,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            marginTop: 2,
            flexWrap: 'wrap',
          }}
        >
          {message.agent &&
            (() => {
              const c = getAgentColor(message.agent);
              return (
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: RADIUS.sm,
                    fontWeight: 500,
                    backgroundColor: c?.bg || 'transparent',
                    color: c?.text || COLORS.textDim,
                    border: `1px solid ${c?.border || 'transparent'}`,
                  }}
                >
                  {message.agent}
                </span>
              );
            })()}
          {message.agent && message.modelId && <span>·</span>}
          {message.modelId && (
            <span
              title={message.modelId}
              style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {modelLabel}
            </span>
          )}
          {modelOverridden && (
            <span
              title={`Requested ${message.requestedModelId}, but agent "${message.agent ?? 'unknown'}" pins ${message.modelId}`}
              style={{ color: COLORS.yellow }}
            >
              ⚠ asked for {requestedLabel}
            </span>
          )}
          {message.modelId && message.duration !== undefined && <span>·</span>}
          {message.duration !== undefined && <span>{message.duration}s</span>}
          {message.interrupted && <span style={{ color: COLORS.red }}>· Interrupted</span>}
        </div>
      )}
      {message.isStreaming && message.content && (
        <span
          aria-hidden="true"
          style={{ display: 'inline-block', animation: 'blink 1s step-end infinite', fontSize: 16, lineHeight: 1 }}
        >
          ▌
        </span>
      )}
      {message.content && !message.isStreaming && (
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
          {isUser && message.id && onRevert && (
            <button
              className="msg-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRevert(message.id!);
              }}
              style={{
                padding: '2px 6px',
                minWidth: 24,
                minHeight: 24,
                fontSize: FONT_SIZE.xs,
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS.sm,
                background: COLORS.bgHover,
                color: COLORS.red,
                cursor: 'pointer',
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
              minWidth: 24,
              minHeight: 24,
              fontSize: FONT_SIZE.xs,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADIUS.sm,
              background: COLORS.bgHover,
              color: copied ? COLORS.green : COLORS.textDim,
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}

export const ChatBubble = React.memo(ChatBubbleComponent);
