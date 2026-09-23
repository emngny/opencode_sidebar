import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { WebviewHtmlBuilder } from './WebviewHtmlBuilder';

vi.mock('vscode', () => ({ Uri: { joinPath: vi.fn((_root, ...parts: string[]) => ({ fsPath: parts.join('/') })) } }));

describe('WebviewHtmlBuilder', () => {
  it('builds secured webview HTML', () => {
    const webview = {
      asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
      cspSource: 'vscode-webview:',
    } as unknown as vscode.Webview;
    const html = new WebviewHtmlBuilder({ fsPath: '/ext' } as vscode.Uri, () => undefined).build(webview);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script nonce="[A-Za-z0-9]+"/);
  });
});
