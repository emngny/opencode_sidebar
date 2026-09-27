// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../../shared/types';
import { AA_TEXT, contrastRatio } from '../contrast';
import { ChatBubble, resolveModelLabel } from './ChatBubble';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { role: 'assistant', content: '', timestamp: 0, id: 'msg-1', ...overrides };
}

const catalog = [
  { id: 'omniroute/pro-models', name: 'Pro Models' },
  { id: 'opencode/mimo', name: 'MiMo V2.6 Flash Free' },
];

describe('ChatBubble empty output', () => {
  it('marks a finished assistant turn that produced no text', () => {
    render(<ChatBubble message={createMessage({ agent: 'plan', modelId: 'omniroute/pro-models' })} />);

    expect(screen.getByText('No response text')).toBeDefined();
  });

  it('does not mark a turn that has content', () => {
    render(<ChatBubble message={createMessage({ content: 'all done' })} />);

    expect(screen.queryByText('No response text')).toBeNull();
  });

  it('does not mark a turn that is still streaming', () => {
    render(<ChatBubble message={createMessage({ isStreaming: true })} />);

    expect(screen.queryByText('No response text')).toBeNull();
    expect(screen.getByText('Thinking...')).toBeDefined();
  });

  it('does not mark a user message', () => {
    render(<ChatBubble message={createMessage({ role: 'user' })} />);

    expect(screen.queryByText('No response text')).toBeNull();
  });
});

describe('ChatBubble model label', () => {
  it('shows the catalog name the model picker uses', () => {
    render(<ChatBubble message={createMessage({ modelId: 'omniroute/pro-models' })} availableModels={catalog} />);

    expect(screen.getByText('Pro Models')).toBeDefined();
    expect(screen.getByTitle('omniroute/pro-models')).toBeDefined();
  });

  it('falls back to the raw id when the catalog lacks the model', () => {
    render(<ChatBubble message={createMessage({ modelId: 'ghost/model' })} availableModels={catalog} />);

    expect(screen.getByText('ghost/model')).toBeDefined();
  });

  it('resolves labels without a catalog', () => {
    expect(resolveModelLabel('a/b')).toBe('a/b');
    expect(resolveModelLabel('a/b', catalog)).toBe('a/b');
  });
});

describe('ChatBubble accessibility live region', () => {
  it('places assistant content inside a polite live region while streaming', () => {
    const { container } = render(
      <ChatBubble message={createMessage({ content: 'partial answer', isStreaming: true })} />,
    );

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('partial answer');
  });

  it('places finished assistant content inside a polite live region', () => {
    const { container } = render(<ChatBubble message={createMessage({ content: 'final answer' })} />);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('final answer');
  });

  it('does not put user-typed content in a live region', () => {
    const { container } = render(<ChatBubble message={createMessage({ role: 'user', content: 'my question' })} />);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeNull();
  });

  it('hides the blinking streaming cursor from screen readers', () => {
    render(<ChatBubble message={createMessage({ content: 'streaming', isStreaming: true })} />);

    for (const cursor of screen.getAllByText('▌')) {
      expect(cursor.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('ChatBubble model override', () => {
  it('flags a model the selected agent substituted', () => {
    render(
      <ChatBubble
        message={createMessage({
          agent: 'plan',
          modelId: 'omniroute/pro-models',
          requestedModelId: 'opencode/mimo',
        })}
        availableModels={catalog}
      />,
    );

    expect(screen.getByText('Pro Models')).toBeDefined();
    expect(screen.getByText(/asked for MiMo V2\.6 Flash Free/)).toBeDefined();
  });

  it('stays quiet when the requested model actually ran', () => {
    render(
      <ChatBubble
        message={createMessage({ modelId: 'opencode/mimo', requestedModelId: 'opencode/mimo' })}
        availableModels={catalog}
      />,
    );

    expect(screen.queryByText(/asked for/)).toBeNull();
  });

  it('stays quiet when the request model is unknown', () => {
    render(<ChatBubble message={createMessage({ modelId: 'opencode/mimo' })} />);

    expect(screen.queryByText(/asked for/)).toBeNull();
  });
});

describe('ChatBubble contrast', () => {
  function bubbleRatio(role: 'user' | 'assistant'): number {
    const { container, unmount } = render(<ChatBubble message={createMessage({ role, content: 'hello' })} />);
    const bubble = container.querySelector<HTMLElement>('.msg-bubble');
    if (!bubble) throw new Error('bubble not rendered');
    const ratio = contrastRatio(bubble.style.color, bubble.style.backgroundColor);
    unmount();
    return ratio;
  }

  it('keeps the user bubble legible on the purple fill', () => {
    expect(bubbleRatio('user')).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the assistant bubble legible', () => {
    expect(bubbleRatio('assistant')).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
