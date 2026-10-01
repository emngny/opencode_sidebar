import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('webview message boundary', () => {
  let listener: ((event: MessageEvent) => void) | undefined;
  let removeListener: (event: string, callback: (event: MessageEvent) => void) => void;
  let postMessage: ReturnType<typeof vi.fn>;
  let getState: ReturnType<typeof vi.fn>;
  let setState: ReturnType<typeof vi.fn>;
  let onMessage: typeof import('./vscode-api').onMessage;

  beforeEach(async () => {
    vi.resetModules();
    listener = undefined;
    removeListener = vi.fn((_event: string, _callback: (event: MessageEvent) => void) => undefined);
    postMessage = vi.fn();
    // VS Code owns this store, so the stub has to survive a module reload the
    // way the real one does.
    let stored: unknown = undefined;
    getState = vi.fn(() => stored);
    setState = vi.fn((next: unknown) => {
      stored = next;
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn((_event: string, callback: (event: MessageEvent) => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn((_event: string, callback: (event: MessageEvent) => void) => {
        removeListener('message', callback);
      }),
    });
    vi.stubGlobal(
      'acquireVsCodeApi',
      vi.fn(() => ({ postMessage, getState, setState })),
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

  describe('persisted state', () => {
    it('merges patches instead of replacing the whole store', async () => {
      const { getPersistedState, setPersistedState } = await import('./vscode-api');

      setPersistedState({ mode: 'plan' });
      setPersistedState({ hiddenModels: { m1: true } });

      expect(getPersistedState()).toEqual({ mode: 'plan', hiddenModels: { m1: true } });
    });

    it('returns an empty object when nothing was ever stored', async () => {
      const { getPersistedState } = await import('./vscode-api');
      // A fresh webview has no prior state; the store must not hand back junk.
      expect(getPersistedState()).toEqual({});
    });

    it('survives a webview rebuild', async () => {
      // The state has to come back from VS Code's own store, not from a module
      // variable, because the module is re-evaluated on every remount.
      const { setPersistedState } = await import('./vscode-api');
      setPersistedState({ mode: 'debug' });

      vi.resetModules();
      const reloaded = await import('./vscode-api');

      expect(reloaded.getPersistedState<{ mode: string }>().mode).toBe('debug');
    });

    it('acquires the VS Code API exactly once per module load', async () => {
      await import('./vscode-api');
      // A second acquireVsCodeApi() call throws inside the real host.
      expect((globalThis as { acquireVsCodeApi?: ReturnType<typeof vi.fn> }).acquireVsCodeApi).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the host exposes no state store', async () => {
      vi.stubGlobal(
        'acquireVsCodeApi',
        vi.fn(() => ({ postMessage })),
      );
      vi.resetModules();
      const { getPersistedState, setPersistedState } = await import('./vscode-api');

      expect(() => setPersistedState({ mode: 'plan' })).not.toThrow();
      expect(getPersistedState()).toEqual({});
    });
  });
});
