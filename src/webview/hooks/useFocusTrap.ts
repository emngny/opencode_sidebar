import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** A candidate is reachable only if it is not hidden from the accessibility tree. */
function isReachable(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  return el.closest('[hidden], [aria-hidden="true"]') === null;
}

/** Focusable descendants of `root`, in DOM order. */
export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isReachable);
}

interface FocusTrapOptions {
  /** Focused on activation. Falls back to the first focusable, then the container. */
  initialFocus?: RefObject<HTMLElement>;
  /**
   * Focused on deactivation. Defaults to whatever was focused when the trap
   * activated, which is not always the opener: a mouse click that never moved
   * focus, or focus that wandered elsewhere while the popup was open.
   */
  returnFocus?: RefObject<HTMLElement>;
  /** Hand focus back on deactivation at all. Default true. */
  restoreFocus?: boolean;
}

/**
 * Confines Tab navigation to `containerRef` while `active`, moves focus into the
 * container on activation, and hands it back to the opener on deactivation.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  active: boolean,
  { initialFocus, returnFocus, restoreFocus = true }: FocusTrapOptions = {},
): void {
  const optionsRef = useRef({ initialFocus, returnFocus, restoreFocus });
  optionsRef.current = { initialFocus, returnFocus, restoreFocus };
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    // Capture the opener before focus moves inside, otherwise the panel itself wins.
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const target = optionsRef.current.initialFocus?.current ?? getFocusableElements(containerRef.current)[0];
    (target ?? containerRef.current)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(containerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;
      const outside = !containerRef.current?.contains(focused);
      if (event.shiftKey && (focused === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (!optionsRef.current.restoreFocus) return;
      // The opener can unmount while the popup is open (the list item that
      // launched it is deleted, the view is swapped), so only refocus elements
      // that are still in the document.
      const target = optionsRef.current.returnFocus?.current ?? openerRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [active]);
}

/**
 * Runs `onClose` when Escape is pressed. Registered on the capture phase and
 * skipped once another handler has claimed the key, so the topmost layer wins
 * and nested popups do not all close at once.
 */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [active]);
}
