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
