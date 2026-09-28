import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { WebviewHtmlBuilder } from './WebviewHtmlBuilder';

vi.mock('vscode', () => ({ Uri: { joinPath: vi.fn((_root, ...parts: string[]) => ({ fsPath: parts.join('/') })) } }));

const webview = {
  asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
  cspSource: 'vscode-webview:',
} as unknown as vscode.Webview;

const built = () => new WebviewHtmlBuilder({ fsPath: '/ext' } as vscode.Uri, () => undefined).build(webview);

/** Declaration body of the first rule whose selector list starts with `selector`. */
const css = (selector: string): string | undefined =>
  built().match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1];

/** `font-size` of a heading rule, in px. */
const headingSize = (level: number): number | undefined => {
  const body = css(`.opencode-markdown h${level}`);
  return body ? Number(/font-size:(\d+)px/.exec(body)?.[1]) : undefined;
};

describe('WebviewHtmlBuilder', () => {
  it('builds secured webview HTML', () => {
    const html = built();
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script nonce="[A-Za-z0-9]+"/);
  });

  it('keeps a real step between every level of the heading ladder', () => {
    // A heading one pixel off its neighbour reads as body text, and the bottom
    // of the ladder *is* body text. Three sized levels is what a 13px surface
    // has room for.
    const ladder = [1, 2, 3].map(headingSize);

    expect(ladder).toEqual([20, 16, 14]);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i - 1]! - ladder[i]!).toBeGreaterThanOrEqual(2);
    }
  });

  it('separates h4 and below by weight, not by a size it does not have', () => {
    // Body text is 13px, so an `h4{font-size:13px}` rule bought nothing. The
    // shared h1-h6 rule already supplies 600 weight and block margins.
    expect(headingSize(4)).toBeUndefined();
    expect(built()).toContain('h6{margin:12px 0 6px;font-weight:600');
  });

  it('lets wide tables scroll instead of stretching the bubble', () => {
    const table = css('.opencode-markdown table');

    expect(table).toContain('display:block');
    expect(table).toContain('overflow-x:auto');
    // `border-collapse` only means anything on a table box, and `display:block`
    // is what makes the outer table scrollable. So the rule that keeps cell
    // borders collapsed has to live on the sections the anonymous table box
    // wraps — the outer declaration would be dead CSS.
    expect(table).not.toContain('border-collapse');
    const sections = css('.opencode-markdown table>thead,.opencode-markdown table>tbody');

    expect(sections).toContain('display:table');
    expect(sections).toContain('border-collapse:collapse');
    // `pre` already does this; the table was the one that did not.
    expect(css('.opencode-markdown pre')).toContain('overflow-x:auto');
  });
});
