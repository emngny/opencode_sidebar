import React from 'react';
import { useEscapeToClose, useFocusTrap } from '../hooks/useFocusTrap';

interface PopupProps {
  /** Called on Escape and on backdrop click. */
  onClose: () => void;
  /** Accessible name. Ignored when `labelledBy` is set. */
  label?: string;
  /** Id of the visible heading that names this popup. Preferred over `label`. */
  labelledBy?: string;
  /**
   * Modal popups get `aria-modal` and a Tab trap. Anchored popups — dropdowns,
   * suggestion lists — must stay non-modal: the user is still typing in the
   * control that opened them, so focus must not be locked away from it.
   */
  modal?: boolean;
  /** Focused on open. Defaults to the first focusable child, else the panel. */
  initialFocus?: React.RefObject<HTMLElement>;
  /**
   * The control that opened the popup. Focus returns here on close. Pass it
   * whenever there is one — relying on the implicit active element misses
   * openers that were never focused to begin with.
   */
  triggerRef?: React.RefObject<HTMLElement>;
  /** Renders a dimming layer that closes on click. Default true. */
  backdrop?: boolean;
  /** Styles for the dimming layer. */
  backdropStyle?: React.CSSProperties;
  /** Styles for the panel itself. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Shared overlay shell for the sidebar's dialogs. Renders only the semantics and
 * the behaviour — role, `aria-modal`, focus trap, Escape, focus restore — and
 * leaves the visuals to the caller through `style` / `backdropStyle`.
 */
export function Popup({
  onClose,
  label,
  labelledBy,
  modal = true,
  initialFocus,
  triggerRef,
  backdrop = true,
  backdropStyle,
  style,
  children,
}: Readonly<PopupProps>) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Popups are mounted only while open, so the trap is always active here.
  useFocusTrap(panelRef, true, { initialFocus, returnFocus: triggerRef });
  useEscapeToClose(true, onClose);

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      style={style}
    >
      {children}
    </div>
  );

  if (!backdrop) return panel;

  return (
    <div
      style={backdropStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );
}
