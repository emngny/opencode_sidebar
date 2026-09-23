// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatContainer } from './ChatContainer';
import {
  DEFAULT_VISIBLE_MESSAGE_COUNT,
  expandVisibleCount,
  getVisibleWindow,
} from './ChatContainer.windowing';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ChatContainer message windowing', () => {
  it('returns only latest 50 messages by default', () => {
    const messages = Array.from({ length: 1000 }, (_, index) => ({ id: String(index) }));

    expect(getVisibleWindow(messages, DEFAULT_VISIBLE_MESSAGE_COUNT)).toEqual({
      messages: messages.slice(950),
      hiddenCount: 950,
      hasMore: true,
    });
  });

  it('returns every message when history fits in window', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({ id: String(index) }));

    expect(getVisibleWindow(messages, DEFAULT_VISIBLE_MESSAGE_COUNT)).toEqual({
      messages,
      hiddenCount: 0,
      hasMore: false,
    });
  });

  it('expands one batch without exceeding message count', () => {
    expect(expandVisibleCount(50, 120)).toBe(100);
    expect(expandVisibleCount(100, 120)).toBe(120);
    expect(expandVisibleCount(120, 120)).toBe(120);
  });

  it('renders only latest 50 message rows and expands on request', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const messages = Array.from({ length: 1000 }, (_, index) => ({
      role: 'user' as const,
      content: `Message ${index}`,
      timestamp: index,
      id: String(index),
    }));

    act(() => root.render(React.createElement(ChatContainer, { messages })));
    expect(container.querySelectorAll('[data-testid="chat-message"]')).toHaveLength(DEFAULT_VISIBLE_MESSAGE_COUNT);
    expect(container.textContent).not.toContain('Message 949');

    const loadOlder = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Load older');
    act(() => loadOlder?.click());

    expect(container.querySelectorAll('[data-testid="chat-message"]')).toHaveLength(100);
    expect(container.textContent).toContain('Message 900');
  });
});
