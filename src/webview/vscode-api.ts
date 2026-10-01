import { WebviewToExtensionMessage, ExtensionToWebviewMessage, EXTENSION_TO_WEBVIEW_TYPES } from '../shared/types';

declare function acquireVsCodeApi(): any;
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : (globalThis as any).vscode;

function isTrustedVsCodeOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'vscode-webview:';
  } catch {
    return false;
  }
}

export function postMessage(msg: WebviewToExtensionMessage) {
  vscode.postMessage(msg);
}

/**
 * Reads state persisted across webview deallocations.
 *
 * VS Code destroys the webview document whenever the view is hidden and builds
 * a new one on the next show, so anything the user picked — agent mode, hidden
 * models — is gone unless it was written back through `setPersistedState`.
 * VS Code serialises this store itself and restores it after an editor restart.
 */
export function getPersistedState<T extends object>(): Partial<T> {
  const state = vscode.getState?.();
  return state && typeof state === 'object' ? (state as Partial<T>) : {};
}

/** Merges `patch` into the persisted state. Never throws on a missing API. */
export function setPersistedState(patch: Record<string, unknown>): void {
  if (typeof vscode.setState !== 'function') return;
  vscode.setState({ ...getPersistedState<object>(), ...patch });
}

export function onMessage(handler: (msg: ExtensionToWebviewMessage) => void): () => void {
  const wrapped = (event: MessageEvent) => {
    if (!isTrustedVsCodeOrigin(event.origin)) {
      console.warn('[webview] Ignored message from untrusted origin:', event.origin);
      return;
    }
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || !EXTENSION_TO_WEBVIEW_TYPES.includes(msg.type)) {
      console.warn('[webview] Ignored message with unknown type:', msg?.type);
      return;
    }
    handler(msg);
  };
  window.addEventListener('message', wrapped);
  return () => {
    window.removeEventListener('message', wrapped);
  };
}
