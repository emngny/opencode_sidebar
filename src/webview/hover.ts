import { CSSProperties, type MouseEvent } from 'react';

type StyleKey = keyof CSSProperties;

export interface HoverHandlers {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Enter/leave pair for a visual-only hover state.
 *
 * `leave` restores only the keys `enter` touched. A generic "clear styles"
 * helper would do `style.cssText = ''`, which also wipes React's own inline
 * styles and leaves the element bare for as long as the mouse stays on it —
 * so this takes an explicit target instead of offering a blanket reset.
 *
 * For a key `enter` sets and `leave` does not name, the value that was on the
 * element *before* the hover is put back, not a blank. Blank only works when
 * React owns nothing on that key; if React set it inline, a blank erases it
 * with nothing to re-apply until the next render.
 *
 * `leave` may be a function when the resting style depends on state (a
 * toggle, a selected row), which is the case that forced the hand-rolled
 * ternaries this replaces.
 */
export function hoverable(enter: CSSProperties, leave: CSSProperties | (() => CSSProperties) = {}): HoverHandlers {
  const keys = Object.keys(enter) as StyleKey[];
  const resolve = () => (typeof leave === 'function' ? leave() : leave);
  let restore: Partial<Record<StyleKey, string>> = {};

  return {
    onMouseEnter: (event) => {
      const style = event.currentTarget.style as unknown as Record<string, string>;
      const resting = resolve();
      restore = Object.fromEntries(keys.filter((key) => !(key in resting)).map((key) => [key, style[key] ?? '']));
      Object.assign(style, enter);
    },
    onMouseLeave: (event) => {
      const style = event.currentTarget.style as unknown as Record<string, string>;
      Object.assign(style, resolve());
      for (const [key, value] of Object.entries(restore)) style[key] = value;
      restore = {};
    },
  };
}
