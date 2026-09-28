// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio } from './contrast';
import { COLORS, FONT_SIZE, SPACE, btnBase, btnIcon, withAlpha } from './styles';
import { getAgentColor } from './components/agentColors';

/** WCAG 2.2 AA 2.5.8 Target Size (Minimum). */
const MIN_TARGET = 24;

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

// Comments explain the rules; they must not trip the rules' own scanners.
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const nameOf = (file: string): string => file.split(/[\\/]/).pop() as string;

/** 1-based line number of `index` within `source`. */
const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length;

const webviewFiles = sourceFiles(join(__dirname));

/**
 * A scan that walks nothing passes every assertion it makes, so the walk has
 * to be asserted before its result is. Below this count the glob, the
 * directory or the extensions are wrong, and `offenders` is empty for reasons
 * that have nothing to do with the rule.
 */
const MIN_SCANNED_FILES = 10;

/**
 * Walks `webviewFiles`, collecting a label for every `pattern` hit that
 * `report` does not return `null` for.
 *
 * @param pattern factory for a fresh global regex — the same regex object
 *   cannot be shared across two walks, because `lastIndex` survives.
 * @param report decide whether a hit is an offender, and describe it.
 * @param skip   files this rule does not apply to.
 */
function scan(
  pattern: () => RegExp,
  report: (match: RegExpExecArray) => string | null,
  skip?: (file: string) => boolean,
): string[] {
  const offenders: string[] = [];
  const rule = pattern();
  let visited = 0;

  for (const file of webviewFiles) {
    if (skip?.(file)) continue;
    visited++;
    const source = code(file);
    for (const match of source.matchAll(rule)) {
      const offender = report(match);
      if (offender) offenders.push(`${nameOf(file)}:${lineAt(source, match.index)} ${offender}`);
    }
  }

  expect(visited).toBeGreaterThanOrEqual(MIN_SCANNED_FILES);
  return offenders;
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
    expect(contrastRatio(COLORS.onAccent, COLORS.purple)).toBeGreaterThanOrEqual(AA_TEXT);
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

describe('design token discipline', () => {
  // `styles.ts` and `contrast.ts` are exempt: one defines the palette, the
  // other parses colour strings as its whole job. `agentColors.ts` and
  // `slashCommands.ts` are exempt for the four agent hues that are
  // deliberately off-palette — collapsing them would cost agent identity,
  // and their washes are already derived via `withAlpha`.
  const EXEMPT = new Set(['styles.ts', 'contrast.ts', 'agentColors.ts', 'slashCommands.ts']);

  it('keeps the palette itself free of rgba literals outside the scales', () => {
    // `*Tint`/`*Fill`/`*Row` are surface washes, `*Border` a hairline, and
    // `scrim`/`overlay` are backdrops. Those are the tokens whose *value* is
    // meant to be translucent; every other token names a solid and has to
    // reach for `withAlpha` at the point of use instead.
    const solid = /(?:Tint|Border|Fill|Row|scrim|overlay)$/;

    for (const [key, value] of Object.entries(COLORS)) {
      if (solid.test(key)) continue;
      expect(value, `${key} should be a solid, not ${value}`).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it('has no hard-coded colour outside the exemptions', () => {
    const offenders = scan(
      () => /#[0-9a-fA-F]{3,8}\b|rgba\(\d/g,
      (match) => match[0],
      (file) => EXEMPT.has(nameOf(file)),
    );

    expect(offenders).toEqual([]);
  });

  it('rejects a token added as a duplicate of an existing one', () => {
    // Two names for one colour is the failure this refactor exists to stop:
    // a later "fix" to one name leaves the other stale.
    const values = Object.values(COLORS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('derives agent chip washes from their hue', () => {
    for (const agent of ['build', 'plan', 'ask', 'debug', 'docs', 'code', 'review']) {
      const color = getAgentColor(agent);
      expect(color?.text).toMatch(/^#[0-9a-f]{6}$/);
      expect(color?.bg).toBe(withAlpha(color!.text, 0.12));
      expect(color?.border).toBe(withAlpha(color!.text, 0.3));
    }
  });

  it('expands short hex rather than shifting the channel', () => {
    // `#fff` parses as 0xfff, so a naive read turns it into `rgba(0, 255, 255)`.
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#f38ba8', 0.5)).toBe(withAlpha('#f38ba8ff', 0.5));
  });

  it('refuses a colour it cannot parse instead of emitting rgba(NaN)', () => {
    expect(() => withAlpha('red', 0.5)).toThrow(/hex colour/);
    expect(() => withAlpha('#12345', 0.5)).toThrow(/hex colour/);
  });
});

describe('type and spacing scales', () => {
  // A declaration's value: quoted, templated, or a bare number. Bare numbers
  // matter because React inline styles read a number as px for these props —
  // `padding: 8` is `padding: '8px'` and has to be judged the same way.
  const spacingDeclaration = () =>
    /\b(?:padding|margin|gap|rowGap|columnGap)[A-Za-z]*:\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|[^,;}\n]+)/g;
  const fontSizeDeclaration = () => /\bfontSize:\s*['"]?(\d+)/g;
  // Units are optional on purpose — see above.
  const lengths = () => /(\d+(?:\.\d+)?)(?:px)?/g;

  const value = (declaration: string): string =>
    declaration
      .replace(/^[^:]*:\s*/, '')
      .replace(/^['"`]|['"`]$/g, '')
      .trim();

  it('uses no type size below the scale floor', () => {
    const offenders = scan(fontSizeDeclaration, (match) => (Number(match[1]) < FONT_SIZE.xs ? `${match[1]}px` : null));

    expect(offenders).toEqual([]);
  });

  it('keeps every font size on a declared step', () => {
    const steps = new Set<number>(Object.values(FONT_SIZE));

    const offenders = scan(fontSizeDeclaration, (match) =>
      steps.has(Number(match[1])) ? null : `${match[1]}px is not on the FONT_SIZE scale`,
    );

    expect(offenders).toEqual([]);
  });

  it('keeps padding and gap on an even, declared step', () => {
    // The UI already ran on a 2px sub-grid; the odd values were the only
    // genuine violations, and a half-pixel rhythm is what they break.
    const steps = new Set<number>(Object.values(SPACE));

    const offenders = scan(spacingDeclaration, (match) => {
      const declaration = value(match[0]);
      const bad = [...declaration.matchAll(lengths())]
        .map((length) => Number(length[1]))
        .filter((px) => px > 1 && (px % 2 !== 0 || !steps.has(px)));

      return bad.length ? `${declaration} -> ${[...new Set(bad)].join(', ')}px` : null;
    });

    expect(offenders).toEqual([]);
  });
});

describe('component conventions', () => {
  it('exports nothing from styles.ts that nothing consumes', () => {
    // A dead export is worse than no export: it reads as an available option,
    // so the next author picks the wrong one instead of the right one.
    const path = join(__dirname, 'styles.ts');
    const styles = readFileSync(path, 'utf8');
    const exported = [...styles.matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(5);

    // Exports composed inside styles.ts (`btnIcon` spreads `btnBase`) count.
    const internal = code(path);

    const offenders = exported.filter(
      (name) =>
        !new RegExp(`\\b${name}\\b`).test(internal) &&
        !webviewFiles.some((file) => !file.endsWith('styles.ts') && new RegExp(`\\b${name}\\b`).test(code(file))),
    );

    expect(offenders).toEqual([]);
  });

  it('never clears inline styles wholesale', () => {
    // `style.cssText = ''` drops React's own inline styles, not just the
    // hover state, leaving the element bare until the next re-render.
    const offenders = scan(
      () => /\.cssText\s*=/g,
      (match) => match[0],
    );

    expect(offenders).toEqual([]);
  });

  it('keeps popup chrome in the shared styles, not copied per component', () => {
    // styles.ts is where the copy is allowed to live.
    const offenders = scan(
      () => /borderBottom:\s*'none'/g,
      (match) => match[0],
      (file) => file.endsWith('styles.ts'),
    );

    expect(offenders).toEqual([]);
  });

  it('routes every hover pair through the shared helper', () => {
    // Hand-rolled `currentTarget.style` mutation is what drifted into three
    // techniques; the helper is the only sanctioned way in.
    const offenders = scan(
      () => /currentTarget\.style\./g,
      (match) => match[0],
    );

    expect(offenders).toEqual([]);
  });
});

describe('touch target size', () => {
  // Micro-controls here are glyph + padding, so the padding maths lands around
  // 16-22px — under the 2.5.8 floor with no visible sign in the JSX. The floor
  // has to be asserted, or a later padding tweak quietly regresses it.

  it('gives shared icon buttons a reachable target', () => {
    expect(btnBase.minWidth as number).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(btnBase.minHeight as number).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(btnIcon.minHeight as number).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('gives every message action button a reachable target', () => {
    const source = readFileSync(join(__dirname, 'components', 'ChatBubble.tsx'), 'utf8');
    // Slice per button rather than counting `minHeight` across the file: a
    // global count couples two unrelated things, so an unrelated `minHeight`
    // elsewhere in the file would fail this, and a missing one would cancel
    // it out.
    const buttons = [...source.matchAll(/className="msg-action-btn"/g)];

    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button, i) => {
      const end = buttons[i + 1]?.index ?? source.length;
      const floor = /minHeight:\s*(\d+)/.exec(source.slice(button.index, end))?.[1];

      expect(floor, `action button ${i + 1} declares no minHeight`).toBeDefined();
      expect(Number(floor)).toBeGreaterThanOrEqual(MIN_TARGET);
    });
  });

  it('gives the markdown copy button a reachable target', () => {
    const source = readFileSync(join(__dirname, '..', 'extension', 'services', 'WebviewHtmlBuilder.ts'), 'utf8');
    const rule = source.match(/\.opencode-markdown \.copy-btn\{([^}]*)\}/)?.[1] ?? '';

    expect(rule).toBeTruthy();
    expect(rule).toMatch(new RegExp(`min-width:(2[4-9]|[3-9]\\d)px`));
    expect(rule).toMatch(new RegExp(`min-height:(2[4-9]|[3-9]\\d)px`));
  });

  it('gives the attach button a reachable target', () => {
    const source = readFileSync(join(__dirname, 'components', 'BottomInput.tsx'), 'utf8');
    // Anchor on the button's own label, not the handler name, which also
    // appears in earlier callbacks far from the element.
    const start = source.indexOf('aria-label="Add file"');
    const block = source.slice(start, start + 900);

    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/minWidth: (2[4-9]|[3-9]\d)/);
    expect(block).toMatch(/minHeight: (2[4-9]|[3-9]\d)/);
  });
});
