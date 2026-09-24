// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../../shared/types';
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
