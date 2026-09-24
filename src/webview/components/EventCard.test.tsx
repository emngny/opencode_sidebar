// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../../shared/types';
import { EventCard } from './EventCard';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'event',
    content: '',
    timestamp: 0,
    id: 'event-1',
    eventType: 'file_edit',
    eventStatus: 'completed',
    eventMeta: { path: 'src/app.ts', added: 3, deleted: 1, content: '@@\n+added\n-removed' },
    ...overrides,
  };
}

function header(name: RegExp = /src\/app\.ts/): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('EventCard', () => {
  it('renders file edits collapsed by default', () => {
    render(<EventCard message={createMessage()} />);

    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('+added')).toBeNull();
  });

  it('expands a file edit when its header is clicked', () => {
    render(<EventCard message={createMessage()} />);

    fireEvent.click(header());

    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('+added')).toBeDefined();
  });

  it('keeps failed events expanded so the error stays visible', () => {
    render(
      <EventCard
        message={createMessage({ eventStatus: 'failed', eventMeta: { path: 'src/app.ts', error: 'write failed' } })}
      />,
    );

    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('write failed')).toBeDefined();
  });

  it('keeps plain tool calls expanded', () => {
    render(
      <EventCard
        message={createMessage({
          eventType: 'tool_call',
          eventStatus: 'running',
          eventMeta: { name: 'bash', args: { command: 'ls' } },
        })}
      />,
    );

    expect(header(/bash: ls/).getAttribute('aria-expanded')).toBe('true');
  });
});
