// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postMessage } from '../vscode-api';
import { Markdown } from './Markdown';

vi.mock('../vscode-api', () => ({ postMessage: vi.fn() }));

function clickLink(name: string) {
  fireEvent.click(screen.getByText(name));
}

describe('Markdown external links', () => {
  beforeEach(() => {
    vi.mocked(postMessage).mockClear();
  });

  it('hands absolute links to the extension instead of swallowing the click', () => {
    render(<Markdown content={'[docs](https://example.com/docs)'} />);

    clickLink('docs');

    expect(postMessage).toHaveBeenCalledWith({ type: 'openExternal', payload: { url: 'https://example.com/docs' } });
  });

  it('forwards mailto links', () => {
    render(<Markdown content={'[mail](mailto:dev@example.com)'} />);

    clickLink('mail');

    expect(postMessage).toHaveBeenCalledWith({ type: 'openExternal', payload: { url: 'mailto:dev@example.com' } });
  });

  it('leaves in-page anchors to the browser', () => {
    render(<Markdown content={'[top](#section)'} />);

    clickLink('top');

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('never posts a scheme the sanitizer strips', () => {
    render(<Markdown content={'[bad](javascript:alert(1))'} />);

    const link = screen.getByText('bad');
    expect(link.getAttribute('href')).toBeNull();
    clickLink('bad');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('still copies code blocks', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<Markdown content={'```ts\nconst a = 1;\n```'} />);

    fireEvent.click(container.querySelector('.copy-btn') as HTMLElement);

    expect(writeText).toHaveBeenCalledWith('const a = 1;\n');
  });
});
