// @vitest-environment jsdom

import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Popup } from './Popup';
import { ConfirmDialog } from './ConfirmDialog';
import { ModelSelector } from './ModelSelector';
import { SessionListPopup } from './SessionListPopup';
import { SlashCommandPopup, SLASH_LISTBOX_ID, slashOptionId } from './SlashCommandPopup';
import * as vscodeApi from '../vscode-api';

vi.mock('../vscode-api', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => undefined),
}));

/** Pushes a `sessionList` payload through the handler the popup registered. */
function deliverSessions(sessions: Array<{ id: string; title?: string }>): void {
  const { onMessage } = vi.mocked(vscodeApi);
  const handler = onMessage.mock.calls.at(-1)?.[0] as (msg: unknown) => void;
  act(() => handler({ type: 'sessionList', payload: sessions }));
}

function FocusableButtons() {
  return (
    <>
      <button type="button">first</button>
      <button type="button">second</button>
      <button type="button">third</button>
    </>
  );
}

describe('Popup semantics', () => {
  it('exposes a modal dialog by default', () => {
    render(
      <Popup label="Example" onClose={() => undefined}>
        <FocusableButtons />
      </Popup>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Example' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('omits aria-modal for an anchored, non-modal popup', () => {
    render(
      <Popup label="Example" modal={false} backdrop={false} onClose={() => undefined}>
        <FocusableButtons />
      </Popup>,
    );

    expect(screen.getByRole('dialog', { name: 'Example' })).not.toHaveAttribute('aria-modal');
  });

  it('names the dialog from its visible heading when one is given', () => {
    render(
      <Popup labelledBy="popup-heading" onClose={() => undefined}>
        <h2 id="popup-heading">Manage Models</h2>
      </Popup>,
    );

    expect(screen.getByRole('dialog', { name: 'Manage Models' })).toBeInTheDocument();
  });
});

describe('Popup focus behaviour', () => {
  it('moves focus to the first focusable child on open', () => {
    render(
      <Popup label="Example" onClose={() => undefined}>
        <FocusableButtons />
      </Popup>,
    );

    expect(screen.getByText('first')).toHaveFocus();
  });

  it('honours an explicit initial focus target', () => {
    function WithTarget() {
      const target = useRef<HTMLButtonElement>(null);
      return (
        <Popup label="Example" initialFocus={target} onClose={() => undefined}>
          <button type="button">first</button>
          <button type="button" ref={target}>
            danger
          </button>
        </Popup>
      );
    }

    render(<WithTarget />);

    expect(screen.getByText('danger')).toHaveFocus();
  });

  it('wraps Tab from the last element back to the first', () => {
    render(
      <Popup label="Example" onClose={() => undefined}>
        <FocusableButtons />
      </Popup>,
    );

    const last = screen.getByText('third');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    expect(screen.getByText('first')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first element back to the last', () => {
    render(
      <Popup label="Example" onClose={() => undefined}>
        <FocusableButtons />
      </Popup>,
    );

    const first = screen.getByText('first');
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });

    expect(screen.getByText('third')).toHaveFocus();
  });

  it('returns focus to the opener when it closes', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          {open && (
            <Popup label="Example" onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>
                close
              </button>
              <FocusableButtons />
            </Popup>
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Example' })).toBeInTheDocument();
    expect(screen.getByText('close')).toHaveFocus();

    fireEvent.click(screen.getByText('close'));

    expect(trigger).toHaveFocus();
  });

  it('returns focus to an explicit trigger even when the opener was never focused', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
            open
          </button>
          {open && (
            <Popup label="Example" triggerRef={triggerRef} onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>
                close
              </button>
            </Popup>
          )}
        </>
      );
    }

    render(<Harness />);
    // The trigger is never focused, so the implicit opener would be <body>.
    fireEvent.click(screen.getByText('open'));

    fireEvent.click(screen.getByText('close'));

    expect(screen.getByText('open')).toHaveFocus();
  });

  it('does not throw when the opener unmounts while the popup is open', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          {!open && (
            <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
              open
            </button>
          )}
          {open && (
            <Popup label="Example" triggerRef={triggerRef} onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>
                close
              </button>
            </Popup>
          )}
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText('open'));

    // The trigger is gone by the time the popup tears down.
    expect(screen.queryByText('open')).toBeNull();
    expect(() => fireEvent.click(screen.getByText('close'))).not.toThrow();
  });
});

describe('Popup dismissal', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Popup label="Example" onClose={onClose}>
        <FocusableButtons />
      </Popup>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores keys other than Escape', () => {
    const onClose = vi.fn();
    render(
      <Popup label="Example" onClose={onClose}>
        <FocusableButtons />
      </Popup>,
    );

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not on a panel click', () => {
    const onClose = vi.fn();
    render(
      <Popup label="Example" onClose={onClose}>
        <FocusableButtons />
      </Popup>,
    );

    fireEvent.click(screen.getByText('first'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog', { name: 'Example' }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no backdrop when asked not to', () => {
    const onClose = vi.fn();
    render(
      <Popup label="Example" backdrop={false} onClose={onClose}>
        <FocusableButtons />
      </Popup>,
    );

    // Nothing outside the panel to click, so no click reaches the dismiss handler.
    fireEvent.click(screen.getByRole('dialog', { name: 'Example' }).parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a modal dialog named by its message', () => {
    render(<ConfirmDialog message="Revert this message?" onConfirm={() => undefined} onCancel={() => undefined} />);

    const dialog = screen.getByRole('dialog', { name: 'Revert this message?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('focuses Cancel, never the destructive action', () => {
    render(<ConfirmDialog message="Revert this message?" onConfirm={() => undefined} onCancel={() => undefined} />);

    expect(screen.getByText('Cancel')).toHaveFocus();
    expect(screen.getByText('Revert')).not.toHaveFocus();
  });

  it('treats Escape as cancel, not confirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog message="Revert this message?" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('SessionListPopup', () => {
  it('is a modal dialog named by its heading and closes on Escape', () => {
    const onClose = vi.fn();
    render(<SessionListPopup onClose={onClose} onSelect={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Session History' })).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels each delete control for screen readers', () => {
    render(<SessionListPopup onClose={() => undefined} onSelect={() => undefined} />);
    deliverSessions([{ id: 'abcdef123456', title: 'Fix the parser' }]);

    expect(screen.getByRole('button', { name: 'Delete Fix the parser' })).toBeInTheDocument();
  });

  it('does not nest the delete control inside the session button', () => {
    const { container } = render(<SessionListPopup onClose={() => undefined} onSelect={() => undefined} />);
    deliverSessions([{ id: 'abcdef123456', title: 'Fix the parser' }]);

    expect(container.querySelector('button button')).toBeNull();
  });
});

describe('ModelSelector', () => {
  const models = [{ id: 'acme/one', name: 'Acme One', providerId: 'acme' }];

  it('exposes a real button trigger that advertises the popup', () => {
    render(<ModelSelector model="acme/one" onChange={() => undefined} availableModels={models} />);

    const trigger = screen.getByRole('button', { name: /Change model/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a non-modal dialog, then returns focus to the trigger on Escape', () => {
    render(<ModelSelector model="acme/one" onChange={() => undefined} availableModels={models} />);
    const trigger = screen.getByRole('button', { name: /Change model/ });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Select model' });
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('Search models...')).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Select model' })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe('SlashCommandPopup', () => {
  it('is a listbox whose options report their selected state', () => {
    render(
      <Popup label="unused" backdrop={false} onClose={() => undefined} modal={false}>
        <SlashCommandPopup
          filter=""
          skills={[{ name: 'review' }]}
          onSelect={() => undefined}
          onClose={() => undefined}
        />
      </Popup>,
    );

    const listbox = screen.getByRole('listbox', { name: 'Commands and skills' });
    expect(listbox).toHaveAttribute('id', SLASH_LISTBOX_ID);

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('id', slashOptionId(0));
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('points the input at the highlighted option instead of stealing focus', () => {
    function Harness() {
      const inputRef = useRef<HTMLTextAreaElement>(null);
      return (
        <>
          <textarea ref={inputRef} role="combobox" aria-expanded aria-controls={SLASH_LISTBOX_ID} />
          <SlashCommandPopup
            filter=""
            skills={[{ name: 'review' }]}
            onSelect={() => undefined}
            onClose={() => undefined}
            comboboxRef={inputRef}
          />
        </>
      );
    }

    render(<Harness />);
    const input = screen.getByRole('combobox');
    input.focus();

    expect(input).toHaveAttribute('aria-activedescendant', slashOptionId(0));
    expect(input).toHaveFocus();

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', slashOptionId(1));
    expect(input).toHaveFocus();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<SlashCommandPopup filter="" skills={[]} onSelect={() => undefined} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
