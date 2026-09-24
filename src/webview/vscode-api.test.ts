import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('webview message boundary', () => {
  let listener: ((event: MessageEvent) => void) | undefined;
  let removeListener: (event: string, callback: (event: MessageEvent) => void) => void;
  let postMessage: ReturnType<typeof vi.fn>;
  let onMessage: typeof import('./vscode-api').onMessage;

  beforeEach(async () => {
    vi.resetModules();
    listener = undefined;
    removeListener = vi.fn((_event: string, _callback: (event: MessageEvent) => void) => undefined);
    postMessage = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: vi.fn((_event: string, callback: (event: MessageEvent) => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn((_event: string, callback: (event: MessageEvent) => void) => {
        removeListener(callback);
      }),
    });
    vi.stubGlobal(
      'acquireVsCodeApi',
      vi.fn(() => ({ postMessage })),
    );
    ({ onMessage } = await import('./vscode-api'));
  });

  it('forwards valid extension messages and removes the listener on cleanup', () => {
    const handler = vi.fn();
    const dispose = onMessage(handler);
    const valid = { type: 'error', payload: { message: 'failed' } };

    listener?.({ origin: 'vscode-webview://extension', data: valid } as MessageEvent);

    expect(handler).toHaveBeenCalledWith(valid);
    dispose();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('ignores messages from untrusted origins', () => {
    const handler = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onMessage(handler);

    listener?.({
      origin: 'https://attacker.example',
      data: { type: 'error', payload: { message: 'injected' } },
    } as MessageEvent);

    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[webview] Ignored message from untrusted origin:', 'https://attacker.example');
    warn.mockRestore();
  });

  it('ignores unknown, malformed, and missing message types', () => {
    const handler = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onMessage(handler);

    for (const data of [undefined, null, 'error', 42, {}, { type: 'unknown' }]) {
      listener?.({ origin: 'vscode-webview://extension', data } as MessageEvent);
    }

    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the VS Code postMessage bridge', async () => {
    const { postMessage: post } = await import('./vscode-api');
    const message = { type: 'webviewReady' } as const;

    post(message);

    expect(postMessage).toHaveBeenCalledWith(message);
  });
});
