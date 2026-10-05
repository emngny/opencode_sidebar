// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomInput } from './BottomInput';
import type { CommandSummary } from '../../shared/types';

const SERVER_COMMANDS: CommandSummary[] = [
  { name: 'brainstorming', description: 'Use before creative work', source: 'command' },
  { name: 'brainstorm-plan', description: 'Ask questions, then plan', source: 'command' },
];

function renderInput(overrides: Partial<React.ComponentProps<typeof BottomInput>> = {}) {
  const onSend = vi.fn();
  const onSlashCommand = vi.fn();
  const utils = render(
    <BottomInput
      onSend={onSend}
      disabled={false}
      onSearchFiles={vi.fn()}
      fileSearchResults={[]}
      fileSearchQuery=""
      onSlashCommand={onSlashCommand}
      skills={[]}
      commands={SERVER_COMMANDS}
      agents={['Sisyphus - ultraworker']}
      {...overrides}
    />,
  );
  const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
  return { onSend, onSlashCommand, textarea, utils };
}

/** Types `/query` so the popup opens on that filter. */
function openPopup(textarea: HTMLTextAreaElement, query: string) {
  fireEvent.change(textarea, { target: { value: `/${query}` } });
}

describe('BottomInput slash selection', () => {
  /**
   * Selecting a command used to send it immediately, with no way to attach a
   * message. Most commands take arguments, so the user has to be able to keep
   * typing — the pick fills the field and the send happens on Enter.
   */
  it('does not send when a command is selected', () => {
    const { onSend, textarea } = renderInput();
    openPopup(textarea, 'brainstorm');

    const option = screen.getByRole('option', { name: /brainstorming/ });
    fireEvent.click(option);

    expect(onSend).not.toHaveBeenCalled();
  });

  it('fills the field with the command and a trailing space', () => {
    const { textarea } = renderInput();
    openPopup(textarea, 'brainstorm');

    fireEvent.click(screen.getByRole('option', { name: /brainstorming/ }));

    expect(textarea.value).toBe('/brainstorming ');
  });

  it('lets the user keep typing the arguments after selecting', () => {
    const { textarea } = renderInput();
    openPopup(textarea, 'brainstorm');
    fireEvent.click(screen.getByRole('option', { name: /brainstorming/ }));

    fireEvent.change(textarea, { target: { value: '/brainstorming add auth' } });

    expect(textarea.value).toBe('/brainstorming add auth');
  });

  it('closes the popup after selection so typing arguments does not re-filter', () => {
    const { textarea } = renderInput();
    openPopup(textarea, 'brainstorm');
    expect(screen.getByRole('listbox', { name: 'Commands and skills' })).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: /brainstorming/ }));

    expect(screen.queryByRole('listbox', { name: 'Commands and skills' })).toBeNull();
  });

  it('sends the filled command once the user presses Enter', () => {
    const { onSend, textarea } = renderInput();
    openPopup(textarea, 'brainstorm');
    fireEvent.click(screen.getByRole('option', { name: /brainstorming/ }));

    fireEvent.change(textarea, { target: { value: '/brainstorming add auth' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('/brainstorming add auth');
  });

  it('sends a bare command with no arguments', () => {
    const { onSend, textarea } = renderInput();
    openPopup(textarea, 'brainstorm');
    fireEvent.click(screen.getByRole('option', { name: /brainstorming/ }));

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('/brainstorming', []);
  });

  /**
   * `/new` has no arguments and nothing to type, so selecting it is the action.
   * The command still arrives through `onSlashCommand`; only the send is left
   * to the user.
   */
  it('still reports the pick without sending, so /new can act on it', () => {
    const { onSend, onSlashCommand, textarea } = renderInput({
      commands: [{ name: 'new', description: 'Start a fresh chat session', source: 'command' }],
    });
    openPopup(textarea, 'new');

    fireEvent.click(screen.getByRole('option', { name: /\/new/ }));

    expect(onSlashCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'new' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('/new ');
  });

  it('does not send a workspace skill either', () => {
    const { onSend, textarea } = renderInput({ skills: [{ name: 'local-skill' }] });
    openPopup(textarea, 'local');

    fireEvent.click(screen.getByRole('option', { name: /local-skill/ }));

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('/local-skill ');
  });
});
