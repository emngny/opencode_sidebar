import { CSSProperties } from 'react';

// Colors
export const COLORS = {
  bg: '#1e1e2e',
  bgLight: '#181825',
  bgHover: '#313244',
  border: '#45475a',
  text: '#cdd6f4',
  textMuted: '#9ca2b8',
  textDim: '#a6adc8',
  accent: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
  purple: '#7c3aed',
  yellow: '#f9e2af',
  teal: '#94e2d5',
  overlay: 'rgba(0,0,0,0.6)',
  /** Dimmer backdrop for popups that sit above an already-dimmed view. */
  scrim: 'rgba(0,0,0,0.5)',
  /** Text on a dark/saturated fill (purple, error). */
  onAccent: '#fff',
  /**
   * Text on a light fill (green, accent blue). Deliberately darker than `bg`:
   * the light fills need a stronger step to clear AA.
   */
  onBright: '#11111b',
  /** Status surface washes and their matching hairline borders. */
  successTint: 'rgba(166,227,161,0.05)',
  successBorder: 'rgba(166,227,161,0.3)',
  successFill: 'rgba(166,227,161,0.1)',
  /** Diff-line wash. Stronger than `successTint`: a whole row has to read. */
  successRow: 'rgba(166,227,161,0.08)',
  accentTint: 'rgba(137,180,250,0.06)',
  accentBorder: 'rgba(137,180,250,0.3)',
  accentFill: 'rgba(137,180,250,0.15)',
  dangerTint: 'rgba(243,139,168,0.05)',
  dangerBorder: 'rgba(243,139,168,0.3)',
  /** Diff-line wash. See `successRow`. */
  dangerRow: 'rgba(243,139,168,0.08)',
};

/**
 * `hex` at `alpha`. Washes derive from their hue instead of being hand-copied.
 *
 * Accepts `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`. Any alpha the source
 * carries is discarded — `alpha` is the one the caller means, and silently
 * multiplying the two would be worse than dropping it.
 *
 * Throws on anything that is not hex. A named colour or a malformed literal
 * would otherwise parse to `NaN` and ship as `rgba(NaN, ...)`, which is an
 * invalid declaration the browser drops — the element loses its colour and
 * nothing says why.
 */
export function withAlpha(hex: string, alpha: number): string {
  const body = hex.trim().replace(/^#/, '');
  const expanded = body.length === 3 || body.length === 4 ? [...body].map((c) => c + c).join('') : body;

  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(expanded)) {
    throw new Error(`withAlpha: expected a hex colour, got "${hex}"`);
  }

  const n = Number.parseInt(expanded.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Corner radius scale. Kept deliberately short — a wide scale invites
// off-scale one-offs, which is what the audit found.
export const RADIUS = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 16,
} as const;

// Elevation scale. Only three steps; anything deeper is decoration, not depth.
export const SHADOW = {
  sm: '0 1px 3px rgba(0,0,0,0.2)',
  md: '0 4px 12px rgba(0,0,0,0.3)',
  lg: '0 8px 32px rgba(0,0,0,0.4)',
  /** Upward cast for sheets that slide up from the bottom edge. */
  sheet: '0 -4px 20px rgba(0,0,0,0.4)',
} as const;

/**
 * Type scale. `xs` is the floor: 10px was in use in thirteen places and no
 * longer appears. The steps are close together on purpose — this is a dense
 * transcript, not a marketing page, and 11/12/13/14 all need to coexist.
 */
export const FONT_SIZE = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 16,
  xxl: 20,
  display: 24,
} as const;

/**
 * Spacing scale. The UI was already on a 2px sub-grid; this codifies the four
 * steps that carry almost all of it and retires the odd values (3/5/7) that
 * were the only real violations.
 */
export const SPACE = {
  hair: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
} as const;

// Layout
export const flexRow: CSSProperties = { display: 'flex', alignItems: 'center' };

// Buttons
// WCAG 2.2 AA 2.5.8 sets a 24x24 minimum target. Icon-only buttons here are
// built from a 14-18px glyph plus padding, which lands near 20px — the floor
// has to be explicit, since padding alone will not reach it.
export const btnBase: CSSProperties = {
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  minWidth: 28,
  minHeight: 28,
  borderRadius: RADIUS.sm,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
export const btnIcon: CSSProperties = { ...btnBase, color: COLORS.textMuted };

// Text
export const textSmall: CSSProperties = { fontSize: 11, color: COLORS.textMuted };
export const textHeader: CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 8 };

/**
 * Chrome shared by every popup panel. The model manager, session history and
 * slash list each used to hand-write the same body/border/radius/shadow
 * stack; they now differ only in `maxHeight` and inset.
 */
export const popupPanel: CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  backgroundColor: COLORS.bg,
  border: `1px solid ${COLORS.bgHover}`,
  borderRadius: RADIUS.xl,
  boxShadow: SHADOW.sheet,
  overflowY: 'auto',
  zIndex: 100,
};

/** Dimming layer for popups that dock to the bottom edge. */
export const sheetBackdrop: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: COLORS.scrim,
  zIndex: 200,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
};

/** Body of a bottom-docked sheet. */
export const sheetPanel: CSSProperties = {
  backgroundColor: COLORS.bg,
  border: `1px solid ${COLORS.bgHover}`,
  borderBottom: 'none',
  borderRadius: `${RADIUS.pill}px ${RADIUS.pill}px 0 0`,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: SHADOW.sheet,
};

/** Title row of a bottom sheet: title/subtitle on the left, actions right. */
export const sheetHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px',
  borderBottom: `1px solid ${COLORS.bgHover}`,
  flexShrink: 0,
};

/** A row of equal-width tabs under a sheet header. */
export const sheetTabs: CSSProperties = {
  display: 'flex',
  borderBottom: `1px solid ${COLORS.bgHover}`,
  flexShrink: 0,
};

// Fixed overlay
export const overlay: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: COLORS.overlay,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

// Card / Panel
export const card: CSSProperties = {
  backgroundColor: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.xl,
  padding: 24,
  maxWidth: 400,
  width: '90%',
  boxShadow: SHADOW.lg,
};
