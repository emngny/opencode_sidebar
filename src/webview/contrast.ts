/**
 * WCAG 2.1 relative luminance and contrast ratio, plus a small CSS colour
 * parser. Lives here so palette rules can be asserted in any test instead of
 * being re-derived per file.
 */

/** Parses `#rgb`, `#rrggbb`, `rgb(...)` and `rgba(...)` into a hex string. */
export function parseCssColor(value: string): string {
  const input = value.trim();

  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return `#${digits.toLowerCase()}`;
  }

  const rgb = input.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) {
    const toHex = (n: string) => Math.round(Number(n)).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }

  throw new Error(`Unsupported color: ${value}`);
}

/** WCAG relative luminance. */
export function relativeLuminance(color: string): number {
  const hex = parseCssColor(color);
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i + 1, i + 3), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between 1 (identical) and 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Minimum ratio for WCAG AA body text. */
export const AA_TEXT = 4.5;

/** Minimum ratio for WCAG AA large text (>=24px, or >=18.66px bold). */
export const AA_LARGE_TEXT = 3;
