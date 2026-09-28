// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COLORS } from './styles';
import { hoverable, type HoverHandlers } from './hover';

/**
 * jsdom normalises assigned colours (`#cdd6f4` -> `rgb(205, 214, 244)`), so
 * expectations have to compare in the same space the element reports.
 */
const asCss = (value: string): string => {
  const probe = document.createElement('div');
  probe.style.color = value;
  return probe.style.color;
};

const el = () => document.createElement('div');
const evt = (target: HTMLElement) => ({ currentTarget: target }) as never;

function Row({ handlers, base }: Readonly<{ handlers: HoverHandlers; base: string }>) {
  return <div data-testid="row" style={{ color: base, fontSize: 11 }} {...handlers} />;
}

const colorOf = () => screen.getByTestId('row').style.color;
const fontOf = () => screen.getByTestId('row').style.fontSize;

describe('hoverable', () => {
  it('applies the target on enter and the resting style on leave', () => {
    const node = el();
    const { onMouseEnter, onMouseLeave } = hoverable({ color: COLORS.text }, { color: COLORS.textMuted });

    onMouseEnter(evt(node));
    expect(node.style.color).toBe(asCss(COLORS.text));

    onMouseLeave(evt(node));
    expect(node.style.color).toBe(asCss(COLORS.textMuted));
  });

  it('restores unmentioned keys to blank, never to a foreign default', () => {
    const node = el();
    const { onMouseEnter, onMouseLeave } = hoverable({ backgroundColor: COLORS.bgHover });

    onMouseEnter(evt(node));
    expect(node.style.backgroundColor).toBe(asCss(COLORS.bgHover));

    onMouseLeave(evt(node));
    // Blank, not 'transparent' — the element's own inline/base value shows
    // through again. A blanket clear would take that with it.
    expect(node.style.backgroundColor).toBe('');
  });

  it('restores what was already inline, not a blank that erases it', () => {
    // React owns `backgroundColor` here. Blanking it on leave would take the
    // inline value with it, and nothing puts it back until the next render.
    render(<Row base={COLORS.textMuted} handlers={hoverable({ backgroundColor: COLORS.bgHover })} />);
    const row = screen.getByTestId('row');
    row.style.backgroundColor = asCss(COLORS.bgLight);

    fireEvent.mouseEnter(row);
    expect(row.style.backgroundColor).toBe(asCss(COLORS.bgHover));

    fireEvent.mouseLeave(row);
    expect(row.style.backgroundColor).toBe(asCss(COLORS.bgLight));
  });

  it('leaves properties it never touched alone', () => {
    const node = el();
    node.style.fontSize = '11px';
    const { onMouseEnter, onMouseLeave } = hoverable({ color: COLORS.text });

    onMouseEnter(evt(node));
    onMouseLeave(evt(node));

    expect(node.style.fontSize).toBe('11px');
  });

  it('re-reads a function target so the resting style can depend on state', () => {
    const node = el();
    let selected = false;
    const { onMouseEnter, onMouseLeave } = hoverable({ backgroundColor: COLORS.bgLight }, () => ({
      backgroundColor: selected ? COLORS.bgHover : 'transparent',
    }));

    selected = true;
    onMouseEnter(evt(node));
    expect(node.style.backgroundColor).toBe(asCss(COLORS.bgLight));
    onMouseLeave(evt(node));
    expect(node.style.backgroundColor).toBe(asCss(COLORS.bgHover));

    selected = false;
    onMouseLeave(evt(node));
    expect(node.style.backgroundColor).toBe(asCss('transparent'));
  });

  it('drives a real React element through the spread, preserving inline styles', () => {
    render(<Row base={COLORS.textMuted} handlers={hoverable({ color: COLORS.text }, { color: COLORS.textDim })} />);

    fireEvent.mouseEnter(screen.getByTestId('row'));
    expect(colorOf()).toBe(asCss(COLORS.text));
    expect(fontOf()).toBe('11px');

    fireEvent.mouseLeave(screen.getByTestId('row'));
    // The leave target wins, and the style the helper never touched survives.
    expect(colorOf()).toBe(asCss(COLORS.textDim));
    expect(fontOf()).toBe('11px');
  });
});
