import { CSSProperties } from 'react';

// Colors
export const COLORS = {
  bg: '#1e1e2e',
  bgLight: '#181825',
  bgHover: '#313244',
  border: '#45475a',
  text: '#cdd6f4',
  textMuted: '#585b70',
  textDim: '#6c7086',
  accent: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
  purple: '#7c3aed',
  yellow: '#f9e2af',
  teal: '#94e2d5',
  overlay: 'rgba(0,0,0,0.6)',
};

// Layout
export const flexRow: CSSProperties = { display: 'flex', alignItems: 'center' };
export const flexCenter: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center' };
export const flexBetween: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
export const flexCol: CSSProperties = { display: 'flex', flexDirection: 'column' };

// Buttons
export const btnBase: CSSProperties = { backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' };
export const btnIcon: CSSProperties = { ...btnBase, color: COLORS.textMuted };
export const btnAccent: CSSProperties = { padding: '7px 14px', borderRadius: 6, border: 'none', backgroundColor: COLORS.purple, color: '#fff', cursor: 'pointer', fontSize: 12 };

// Inputs
export const inputBase: CSSProperties = { flex: 1, padding: '7px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.bgHover, color: COLORS.text, fontSize: 12, fontFamily: 'monospace', outline: 'none' };

// Text
export const textSmall: CSSProperties = { fontSize: 11, color: COLORS.textMuted };
export const textNormal: CSSProperties = { fontSize: 13, lineHeight: 1.6, color: COLORS.text, wordBreak: 'break-word' };
export const textHeader: CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 8 };

// Fixed overlay
export const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };

// Card / Panel
export const card: CSSProperties = { backgroundColor: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' };

// Transition
export const transitionColor: CSSProperties = { transition: 'color 0.15s' };

// Gap helpers
export const gap = (n: number): CSSProperties => ({ gap: n });