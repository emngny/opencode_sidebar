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

  describe('completion styling', () => {
    const icon = (container: HTMLElement): string => container.querySelector('span')?.textContent ?? '';

    it('marks a real file edit with a green tick', () => {
      const { container } = render(<EventCard message={createMessage()} />);

      expect(icon(container)).toBe('✅');
    });

    it('does not mark a finished command as a file change', () => {
      // `lsp_diagnostics completed` changes nothing on disk. Tinting it green
      // made the transcript read as a list of edited files.
      const { container } = render(
        <EventCard
          message={createMessage({
            eventType: 'tool_result',
            content: 'lsp_diagnostics completed',
            eventMeta: { name: 'lsp_diagnostics', result: 'no errors' },
          })}
        />,
      );

      expect(icon(container)).not.toBe('✅');
      expect(icon(container)).toBe('🔧');
    });

    it('still marks a failed tool with the error icon', () => {
      const { container } = render(
        <EventCard
          message={createMessage({
            eventType: 'tool_result',
            eventStatus: 'failed',
            content: 'bash failed',
            eventMeta: { name: 'bash', error: 'exit 1' },
          })}
        />,
      );

      expect(icon(container)).toBe('❌');
    });
  });

  describe('folded file edits', () => {
    it('shows how many edits the card stands for', () => {
      render(<EventCard message={createMessage({ fileEditCount: 3 })} />);

      expect(header(/src\/app\.ts ×3/)).toBeDefined();
    });

    it('leaves an unfolded card without a count', () => {
      render(<EventCard message={createMessage()} />);

      expect(screen.queryByText(/×/)).toBeNull();
    });

    it('reports the summed totals rather than one edit', () => {
      // `groupFileEdits` writes the turn total into eventMeta; the card shows
      // what is there, so the numbers must be the sum.
      render(
        <EventCard
          message={createMessage({ fileEditCount: 3, eventMeta: { path: 'src/app.ts', added: 6, deleted: 2 } })}
        />,
      );

      fireEvent.click(header());

      expect(screen.getByText('+6')).toBeDefined();
      expect(screen.getByText('-2')).toBeDefined();
    });
  });
});
