// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio } from './contrast';
import { COLORS, btnAccent } from './styles';

/** Every surface a text colour can end up on. */
const SURFACES = [COLORS.bg, COLORS.bgLight, COLORS.bgHover];

/** Colours used for text (never for fills or borders alone). */
const TEXT_COLORS: Record<string, string> = {
  text: COLORS.text,
  textMuted: COLORS.textMuted,
  textDim: COLORS.textDim,
  accent: COLORS.accent,
  green: COLORS.green,
  red: COLORS.red,
  yellow: COLORS.yellow,
  teal: COLORS.teal,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      return entry.includes('.test.') ? [] : [path];
    }
    return sourceFiles(path);
  });
}

describe('palette contrast', () => {
  it('gives every text token at least AA on every surface', () => {
    const failures: string[] = [];
    for (const [name, fg] of Object.entries(TEXT_COLORS)) {
      for (const bg of SURFACES) {
        const ratio = contrastRatio(fg, bg);
        if (ratio < AA_TEXT) failures.push(`${name} ${fg} on ${bg} = ${ratio.toFixed(2)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps the accent button readable', () => {
    const fg = btnAccent.color as string;
    const bg = btnAccent.backgroundColor as string;

    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the user bubble readable on the purple fill', () => {
    expect(contrastRatio('#ffffff', COLORS.purple)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('webview colour literals', () => {
  // These were the pre-audit values of COLORS.textMuted / COLORS.textDim. They
  // sat at 1.9-3.6:1 against the app surfaces and are unreadable at the 10-11px
  // sizes they were used at. Hard-coded copies are the thing to watch for:
  // the tokens can be fixed while a literal quietly keeps the old value.
  const BANNED = ['#585b70', '#6c7086'];
  const files = sourceFiles(join(__dirname));

  it('actually inspects the webview sources', () => {
    // Guards the guard: a walk that silently matched nothing would make the
    // scan below pass forever.
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith('ChatBubble.tsx'))).toBe(true);
  });

  it('has no hard-coded copy of a retired colour', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const banned of BANNED) {
        if (contents.includes(banned)) offenders.push(`${file} -> ${banned}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
